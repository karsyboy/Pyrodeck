import os
from . import constants

from enum import Enum
from typing import Optional
from .logger import logger


class Result(Enum):
    ClosedPrematurely = "PyroDeck runner closed prematurely!"
    RunnerNotReady = "PyroDeck has not finished loading!"
    NoSettings = "Failed to read PyroDeck settings!"
    NoAppId = "Failed to parse app id!"
    NoAppName = "Failed to parse app name!"
    NoAction = "Failed to parse the requested action!"
    NoRunnerType = "Failed to parse runner type!"
    HostNotSelected = "Host is not selected!"
    Exception = "Unhandled exception!"
    GameStreamDead = "The host is not responding!"
    WrongHost = "Pyrolight reached a different host than the one selected in PyroDeck!"
    PyrolightIsNotInstalled = "Pyrolight was not found! Install the Pyrolight AppImage or set its path in PyroDeck's settings."
    PyrolightNotPaired = "Pyrolight is not paired with this host! Pair it from PyroDeck's Host Selection page."
    PyrolightCannotReachHost = "Pyrolight cannot reach the host!"
    PyrolightListFailed = "Pyrolight could not read the host's app list!"
    PyrolightFailed = "Pyrolight exited unexpectedly! See /tmp/pyrodeck-runner-pyrolight.log."
    HostWithoutAppSources = "This host does not report Steam app IDs! Update Pyroshine on the host."
    HostAppNotFound = "This game is not available on the host! Install it there, or unhide it in Pyroshine's library."
    HostAppAmbiguous = "The host offers more than one app with this name!"
    Terminated = "TERMINATED"


class RunnerError(Exception):
    """A runner failure shown to the user; `detail` replaces the generic text when set."""

    def __init__(self, result: Enum, detail: Optional[str] = None):
        super().__init__(detail or result.value)
        self.result = result
        self.detail = detail

    @property
    def message(self) -> str:
        return self.detail or self.result.value


def set_result(result: Optional[Enum | RunnerError], log_result=True):
    try:
        if result:
            message = result.message if isinstance(result, RunnerError) else result.value
            assert isinstance(message, str), f"{message} is not a string!"
            with open(constants.RUNNER_RESULT_FILE, "w+") as file:
                file.write(message)
                if log_result:
                    logger.error(message)
        else:
            if os.path.exists(constants.RUNNER_RESULT_FILE):
                os.remove(constants.RUNNER_RESULT_FILE)
    except Exception:
        logger.exception("Unhandled exception")


def get_result():
    try:
        if os.path.exists(constants.RUNNER_RESULT_FILE):
            with open(constants.RUNNER_RESULT_FILE, "r") as file:
                return file.readline()

        return None
    except Exception:
        logger.exception("Unhandled exception")
        return "Expection while checking result!"
