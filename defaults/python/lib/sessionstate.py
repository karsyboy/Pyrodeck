"""Versioned runner observations, scoped to one runner generation and launch attempt."""

import json
import time
import uuid
import fcntl
from contextlib import contextmanager
from . import constants, runtimefiles


def read() -> dict:
    try:
        value = json.loads(runtimefiles.read_text(constants.SESSION_STATE_FILE) or "null")
        if value.get("schema") == 1:
            return value
    except (OSError, ValueError, AttributeError):
        pass
    return {"schema": 1, "state": "none"}


def update(generation: str, **changes):
    with _locked():
        current = read()
        if current.get("generation") != generation:
            return
        # Repeated quality/window notifications are observations, not changes.
        # Avoid replacing the status file (and waking readers) for each one.
        if all(key in current and current[key] == value for key, value in changes.items()):
            return
        _write({**current, **changes, "updatedAt": time.time()})


def begin(settings: dict) -> str:
    """Start a runner generation; it records what the frontend needs to reattach after a reload."""
    import os

    generation = uuid.uuid4().hex
    kind = settings.get("runner_type")
    with _locked():
        _write({"schema": 1, "generation": generation, "attempt": 0, "state": "connecting",
                "hostId": settings["host_id"], "hostName": settings["hostname"],
                "appName": settings.get("app_name"), "steamAppId": settings.get("steam_app_id"),
                "remoteAppId": settings.get("remote_app_id"), "stage": "connecting",
                # The launch variant (the shortcut's PYRODECK_APP_TYPE) and the
                # Steam game ID of the shortcut that started this runner.
                "launchKind": kind.value if kind is not None else None,
                "launcherGameId": os.environ.get("SteamGameId") or None,
                "updatedAt": time.time()})
    return generation


@contextmanager
def _locked():
    with runtimefiles.open_file(constants.SESSION_STATE_FILE + ".lock", "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _write(value: dict):
    runtimefiles.write_atomic(constants.SESSION_STATE_FILE, json.dumps(value))
