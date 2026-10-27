"""Stream a game from a Pyroshine host through Pyrolight.

The runner is what the PyroDeck Steam shortcut executes, so Steam owns the
launch (Game Mode focus, Steam Input, the overlay's Exit Game) exactly as for
any game. It:

1. wakes the host if needed and checks that the selected host answers;
2. finds the host app to stream: for a library game, the app Pyroshine
   reports for its Steam app ID (`steam:<id>`), never a title match;
3. starts one Pyrolight process with `stream HOST APP` and waits for it.

The host owns the game. Closing Pyrolight, suspending the Deck or a network
drop only ends this client's connection: Pyrolight is started with
`--no-quit-after` and the runner never asks the host to quit anything. Ending
the host game is the separate "quit" utility action, which the user starts
on purpose.
"""

from typing import Optional

from .settingsparser import RunnerSettings
from .envparser import RunnerType, UtilityAction
from ..runnerresult import Result, RunnerError
from ..gamestreaminfo import GameStreamHost, get_server_info
from ..logger import logger
from ..pyrolightproxy import HostApp, HostAppList, PyrolightListError, PyrolightProxy, build_stream_args, find_pyrolight, needs_capability_probe, pyrolight_host
from .. import sessionstate, history


# A Pyrolight exit with an error this soon after start is a launch failure.
EARLY_EXIT_SECS = 10
WINDOW_READY_TIMEOUT = 60


def find_app_by_name(app_list: HostAppList, name: str) -> HostApp:
    """The app Pyrolight's `stream HOST NAME` would pick: case-insensitive exact name."""
    matches = [app for app in app_list.apps if app.name.lower() == name.lower()]
    if not matches:
        raise RunnerError(Result.HostAppNotFound,
                          f"\"{name}\" is not available on {app_list.host_name or 'the host'}!")
    if len(matches) > 1:
        # Pyrolight would silently take the first; refuse instead of guessing.
        raise RunnerError(Result.HostAppAmbiguous,
                          f"{app_list.host_name or 'The host'} offers {len(matches)} apps named \"{name}\"!")
    return matches[0]


def resolve_steam_app(app_list: HostAppList, steam_app_id: int, host_reports_sources: bool) -> HostApp:
    """The host app that starts Steam app `steam_app_id`.

    Pyroshine reports each app's launcher identities (`steam:892970`), so a
    game is found by its app ID, never by title: titles can be suffixed for
    duplicates ("Hades (Steam)") or replaced by the user's own entry, and
    different games can share one. Pyroshine reports an identity on at most
    one app; should two ever claim it, nothing is guessed.
    """
    identity = f"steam:{steam_app_id}"
    import re
    matches = [app for app in app_list.apps if identity in app.sources
               and {source for source in app.sources if re.fullmatch(r"steam:[1-9][0-9]*", source)} == {identity}]
    host = app_list.host_name or "the host"
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(f"\"{app.name}\"" for app in matches)
        raise RunnerError(Result.HostAppAmbiguous, f"{host} offers several apps for Steam app {steam_app_id}: {names}!")
    if not host_reports_sources and not any(app.sources for app in app_list.apps):
        raise RunnerError(Result.HostWithoutAppSources)
    raise RunnerError(Result.HostAppNotFound,
                      f"Steam app {steam_app_id} is not available on {host}! Install it there, or unhide it in "
                      "Pyroshine's library.")


class PyroshineRunner:
    @staticmethod
    async def check_connectivity(overlay_stack, settings: RunnerSettings) -> GameStreamHost:
        """A bounded runner-owned wake sequence, then identity-checked availability."""
        import asyncio
        from ..utils import wake_on_lan

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(0, settings["timeouts"]["wakeOnLan"])
        last_wake = None
        generation = settings.get("generation")
        while True:
            remaining = max(0.1, deadline - loop.time()) if settings["timeouts"]["wakeOnLan"] > 0 else settings["timeouts"]["servicePing"]
            server = await get_server_info(settings["address"], settings["host_port"],
                                          min(settings["timeouts"]["servicePing"], remaining))
            if server is not None:
                if server["uniqueId"].lower() != settings["host_id"].lower():
                    raise RunnerError(Result.WrongHost)
                if generation:
                    sessionstate.update(generation, state="connecting", stage="authenticating")
                return server
            if loop.time() >= deadline:
                raise RunnerError(Result.GameStreamDead, "Host did not respond before the wake timeout. Check its power, network and Wake-on-LAN configuration.")
            if last_wake is None or (not settings["send_wol_once"] and loop.time() - last_wake >= 10):
                if generation:
                    sessionstate.update(generation, state="waking", stage="waking")
                if settings["mac"] or settings["custom_wol_exec_path"]:
                    try:
                        async with asyncio.timeout(max(0.1, deadline - loop.time())):
                            await wake_on_lan(settings["hostname"], settings["address"], settings["mac"],
                                              settings["wol_port"], settings["custom_wol_exec_path"])
                    except TimeoutError as error:
                        raise RunnerError(Result.GameStreamDead, "Wake-on-LAN command timed out") from error
                last_wake = loop.time()
            await asyncio.sleep(min(1, max(0, deadline - loop.time())))

    @staticmethod
    async def list_host_apps(proxy: PyrolightProxy, settings: RunnerSettings) -> HostAppList:
        try:
            app_list = await proxy.list_apps(pyrolight_host(settings["address"], settings["host_port"]))
        except PyrolightListError as err:
            if err.reason == "not_paired":
                raise RunnerError(Result.PyrolightNotPaired) from err
            if err.reason == "unreachable":
                raise RunnerError(Result.PyrolightCannotReachHost) from err
            if err.reason == "outdated":
                raise RunnerError(Result.PyrolightOutdated) from err
            raise RunnerError(Result.PyrolightListFailed) from err
        except TimeoutError as err:
            raise RunnerError(Result.PyrolightCannotReachHost) from err

        # Pyrolight answers for whichever host has this address now; make sure
        # it is the one the user selected (and whose TLS identity Pyrolight
        # pinned when pairing).
        if app_list.host_uuid.lower() != settings["host_id"].lower():
            logger.error(f"Expected host {settings['host_id']}, Pyrolight reached {app_list.host_uuid}")
            raise RunnerError(Result.WrongHost)
        return app_list

    @classmethod
    async def resolve_target(cls, proxy: PyrolightProxy, settings: RunnerSettings, server_info: GameStreamHost) -> HostApp:
        app_list = await cls.list_host_apps(proxy, settings)
        if settings.get("remote_app_id") is not None:
            matches = [app for app in app_list.apps if app.id == settings["remote_app_id"]]
            if len(matches) != 1:
                raise RunnerError(Result.HostAppNotFound)
            app = matches[0]
            if settings.get("steam_app_id") is not None and resolve_steam_app(app_list, settings["steam_app_id"], True).id != app.id:
                raise RunnerError(Result.HostAppNotFound, "The selected host app no longer matches this Steam game.")
        elif settings["runner_type"] == RunnerType.SteamApp:
            assert settings["steam_app_id"] is not None
            app = resolve_steam_app(app_list, settings["steam_app_id"], server_info["appSources"] >= 1)
        else:
            assert settings["app_name"] is not None
            app = find_app_by_name(app_list, settings["app_name"])
        logger.info(f"Streaming host app \"{app.name}\" (ID {app.id})")
        return app

    @staticmethod
    async def run_pyrolight(proxy: PyrolightProxy, args: list[str]):
        import asyncio

        started = asyncio.get_running_loop().time()
        await proxy.start(args)
        returncode = await proxy.wait()
        elapsed = asyncio.get_running_loop().time() - started
        logger.info(f"Pyrolight exited with {returncode} after {elapsed:.1f} s")
        if returncode not in (0, None):
            # Pyrolight shows host and stream errors in its own dialog and then
            # exits normally; a failing exit code is a crash or a rejected
            # command line.
            detail = None
            if elapsed < EARLY_EXIT_SECS:
                detail = f"Pyrolight failed to start (exit code {returncode})! See /tmp/pyrodeck-runner-pyrolight.log."
            raise RunnerError(Result.PyrolightFailed, detail)

    @classmethod
    async def run(cls, settings: RunnerSettings, overlay_stack=None):
        generation = settings.get("generation")
        exec_path = find_pyrolight(settings["pyrolight_exec_path"])
        if exec_path is None:
            raise RunnerError(Result.PyrolightIsNotInstalled)
        logger.info(f"Using Pyrolight at {exec_path}")

        server_info = await cls.check_connectivity(overlay_stack, settings)

        async with PyrolightProxy(exec_path) as proxy:
            if settings["runner_type"] == RunnerType.Utility:
                action: Optional[UtilityAction] = settings["action"]
                assert action is not None
                logger.info(f"Running Pyrolight action: {action.value}")
                args = [action.value, pyrolight_host(settings["address"], settings["host_port"])]
                if action == UtilityAction.Quit:
                    # Match Pyrolight's Quit App action: end the application
                    # currently running on this paired host. The remembered app
                    # ID is session metadata, not a conditional cancel request.
                    args = [action.value, settings["host_id"], "--integration-events"]
                    if generation:
                        sessionstate.update(generation, state="ending")
                        def quit_event(event):
                            if event.get("state") in ("ending", "ended", "failed"):
                                sessionstate.update(generation, state=event["state"], error=event.get("error") or None)
                        proxy.on_event = quit_event
                await cls.run_pyrolight(proxy, args)
                return

            app = await cls.resolve_target(proxy, settings, server_info)
            settings["remote_app_id"] = app.id
            native_settings = None
            try:
                native_settings = await proxy.settings({"schema": 1, "operation": "prepare-launch"})
                if not native_settings.get("ok"):
                    raise PyrolightListError("failed", str(native_settings.get("error")))
            except PyrolightListError as error:
                if error.reason != "outdated":
                    raise
                logger.warning("Legacy Pyrolight: update for authoritative profiles and Quick Access settings")
            capabilities = None
            if native_settings or needs_capability_probe(settings["cmd_options"]):
                capabilities = await proxy.probe_capabilities()
            options = None if native_settings else settings["cmd_options"]
            target = settings["host_id"] if native_settings else pyrolight_host(settings["address"], settings["host_port"])
            args = build_stream_args(target, app.name, options, capabilities,
                                     app_id=app.id if capabilities and capabilities.app_id else None)
            if settings.get("terminate_app_id"):
                # A confirmed switch is one-shot: suspend/reconnect must never
                # replay an authorization to terminate an earlier application.
                if not capabilities or not capabilities.conditional_switch:
                    raise RunnerError(Result.PyrolightOutdated, "Update Pyrolight to switch games safely.")
                if server_info["conditionalCancel"] < 1:
                    raise RunnerError(Result.HostWithoutConditionalCancel)
                args = ["--terminate-app-id", str(settings.pop("terminate_app_id")), *args]
            if native_settings:
                # The profile owns every stream preference. Only lifecycle safety
                # is overridden: disconnect never requests host termination.
                args = ["--no-quit-after", "--integration-events", "--settings-revision", native_settings["revision"], *args]
            if generation:
                current = sessionstate.read()
                attempt = current.get("attempt", 0) + 1
                sessionstate.update(generation, state="launching", appName=app.name, remoteAppId=app.id,
                                    attempt=attempt, error=None, quality=None, stage="starting_client",
                                    window=None, lastLifecycle=None, streamConfirmed=False,
                                    launchPreferences=native_settings,
                                    effectivePreferences=current.get("effectivePreferences"))
                def on_event(event):
                    observed = sessionstate.read()
                    if observed.get("generation") != generation or observed.get("attempt") != attempt:
                        return
                    state = event.get("state")
                    if state == "awaiting_confirmation":
                        sessionstate.update(generation, stage="awaiting_confirmation", lastLifecycle=state)
                        return
                    if state == "window":
                        sessionstate.update(generation, window=event.get("window"), lastLifecycle=state)
                        return
                    if state == "transport_ready":
                        sessionstate.update(generation, stage="starting_window", lastLifecycle=state)
                        return
                    if event.get("state") == "quality" and event.get("quality") in ("good", "poor"):
                        sessionstate.update(generation, quality=event["quality"])
                        return
                    if event.get("state") not in ("connecting", "launching", "streaming", "disconnected", "failed"):
                        return
                    if event["state"] == "disconnected" and sessionstate.read().get("state") == "failed":
                        return
                    changes = {"state": event["state"], "error": event.get("error") or None,
                               "lastLifecycle": event["state"], "stage": observed.get("stage") if event["state"] == "failed" else event["state"]}
                    if "window" in event:
                        changes["window"] = event["window"]
                    if event["state"] == "streaming":
                        window = event.get("window") or {}
                        # Older clients report transport readiness before creating
                        # a window. Keep it observable without claiming presentation.
                        if not (window.get("shown") and window.get("rendererReady")):
                            sessionstate.update(generation, stage="window_unverified", lastLifecycle="streaming")
                            return
                        changes["streamConfirmed"] = True
                        changes["effectivePreferences"] = native_settings
                        changes["diagnostics"] = event.get("diagnostics")
                        changes["displayBackend"] = event.get("displayBackend")
                        history.record(settings["host_id"], app.id)
                    sessionstate.update(generation, **changes)
                proxy.on_event = on_event
            if generation and (native_settings or {}).get("capabilities", {}).get("windowReadiness"):
                import asyncio
                async def watch_startup():
                    remaining = float(WINDOW_READY_TIMEOUT)
                    while remaining > 0:
                        observed = sessionstate.read()
                        if observed.get("state") in ("streaming", "failed"):
                            return
                        await asyncio.sleep(0.1)
                        if observed.get("stage") != "awaiting_confirmation":
                            remaining -= 0.1
                    raise TimeoutError()
                client = asyncio.create_task(cls.run_pyrolight(proxy, args))
                ready = asyncio.create_task(watch_startup())
                try:
                    await asyncio.wait({client, ready}, return_when=asyncio.FIRST_COMPLETED)
                    if ready.done():
                        try:
                            await ready
                            if sessionstate.read().get("state") == "failed":
                                raise RunnerError(Result.PyrolightFailed, sessionstate.read().get("error"))
                        except TimeoutError as error:
                            raise RunnerError(Result.PyrolightFailed, "Pyrolight did not confirm a visible window and renderer within 60 seconds. See Troubleshooting & Diagnostics.") from error
                    await client
                    observed = sessionstate.read()
                    if not observed.get("streamConfirmed") and observed.get("state") != "failed":
                        raise RunnerError(Result.PyrolightFailed, "Pyrolight closed before confirming its streaming window. Update Pyrolight if window readiness is unavailable; see its log for initialization errors.")
                finally:
                    client.cancel()
                    ready.cancel()
                    await asyncio.gather(client, ready, return_exceptions=True)
            else:
                await cls.run_pyrolight(proxy, args)
            if generation and sessionstate.read().get("state") == "failed":
                raise RunnerError(Result.PyrolightFailed, sessionstate.read().get("error"))
