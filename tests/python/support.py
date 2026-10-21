"""Shared helpers for PyroDeck's Python tests.

Run from the repository root:

    python3 -m unittest discover -s tests/python -t tests/python
"""

import asyncio
import contextlib
import json
import os
import pathlib
import shutil
import stat
import sys
import tempfile
import unittest

REPOSITORY = pathlib.Path(__file__).resolve().parents[2]
PYTHON_ROOT = REPOSITORY / "defaults" / "python"
FAKE_PYROLIGHT = pathlib.Path(__file__).resolve().parent / "fakes" / "fake_pyrolight.py"

for directory in (PYTHON_ROOT, PYTHON_ROOT / "externals"):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

HOST_ID = "B1B2C3D4-0000-4000-8000-000000000001"


def isolate_state(test: unittest.TestCase) -> pathlib.Path:
    """Point every PyroDeck state file at a per-test directory."""
    import lib.constants as constants
    import lib.utils as utils

    directory = pathlib.Path(tempfile.mkdtemp(prefix="pyrodeck-test-"))
    test.addCleanup(shutil.rmtree, directory, ignore_errors=True)
    names = ["BACKEND_LOG_FILE", "FRONTEND_LOG_FILE", "RUNNER_LOG_FILE", "PYROLIGHT_LOG_FILE", "RUNNER_RESULT_FILE",
             "RUNNER_READY_FILE", "RUNNER_SUSPENDED_FILE", "RUNNER_PID_FILE", "RUNNER_CLIENT_FILE"]
    for name in names:
        path = str(directory / name.lower())
        for module in (constants, utils):
            if hasattr(module, name):
                original = getattr(module, name)
                setattr(module, name, path)
                test.addCleanup(setattr, module, name, original)
    return directory


class FakePyrolight:
    """Configures tests/python/fakes/fake_pyrolight.py for one test."""

    def __init__(self, test: unittest.TestCase):
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix="fake-pyrolight-"))
        test.addCleanup(shutil.rmtree, self.directory, ignore_errors=True)
        self.executable = self.directory / "Pyrolight-test.AppImage"
        shutil.copy(FAKE_PYROLIGHT, self.executable)
        self.executable.chmod(self.executable.stat().st_mode | stat.S_IXUSR)
        self.config: dict = {}
        self.write()

        previous = os.environ.get("FAKE_PYROLIGHT_DIR")
        os.environ["FAKE_PYROLIGHT_DIR"] = str(self.directory)
        test.addCleanup(self.__restore, previous)

    @staticmethod
    def __restore(previous):
        if previous is None:
            os.environ.pop("FAKE_PYROLIGHT_DIR", None)
        else:
            os.environ["FAKE_PYROLIGHT_DIR"] = previous

    def write(self):
        (self.directory / "config.json").write_text(json.dumps(self.config))

    def set_apps(self, apps: list[dict], host_uuid: str = HOST_ID, host_name: str = "SuperCube"):
        self.config["list"] = {
            "exit": 0,
            "stdout": json.dumps({"schema": 1, "host": {"name": host_name, "uuid": host_uuid}, "apps": apps}) + "\n",
        }
        self.write()

    def set(self, **values):
        self.config.update(values)
        self.write()

    def invocations(self) -> list[dict]:
        path = self.directory / "invocations.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def streams(self) -> list[list[str]]:
        return [entry["argv"] for entry in self.invocations() if "stream" in entry["argv"] and "--help" not in entry["argv"]]


class FakeHost:
    """A minimal GameStream HTTP endpoint answering /serverinfo."""

    def __init__(self, unique_id: str = HOST_ID, hostname: str = "SuperCube", app_sources: int | None = 1):
        self.unique_id = unique_id
        self.hostname = hostname
        self.app_sources = app_sources
        self.requests: list[str] = []
        self.server: asyncio.base_events.Server | None = None
        self.port = 0

    async def __aenter__(self):
        self.server = await asyncio.start_server(self.__handle, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *args):
        assert self.server is not None
        self.server.close()
        await self.server.wait_closed()

    async def __handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        request = await reader.readuntil(b"\r\n\r\n")
        path = request.split(b" ")[1].decode()
        self.requests.append(path)
        sources = "" if self.app_sources is None else f"<PyroshineAppSources>{self.app_sources}</PyroshineAppSources>"
        body = (f"<root status_code=\"200\"><hostname>{self.hostname}</hostname><uniqueid>{self.unique_id}</uniqueid>"
                f"{sources}<currentgame>0</currentgame><state>MOONSHINE_SERVER_FREE</state></root>").encode()
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nConnection: close\r\n"
                     + f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
        await writer.drain()
        writer.close()


@contextlib.contextmanager
def record_connections():
    """Record every (host, port) the event loop connects to.

    aiohttp connects sockets itself (aiohappyeyeballs, `sock_connect`) and
    hands them to `create_connection(sock=...)`, so both are recorded.
    """
    connections: list[tuple[str, int]] = []
    original_create = asyncio.BaseEventLoop.create_connection
    original_sock_connect = asyncio.selector_events.BaseSelectorEventLoop.sock_connect

    async def recording_create(self, protocol_factory, host=None, port=None, *args, **kwargs):
        if host is not None or port is not None:
            connections.append((host, port))
        return await original_create(self, protocol_factory, host, port, *args, **kwargs)

    async def recording_sock_connect(self, sock, address):
        connections.append((address[0], address[1]))
        return await original_sock_connect(self, sock, address)

    asyncio.BaseEventLoop.create_connection = recording_create  # type: ignore[method-assign]
    asyncio.selector_events.BaseSelectorEventLoop.sock_connect = recording_sock_connect  # type: ignore[method-assign]
    try:
        yield connections
    finally:
        asyncio.BaseEventLoop.create_connection = original_create  # type: ignore[method-assign]
        asyncio.selector_events.BaseSelectorEventLoop.sock_connect = original_sock_connect  # type: ignore[method-assign]


def process_alive(pid: int) -> bool:
    try:
        with open(f"/proc/{pid}/stat") as file:
            state = file.read().rsplit(")", 1)[1].split()[0]
        return state not in ("Z", "X")
    except FileNotFoundError:
        return False
