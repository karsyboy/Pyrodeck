# PyroDeck keeps its own state, logs and settings so it can be installed next
# to the original MoonDeck plugin without either touching the other's files.


def _runtime_dir() -> str:
    """The user's private PyroDeck directory.

    The Decky backend and the Steam-launched runner run as the same user but
    with different environments, so the path depends only on the user ID:
    the login session's runtime directory when it exists and is private,
    otherwise a per-user directory in /tmp. lib.runtimefiles creates it and
    refuses it unless it is a directory owned by the user.
    """
    import os
    import stat

    uid = os.getuid()
    session = f"/run/user/{uid}"
    try:
        info = os.lstat(session)
        if stat.S_ISDIR(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o077:
            return f"{session}/pyrodeck"
    except OSError:
        pass
    return f"/tmp/pyrodeck-{uid}"


RUNTIME_DIR = _runtime_dir()
BACKEND_LOG_FILE = f"{RUNTIME_DIR}/backend.log"
FRONTEND_LOG_FILE = f"{RUNTIME_DIR}/frontend.log"
RUNNER_LOG_FILE = f"{RUNTIME_DIR}/runner.log"
PYROLIGHT_LOG_FILE = f"{RUNTIME_DIR}/runner-pyrolight.log"
RUNNER_RESULT_FILE = f"{RUNTIME_DIR}/runner.result"
RUNNER_READY_FILE = f"{RUNTIME_DIR}/runner-ready"
RUNNER_SUSPENDED_FILE = f"{RUNTIME_DIR}/runner-suspended"
# "<pid> <start time>" of the runner holding the lock on this file.
RUNNER_PID_FILE = f"{RUNTIME_DIR}/runner-pid"
# The Pyrolight process the runner started ("<pid> <start time> <token>"), so
# the backend can stop exactly that process if the runner itself is gone. The
# token is also in that process's environment as CLIENT_TOKEN_VARIABLE.
RUNNER_CLIENT_FILE = f"{RUNTIME_DIR}/runner-client"
CLIENT_TOKEN_VARIABLE = "PYRODECK_CLIENT_TOKEN"
SESSION_STATE_FILE = f"{RUNTIME_DIR}/session.json"
RUNNER_SUSPEND_CANCEL_MSG = "suspended"

def get_config_file_path():
    # Lazy import to improve CLI performance
    import pathlib

    return pathlib.Path.home() / ".config" / "pyrodeck" / "settings.json"


def get_moondeck_config_file_path():
    """The original MoonDeck plugin's settings: read once to seed PyroDeck's, never written."""
    import pathlib

    return pathlib.Path.home() / ".config" / "moondeck" / "settings.json"
