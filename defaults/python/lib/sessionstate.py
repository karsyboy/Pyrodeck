"""Versioned runner observations, scoped to one runner generation and launch attempt."""

import json
import os
import time
import uuid
import fcntl
from contextlib import contextmanager
from pathlib import Path
from . import constants


def read() -> dict:
    try:
        value = json.loads(Path(constants.SESSION_STATE_FILE).read_text())
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
        _write({**current, **changes, "updatedAt": time.time()})


def begin(settings: dict) -> str:
    generation = uuid.uuid4().hex
    with _locked():
        _write({"schema": 1, "generation": generation, "attempt": 0, "state": "connecting",
                "hostId": settings["host_id"], "hostName": settings["hostname"],
                "appName": settings.get("app_name"), "steamAppId": settings.get("steam_app_id"),
                "remoteAppId": settings.get("remote_app_id"), "stage": "connecting",
                "updatedAt": time.time()})
    return generation


@contextmanager
def _locked():
    fd = os.open(constants.SESSION_STATE_FILE + ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _write(value: dict):
    path = Path(constants.SESSION_STATE_FILE)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
