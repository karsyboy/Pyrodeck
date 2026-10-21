import os

from enum import Enum
from typing import Optional, TypedDict
from ..logger import logger


class RunnerType(Enum):
    # A Steam game, found on the host by its Steam app ID.
    SteamApp = 0
    # A host app synced into Steam by name (GameStream Apps).
    GameStreamApp = 1
    # A Pyrolight action that needs a window: pairing or quitting the host app.
    Utility = 2


class UtilityAction(Enum):
    Pair = "pair"
    Quit = "quit"


class AutoResolution(TypedDict):
    width: int
    height: int


class EnvSettings(TypedDict):
    auto_resolution: Optional[AutoResolution]
    linked_audio: Optional[str]
    linked_display: Optional[str]
    app_id: Optional[str]
    app_name: Optional[str]
    action: Optional[UtilityAction]
    runner_type: Optional[RunnerType]


# The variables PyroDeck puts in its shortcuts' launch options. They are
# prefixed so they never collide with the original MoonDeck plugin's.
APP_TYPE = "PYRODECK_APP_TYPE"
AUTO_RES = "PYRODECK_AUTO_RES"
LINKED_AUDIO = "PYRODECK_LINKED_AUDIO"
LINKED_DISPLAY = "PYRODECK_LINKED_DISPLAY"
STEAM_APP_ID = "PYRODECK_STEAM_APP_ID"
APP_NAME = "PYRODECK_APP_NAME"
ACTION = "PYRODECK_ACTION"


def get_auto_resolution() -> Optional[AutoResolution]:
    value = os.environ.get(AUTO_RES)
    try:
        if value is None:
            return None

        value = str(value).split("x")
        return {"width": int(value[0]), "height": int(value[1])}
    except:
        logger.exception("While getting auto resolution")
        return None


def get_linked_audio() -> Optional[str]:
    return os.environ.get(LINKED_AUDIO)


def get_linked_display() -> Optional[str]:
    return os.environ.get(LINKED_DISPLAY)


def get_app_id() -> Optional[str]:
    value = os.environ.get(STEAM_APP_ID)
    # A Steam app ID is a positive integer; anything else is not an identity.
    if value is None or not value.isdigit() or int(value) <= 0:
        return None
    return value


def get_app_name() -> Optional[str]:
    return os.environ.get(APP_NAME) or None


def get_action() -> Optional[UtilityAction]:
    value = os.environ.get(ACTION)
    try:
        return UtilityAction(value) if value is not None else None
    except ValueError:
        logger.error(f"Unknown runner action: {value}")
        return None


def get_runner_type() -> Optional[RunnerType]:
    app_type = os.environ.get(APP_TYPE)
    try:
        return RunnerType(int(app_type)) if app_type is not None else None
    except ValueError:
        logger.exception("While getting app type")
        return None


def parse_env_settings() -> EnvSettings:
    return {
        "auto_resolution": get_auto_resolution(),
        "linked_audio": get_linked_audio(),
        "linked_display": get_linked_display(),
        "app_id": get_app_id(),
        "app_name": get_app_name(),
        "action": get_action(),
        "runner_type": get_runner_type()
    }
