"""Read-only, bounded diagnostics; never expose pairing stores or environment dumps."""
import re
from pathlib import Path
from . import constants, runnercontrol
from .pyrolightproxy import read_client_process
from .utils import ProcessReaper

LOGS = {
    "frontend": constants.FRONTEND_LOG_FILE,
    "backend": constants.BACKEND_LOG_FILE,
    "runner": constants.RUNNER_LOG_FILE,
    "pyrolight": constants.PYROLIGHT_LOG_FILE,
}


def redact(text):
    text = re.sub(r"-----BEGIN .*?-----.*?-----END .*?-----", "[redacted key/certificate]", text, flags=re.S)
    return "\n".join("[redacted sensitive log line]" if re.search(
        r"password|passwd|secret|certificate|private.?key|client.?key|pairing.?pin|authorization|token=|rikey|clientcert|servercert", line, re.I)
        else line for line in text.splitlines())


def log_tail(name):
    if name not in LOGS:
        raise ValueError("Unknown log")
    path = Path(LOGS[name])
    try:
        with path.open("rb") as source:
            source.seek(0, 2)
            source.seek(max(0, source.tell() - 32768))
            text = source.read(32768).decode(errors="replace")
        return {"path": str(path), "text": redact(text)}
    except FileNotFoundError:
        return {"path": str(path), "text": "No log recorded yet."}


def processes():
    client = read_client_process()
    return {"runnerActive": runnercontrol.is_runner_active(),
            "clientPid": client[0] if client and ProcessReaper.start_time(client[0]) == client[1] else None}
