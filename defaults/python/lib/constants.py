# PyroDeck keeps its own state, logs and settings so it can be installed next
# to the original MoonDeck plugin without either touching the other's files.
BACKEND_LOG_FILE = "/tmp/pyrodeck-backend.log"
FRONTEND_LOG_FILE = "/tmp/pyrodeck-frontend.log"
RUNNER_LOG_FILE = "/tmp/pyrodeck-runner.log"
PYROLIGHT_LOG_FILE = "/tmp/pyrodeck-runner-pyrolight.log"
RUNNER_RESULT_FILE = "/tmp/pyrodeck-runner.result"
RUNNER_READY_FILE = "/tmp/pyrodeck-runner-ready"
RUNNER_SUSPENDED_FILE = "/tmp/pyrodeck-runner-suspended"
RUNNER_PID_FILE = "/tmp/pyrodeck-runner-pid"
# The Pyrolight process the runner started ("<pid> <start time>"), so the
# backend can stop exactly that process if the runner itself is gone.
RUNNER_CLIENT_FILE = "/tmp/pyrodeck-runner-client"
SESSION_STATE_FILE = "/tmp/pyrodeck-session.json"
RUNNER_SUSPEND_CANCEL_MSG = "suspended"

def get_config_file_path():
    # Lazy import to improve CLI performance
    import pathlib

    return pathlib.Path.home() / ".config" / "pyrodeck" / "settings.json"


def get_moondeck_config_file_path():
    """The original MoonDeck plugin's settings: read once to seed PyroDeck's, never written."""
    import pathlib

    return pathlib.Path.home() / ".config" / "moondeck" / "settings.json"
