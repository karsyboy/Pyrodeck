"""Pyrolight, the streaming client PyroDeck launches.

PyroDeck never speaks GameStream itself: pairing, the app list, streaming and
quitting a host app all go through Pyrolight's command line, which uses
Pyrolight's own pairing credentials. PyroDeck only reads what `pyrolight list
--json` prints and supervises the processes it starts.

Process ownership: a proxy starts at most one Pyrolight process and only ever
signals that process and its descendants (identified by PID and start time,
so a reused PID is never hit). Other Pyrolight or Moonlight instances on the
device are left alone.
"""

import contextlib

from dataclasses import dataclass, field
from typing import Optional, TypedDict

from .logger import logger
from . import constants


class ResolutionSize(TypedDict):
    width: int
    height: int


class ResolutionDimensions(TypedDict):
    size: Optional[ResolutionSize]
    bitrate: Optional[int]
    fps: Optional[int]
    hdr: Optional[bool]


class CommandLineOptions(TypedDict):
    audio: Optional[str]
    resolution: Optional[ResolutionDimensions]
    quit_after: Optional[bool]
    show_performance_stats: Optional[bool]
    enable_v_sync: Optional[bool]
    enable_frame_pacing: Optional[bool]
    enable_vrr: Optional[bool]
    video_codec: Optional[str]


# PyroDeck's codec names to Pyrolight's `--video-codec` choices.
VIDEO_CODEC_CHOICES = {
    "Auto": "auto",
    "H.264": "H.264",
    "HEVC": "HEVC",
    "AV1": "AV1",
    "PyroWave": "PyroWave",
}

# Where a Pyrolight AppImage is usually kept on a Steam Deck, newest first.
APPIMAGE_DIRECTORIES = ["~/Applications", "~/AppImages", "~/Downloads", "~"]


class PyrolightListError(Exception):
    """`pyrolight list` failed; `reason` is "not_paired", "unreachable", "outdated" or "failed"."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


@dataclass
class HostApp:
    name: str
    id: int
    hdr_supported: bool = False
    sources: list[str] = field(default_factory=list)


@dataclass
class HostAppList:
    host_name: str
    host_uuid: str
    apps: list[HostApp]


@dataclass
class Capabilities:
    """What the installed Pyrolight build accepts, from `pyrolight stream --help`."""
    video_codecs: set[str]
    vrr: bool
    app_id: bool = False


DEFAULT_HTTP_PORT = 47989


def pyrolight_host(address: str, port: int) -> str:
    """The host argument for Pyrolight: the address, with the HTTP port when it is not the default.

    Pyrolight matches it against the hosts it knows by `address:port` and adds
    an unknown one manually the same way.
    """
    if port == DEFAULT_HTTP_PORT:
        return address
    if ":" in address and not address.startswith("["):
        return f"[{address}]:{port}"
    return f"{address}:{port}"


def is_executable_file(path: str) -> bool:
    import os

    return os.path.isfile(path) and os.access(path, os.X_OK)


def find_pyrolight(configured_path: Optional[str]) -> Optional[str]:
    """The Pyrolight executable to use, or None.

    A configured path is used as is (and only if it is an executable file),
    so a wrong setting is reported rather than silently replaced. Otherwise:
    `pyrolight` on PATH (distribution packages), then the newest
    `Pyrolight*.AppImage` in the usual download locations.
    """
    import glob
    import os
    import shutil

    if configured_path:
        return configured_path if is_executable_file(configured_path) else None

    on_path = shutil.which("pyrolight")
    if on_path:
        return on_path

    candidates: list[str] = []
    for directory in APPIMAGE_DIRECTORIES:
        directory = os.path.expanduser(directory)
        for pattern in ("[Pp]yrolight*.AppImage", "[Pp]yrolight*.appimage"):
            candidates.extend(glob.glob(os.path.join(directory, pattern)))
    candidates = [path for path in candidates if is_executable_file(path)]
    if not candidates:
        return None
    return max(candidates, key=lambda path: os.stat(path).st_mtime)


def parse_app_list(output: bytes | str) -> HostAppList:
    """Parse `pyrolight list --json`. Raises ValueError on anything unexpected."""
    import json

    if isinstance(output, bytes):
        output = output.decode("utf-8", errors="replace")

    # The JSON document is the last non-empty line; anything before it is
    # diagnostic output some builds print to stdout.
    lines = [line for line in output.splitlines() if line.strip()]
    if not lines:
        raise ValueError("empty app list output")
    data = json.loads(lines[-1])
    if not isinstance(data, dict) or data.get("schema") != 1:
        raise ValueError(f"unsupported app list schema: {data.get('schema') if isinstance(data, dict) else data!r}")

    host = data.get("host")
    apps = data.get("apps")
    if not isinstance(host, dict) or not isinstance(apps, list):
        raise ValueError("app list without host or apps")

    parsed: list[HostApp] = []
    for app in apps:
        if not isinstance(app, dict) or not isinstance(app.get("name"), str) or not isinstance(app.get("id"), int):
            raise ValueError(f"invalid app entry: {app!r}")
        sources = app.get("sources", [])
        if not isinstance(sources, list) or not all(isinstance(source, str) for source in sources):
            raise ValueError(f"invalid sources for {app['name']!r}")
        parsed.append(HostApp(name=app["name"],
                              id=app["id"],
                              hdr_supported=bool(app.get("hdrSupported", False)),
                              sources=sources))

    return HostAppList(host_name=str(host.get("name", "")), host_uuid=str(host.get("uuid", "")), apps=parsed)


def parse_capabilities(help_text: str) -> Capabilities:
    """Read the codec choices and VRR support from `pyrolight stream --help`.

    Qt wraps the help text, so the codec list is read from everything after
    "Select video codec:" up to the next option.
    """
    import re

    flattened = " ".join(help_text.split())
    codecs: set[str] = set()
    # The sentence ends at a period followed by whitespace ("H.264" has one inside).
    match = re.search(r"Select video codec:\s*(.+?)\.(?:\s|$)", flattened)
    if match:
        codecs = {choice.strip() for choice in match.group(1).split("/") if choice.strip()}
    vrr = re.search(r"(^|\s)--vrr(\s|$)", flattened) is not None
    return Capabilities(video_codecs=codecs, vrr=vrr, app_id="--app-id" in flattened)


def build_stream_args(host: str, app_name: str, options: Optional[CommandLineOptions],
                      capabilities: Optional[Capabilities] = None, app_id: Optional[int] = None) -> list[str]:
    """Arguments for `pyrolight [options] stream HOST APP`, as an argv list.

    Options a probed build does not accept are left out (logged), so an
    unsupported setting falls back to Pyrolight's own default instead of
    failing the launch. Without a probe, only options every Pyrolight build
    has are emitted; VRR and non-default codecs need a probe.
    """
    args: list[str] = []
    if app_id is not None:
        if type(app_id) is not int or app_id <= 0:
            raise ValueError("Invalid GameStream application ID")
        args += ["--app-id", str(app_id)]

    if options:
        if (audio := options["audio"]) is not None:
            args += ["--audio-config", audio]

        if (resolution := options["resolution"]) is not None:
            if resolution["size"]:
                args += ["--resolution", f"{resolution['size']['width']}x{resolution['size']['height']}"]
            if resolution["fps"]:
                args += ["--fps", f"{resolution['fps']}"]
            if resolution["hdr"] is not None:
                args += ["--hdr" if resolution["hdr"] else "--no-hdr"]
            if resolution["bitrate"]:
                args += ["--bitrate", f"{resolution['bitrate']}"]

        if (quit_after := options["quit_after"]) is not None:
            args += ["--quit-after" if quit_after else "--no-quit-after"]

        if (show_performance_stats := options["show_performance_stats"]) is not None:
            args += ["--performance-overlay" if show_performance_stats else "--no-performance-overlay"]

        if (enable_v_sync := options["enable_v_sync"]) is not None:
            args += ["--vsync" if enable_v_sync else "--no-vsync"]

        if (enable_frame_pacing := options["enable_frame_pacing"]) is not None:
            args += ["--frame-pacing" if enable_frame_pacing else "--no-frame-pacing"]

        if (enable_vrr := options["enable_vrr"]) is not None:
            if capabilities is not None and capabilities.vrr:
                args += ["--vrr" if enable_vrr else "--no-vrr"]
            else:
                logger.warning("This Pyrolight build has no VRR option; using its default.")

        if (video_codec := options["video_codec"]) is not None:
            choice = VIDEO_CODEC_CHOICES.get(video_codec)
            if choice is None:
                logger.warning(f"Unknown video codec setting {video_codec!r}; using Pyrolight's default.")
            elif choice == "auto":
                args += ["--video-codec", choice]
            elif capabilities is not None and choice in capabilities.video_codecs:
                args += ["--video-codec", choice]
            else:
                logger.warning(f"This Pyrolight build does not offer the {video_codec} codec; using its default.")

    args += ["stream", host] if app_id is not None else ["stream", host, app_name]
    return args


def needs_capability_probe(options: Optional[CommandLineOptions]) -> bool:
    if not options:
        return False
    return options["enable_vrr"] is not None or options["video_codec"] not in (None, "Auto")


def classify_list_failure(stderr: str) -> PyrolightListError:
    text = stderr.strip()
    lowered = text.lower()
    if "no qt platform plugin could be initialized" in lowered or "could not find the qt platform plugin" in lowered:
        return PyrolightListError("client_error", "Pyrolight crashed while initializing a display. "
                                  "Install the updated Pyrolight AppImage with headless catalog support, "
                                  "then check its path in Hosts & Pairing and refresh games.")
    if "has not been paired" in lowered:
        return PyrolightListError("not_paired", text)
    if "failed to connect" in lowered:
        return PyrolightListError("unreachable", text)
    if "unknown option" in lowered and "json" in lowered:
        # Pyrolight before `list --json`.
        return PyrolightListError("outdated", text)
    return PyrolightListError("failed", text or "pyrolight list failed")


class PyrolightProxy(contextlib.AbstractAsyncContextManager):
    def __init__(self, exec_path: str) -> None:
        # Lazy import to improve CLI performance
        from asyncio.subprocess import Process
        from . import utils

        self.exec_path = exec_path
        self.process: Optional[Process] = None
        self.__reaper: Optional[utils.ProcessReaper] = None
        self.on_event = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return await self.terminate()

    async def __run_to_completion(self, args: list[str], timeout: float) -> tuple[int, bytes, bytes]:
        """Run a short-lived Pyrolight command; kill it (and only it) on timeout or cancellation."""
        import asyncio
        from . import utils

        logger.info(f"Executing: {self.exec_path} {' '.join(args)}")
        process = await utils.create_subprocess_exec(self.exec_path, *args, separate_stderr=True)
        reaper = utils.ProcessReaper(process.pid)
        try:
            async with asyncio.timeout(timeout):
                stdout, stderr = await process.communicate()
        except BaseException:
            reaper.send_kill()
            with contextlib.suppress(ProcessLookupError):
                await process.wait()
            raise
        assert process.returncode is not None
        return process.returncode, stdout, stderr

    async def list_apps(self, host: str, timeout: float = 45) -> HostAppList:
        """The host's apps as Pyrolight sees them, with Pyroshine's launcher identities."""
        returncode, stdout, stderr = await self.__run_to_completion(["list", "--json", host], timeout)
        if returncode != 0:
            error = classify_list_failure(stderr.decode(errors="replace"))
            logger.error(f"pyrolight list failed ({returncode}): {error}")
            raise error
        try:
            return parse_app_list(stdout)
        except ValueError as err:
            logger.error(f"Unexpected pyrolight list output: {err}")
            raise PyrolightListError("failed", "Pyrolight printed an app list PyroDeck cannot read. "
                                     "Update Pyrolight.") from err

    async def settings(self, request: dict | None = None, timeout: float = 15) -> dict:
        """Use Pyrolight's settings owner; never edit its Qt settings files."""
        import json
        args = ["settings"]
        if request is not None:
            args += ["--json", json.dumps(request, separators=(",", ":"))]
        code, stdout, stderr = await self.__run_to_completion(args, timeout)
        try:
            result = json.loads(stdout.splitlines()[-1])
            if not isinstance(result, dict) or result.get("schema") != 1 or not isinstance(result.get("ok"), bool):
                raise ValueError("Unsupported settings response")
        except (ValueError, IndexError) as error:
            raise PyrolightListError("outdated", "Update Pyrolight: its settings API is unavailable.") from error
        if code != 0 and result["ok"]:
            raise PyrolightListError("failed", stderr.decode(errors="replace") or "Settings command failed")
        return result

    async def artwork(self, host: str, app_id: int, timeout: float = 12) -> dict:
        import json
        code, stdout, _ = await self.__run_to_completion(["list", "--json", "--artwork-id", str(app_id), host], timeout)
        if code != 0:
            raise PyrolightListError("artwork", "Artwork is unavailable")
        value = json.loads(stdout.splitlines()[-1])
        if value.get("schema") != 1 or value.get("appId") != app_id:
            raise ValueError("Invalid artwork response")
        return value

    async def network_tool(self, host: str, action: str, timeout: float = 120) -> dict:
        import json
        if action not in ("check", "calibrate", "fix"):
            raise ValueError("Unknown network action")
        code, stdout, _ = await self.__run_to_completion(["list", "--json", "--network-action", action, host], timeout)
        if code != 0:
            raise PyrolightListError("network", "Pyrolight network tool failed")
        value = json.loads(stdout.splitlines()[-1])
        if value.get("schema") != 1 or value.get("action") != action:
            raise ValueError("Invalid network tool response")
        return value

    async def probe_capabilities(self, timeout: float = 20) -> Optional[Capabilities]:
        try:
            returncode, stdout, stderr = await self.__run_to_completion(["stream", "--help"], timeout)
        except TimeoutError:
            logger.warning("pyrolight stream --help timed out")
            return None
        if returncode != 0:
            logger.warning(f"pyrolight stream --help exited with {returncode}")
            return None
        return parse_capabilities((stdout + b"\n" + stderr).decode(errors="replace"))

    async def start(self, args: list[str]):
        # Lazy import to improve CLI performance
        from . import utils

        assert self.process is None, "This proxy has already started Pyrolight!"
        logger.info(f"Executing: {self.exec_path} {' '.join(args)}")
        self.process = await utils.create_subprocess_exec(self.exec_path, *args)
        self.__reaper = utils.ProcessReaper(self.process.pid)
        record_client_process(self.process.pid)

    async def terminate(self):
        # Lazy import to improve CLI performance
        import asyncio

        if self.process is None:
            return

        assert self.__reaper is not None
        try:
            if self.process.returncode is None:
                logger.info("Trying to gracefully terminate Pyrolight...")
                self.__reaper.send_terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=5.0)
                    logger.info("Pyrolight terminated gracefully.")
                except asyncio.TimeoutError:
                    logger.info("Pyrolight did not terminate in time - killing it!")
                    self.__reaper.send_kill()
                    await self.process.wait()
        except ProcessLookupError:
            pass
        finally:
            self.process = None
            self.__reaper = None
            clear_client_process()

    async def wait(self) -> Optional[int]:
        """Wait for the started process to exit, saving its output. Returns its exit code."""
        # Lazy import to improve CLI performance
        import asyncio

        if not self.process:
            return None

        async def log_stream(stream: Optional[asyncio.StreamReader]):
            if not stream:
                logger.error("NULL Pyrolight stream handle - output will not be saved!")
                return

            logger.info("Starting to save Pyrolight output.")
            with open(constants.PYROLIGHT_LOG_FILE, "w", 1) as file:
                while not stream.at_eof():
                    data = await stream.readline()
                    if data.startswith(b"PYROLIGHT_EVENT ") and self.on_event is not None:
                        import json
                        try:
                            event = json.loads(data[len(b"PYROLIGHT_EVENT "):])
                            if event.get("schema") == 1:
                                self.on_event(event)
                        except (ValueError, AttributeError):
                            logger.warning("Invalid Pyrolight lifecycle event")
                    file.write(data.decode(errors="replace"))
            logger.info("Finished saving Pyrolight output.")

        process_task = asyncio.create_task(self.process.wait())
        log_task = asyncio.create_task(log_stream(self.process.stdout))
        # Cancellation also stops the log reader before a resumed attempt can
        # reuse its file and lifecycle callback.
        await asyncio.gather(process_task, log_task)
        return self.process.returncode


def record_client_process(pid: int):
    """Remember the started client so the backend can stop it if the runner dies."""
    from .utils import ProcessReaper

    start_time = ProcessReaper.start_time(pid)
    if start_time is None:
        return
    with open(constants.RUNNER_CLIENT_FILE, "w") as file:
        file.write(f"{pid} {start_time}")


def clear_client_process():
    import os

    with contextlib.suppress(FileNotFoundError):
        os.remove(constants.RUNNER_CLIENT_FILE)


def read_client_process() -> Optional[tuple[int, int]]:
    try:
        with open(constants.RUNNER_CLIENT_FILE, "r") as file:
            pid, start_time = file.read().split()
            return int(pid), int(start_time)
    except (FileNotFoundError, ValueError):
        return None
