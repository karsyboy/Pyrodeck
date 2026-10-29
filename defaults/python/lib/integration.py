"""PyroDeck orchestration. Pyrolight owns preferences, trust and GameStream."""

import asyncio
import time
import json
import os
import tempfile
from pathlib import Path
from . import constants
from dataclasses import asdict
from . import runnercontrol, sessionstate, utils, history
from .pyrolightproxy import PyrolightProxy, PyrolightListError, find_pyrolight, pyrolight_host


# `pyrolight list` failures that say nothing about the host's pairing or apps.
TRANSIENT_FAILURES = ("unreachable", "failed", "client_error")
FAILURE_TTL = 5


def failure(code: str, message: str) -> dict:
    return {"schema": 1, "ok": False, "error": {"code": code, "message": message}}


class Integration:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.catalog_cache = {}
        self.catalog_lock = asyncio.Lock()
        self.artwork_cache = {}
        self.artwork_slots = asyncio.Semaphore(2)
        self.known_catalog_path = constants.get_config_file_path().with_name("known-catalogs.json")

    async def artwork(self, settings: dict, host_id: str, app_id: int) -> dict:
        if host_id not in settings["hostSettings"] or type(app_id) is not int or app_id <= 0:
            return failure("target", "Unknown host or app")
        key = (self.executable(settings), host_id, app_id)
        cached = self.artwork_cache.get(key)
        if cached and time.monotonic() - cached[0] < 3600:
            return cached[1]
        host = settings["hostSettings"][host_id]
        async with self.artwork_slots:
            async with PyrolightProxy(key[0]) as proxy:
                result = await proxy.artwork(pyrolight_host(host["address"], host["hostInfoPort"]), app_id)
            if result.get("hostUuid", "").lower() != host_id.lower():
                return failure("wrong_host", "The host at this address changed")
            result = {"schema": 1, "ok": True, "image": result.get("image")}
            if len(self.artwork_cache) >= 64:
                self.artwork_cache.pop(next(iter(self.artwork_cache)))
            self.artwork_cache[key] = (time.monotonic(), result)
            return result

    @staticmethod
    def executable(settings: dict) -> str:
        path = find_pyrolight(settings["moonlightExecPath"] if settings["useMoonlightExec"] else None)
        if path is None:
            raise PyrolightListError("not_installed", "Install Pyrolight or select its executable in Host Selection.")
        return path

    async def preferences(self, settings: dict, request: dict | None = None) -> dict:
        async with PyrolightProxy(self.executable(settings)) as proxy:
            return await proxy.settings(request)

    async def network_tool(self, settings: dict, host_id: str, action: str) -> dict:
        if host_id not in settings["hostSettings"] or action not in ("check", "calibrate", "fix"):
            return failure("target", "Select a known host and network tool")
        if action != "check" and runnercontrol.is_runner_active():
            return failure("active_stream", "Disconnect before running calibration or changing system network buffers.")
        async with PyrolightProxy(self.executable(settings)) as proxy:
            result = await proxy.network_tool(host_id, action)
        if result.get("hostUuid", "").lower() != host_id.lower():
            return failure("wrong_host", "The host at this address changed")
        return result

    def status(self) -> dict:
        import time

        # When this observation was made, on a clock that never goes back:
        # the frontend orders observations by it. updatedAt is wall-clock
        # time for diagnostics, and an absent record has none.
        observed = time.monotonic()
        value = sessionstate.read()
        active = runnercontrol.is_runner_active()
        value = {**value, "runnerActive": active, "observedAt": observed}
        if value.get("state") in ("waking", "connecting", "launching", "streaming", "reconnecting", "ending") and not active:
            return {**value, "state": "failed", "error": "The PyroDeck runner exited. Launch again to resume the host game."}
        return value

    def _known_catalogs(self):
        from .pyrolightproxy import parse_app_list
        try:
            value = json.loads(self.known_catalog_path.read_text())
            if not isinstance(value, dict):
                return {}
            verified = {}
            for host_id, entry in value.items():
                try:
                    result = entry["result"]
                    stamp = result["validatedAt"]
                    if result.get("status") != "paired" or type(stamp) not in (int, float) or not result.get("validated"):
                        continue
                    catalog = parse_app_list(json.dumps({"schema": 1, "host": {"name": result["name"], "uuid": host_id}, "apps": [{**app, "hdrSupported": app.get("hdr_supported", False)} for app in result["apps"]]}))
                    verified[host_id] = {**entry, "result": {**result, "apps": [asdict(app) for app in catalog.apps]}}
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue
            return verified
        except (OSError, ValueError):
            return {}

    def _save_catalogs(self, known):
        self.known_catalog_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=self.known_catalog_path.parent, prefix="known-catalogs.")
        try:
            with os.fdopen(fd, "w") as output:
                json.dump(known, output)
            os.replace(temporary, self.known_catalog_path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    async def catalogs(self, settings: dict, refresh: bool = False) -> dict:
        executable = self.executable(settings)
        async with self.catalog_lock:
            semaphore = asyncio.Semaphore(3)
            known = self._known_catalogs()
            async def fetch(host_id, host):
                key = (executable, host_id, host["address"], host["hostInfoPort"])
                cached = self.catalog_cache.get(key)
                # A failure is retried soon: right after a stream the host or
                # client can briefly refuse the request that follows it.
                ttl = 30 if cached and cached[1]["status"] == "paired" else FAILURE_TTL
                if not refresh and cached and time.monotonic() - cached[0] < ttl:
                    return cached[1]
                async with semaphore:
                    identity = [executable, host["address"], host["hostInfoPort"]]
                    result = {"id": host_id, "name": host["hostName"], "apps": [], "status": "unreachable",
                              "canWake": bool(host.get("mac")), "validated": False}
                    try:
                        async with PyrolightProxy(executable) as proxy:
                            catalog = await proxy.list_apps(pyrolight_host(host["address"], host["hostInfoPort"]), timeout=8)
                        if catalog.host_uuid.lower() != host_id.lower():
                            result["status"] = "wrong_host"
                        else:
                            result.update(status="paired", name=catalog.host_name,
                                          apps=[asdict(app) for app in catalog.apps], validated=True, cached=False,
                                          validatedAt=time.time())
                            known[host_id] = {"identity": identity, "result": result}
                    except PyrolightListError as error:
                        result.update(status=error.reason, error=str(error))
                    except TimeoutError:
                        result["error"] = "Host did not respond"
                    previous = known.get(host_id, {})
                    if result["status"] in TRANSIENT_FAILURES and previous.get("identity") == identity:
                        validated = previous.get("result", {})
                        if validated.get("validated") and 0 <= time.time() - validated.get("validatedAt", 0) < 7 * 86400:
                            result.update(apps=validated.get("apps", []), validated=True, cached=True,
                                          validatedAt=validated["validatedAt"])
                    elif result["status"] != "paired":
                        # Unpairing, a replacement host or an outdated client
                        # invalidate previous claims; only outages and failed
                        # requests to the same host retain them.
                        known.pop(host_id, None)
                    self.catalog_cache[key] = (time.monotonic(), result)
                    return result
            hosts = await asyncio.gather(*(fetch(id, host) for id, host in settings["hostSettings"].items()))
            known = {key: value for key, value in known.items() if key in settings["hostSettings"]}
            try:
                self._save_catalogs(known)
            except OSError:
                from .logger import logger
                logger.exception("Could not save validated host catalogs")
            played = history.read()
            hosts = [{**host, "apps": [{**app, "lastPlayed": played.get(f"{host['id']}:{app['id']}")} for app in host["apps"]]} for host in hosts]
            # A removed host or executable change must not retain unbounded cache entries.
            valid_keys = {(executable, id, host["address"], host["hostInfoPort"]) for id, host in settings["hostSettings"].items()}
            self.catalog_cache = {key: value for key, value in self.catalog_cache.items() if key in valid_keys}
            return {"schema": 1, "ok": True, "defaultHostId": settings["currentHostId"], "hosts": hosts}

    async def reconnect(self, expected_revision: str | None = None) -> dict:
        if not runnercontrol.is_runner_active():
            return failure("no_runner", "The stream has closed. Launch the same game again to resume it.")
        before = sessionstate.read()
        generation = before.get("generation")
        if not generation or before.get("state") in ("ending", "ended", "none"):
            return failure("no_session", "No resumable PyroDeck session")
        runner = runnercontrol.get_active_runner()
        try:
            runner.send_usr1()
            await asyncio.wait_for(utils.wait_runner_suspended_state(True), timeout=12)
            if sessionstate.read().get("generation") != generation:
                return failure("stale_session", "The active session changed")
            attempt = sessionstate.read().get("attempt", 0)
            sessionstate.update(generation, state="reconnecting")
            runner.send_usr2()
            await asyncio.wait_for(utils.wait_runner_suspended_state(False), timeout=12)
            # Wait for a structured Session::connectionStarted event, never infer
            # success from a running PID or preferences having been saved.
            async with asyncio.timeout(60):
                while True:
                    current = self.status()
                    if current.get("generation") != generation:
                        return failure("stale_session", "The active session changed")
                    if current.get("attempt", 0) > attempt and current["state"] == "streaming":
                        if expected_revision and (current.get("effectivePreferences") or {}).get("revision") != expected_revision:
                            return failure("conflict", "The Pyrolight profile changed during reconnect. Refresh before applying this draft.")
                        return {"schema": 1, "ok": True, "session": current}
                    if current.get("state") == "failed" or not runnercontrol.is_runner_active():
                        return failure("reconnect_failed", current.get("error") or "Pyrolight closed before streaming started")
                    await asyncio.sleep(0.1)
        except (TimeoutError, ProcessLookupError) as error:
            return failure("reconnect_failed", str(error) or "Pyrolight did not confirm a connection")

    async def apply(self, settings: dict, request: dict, reconnect: bool) -> dict:
        if self.lock.locked():
            return failure("busy", "A settings or session operation is already in progress")
        async with self.lock:
            # Validate without interrupting gameplay. Patches are the only permitted
            # operation here; profiles have their own next-launch transaction.
            if request.get("operation") != "patch":
                return failure("operation", "Expected a settings patch")
            if reconnect and not runnercontrol.is_runner_active():
                return failure("no_runner", "Launch the game again, or save for the next session.")
            result = await self.preferences(settings, {**request, "operation": "validate"})
            if not result.get("ok"):
                return result
            result = await self.preferences(settings, request)
            if not result.get("ok"):
                return result
            if reconnect:
                connection = await self.reconnect(result["revision"])
                if not connection.get("ok"):
                    return {**connection, "preferences": result, "persisted": True, "applied": False}
            return {"schema": 1, "ok": True, "preferences": result, "applied": reconnect}
