"""Bounded local history of sessions confirmed by Pyrolight's connection event."""

import json
import os
import time
import uuid
from pathlib import Path
from . import constants
from .logger import logger


def path() -> Path:
    return Path(constants.get_config_file_path()).with_name("recent-games.json")


def read() -> dict:
    try:
        value = json.loads(path().read_text())
        if isinstance(value, dict):
            return {key: timestamp for key, timestamp in value.items() if isinstance(key, str) and type(timestamp) in (int, float) and timestamp > 0}
    except (OSError, ValueError):
        pass
    return {}


def record(host_id: str, app_id: int):
    values = read()
    values[f"{host_id}:{app_id}"] = time.time()
    values = dict(sorted(values.items(), key=lambda item: item[1], reverse=True)[:200])
    target = path()
    temporary = target.with_name(target.name + "." + uuid.uuid4().hex)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(values, output)
        os.replace(temporary, target)
    except OSError:
        logger.warning("Could not save recently played history")
    finally:
        temporary.unlink(missing_ok=True)
