import asyncio
import os
import subprocess
import sys
import tempfile
import unittest

import support
from support import HOST_ID, FakeHost, FakePyrolight, isolate_state, process_alive, record_connections

from lib.runner.envparser import RunnerType, UtilityAction
from lib.runner.pyroshinerunner import PyroshineRunner
from lib.runnerresult import Result, RunnerError
from lib.pyrolightproxy import CommandLineOptions, read_client_process

VALHEIM = {"name": "Valheim", "id": 1001, "hdrSupported": True, "sources": ["steam:892970"]}
PORTAL = {"name": "Portal 2", "id": 1002, "hdrSupported": True, "sources": ["steam:620"]}
DESKTOP = {"name": "Desktop", "id": 1003, "hdrSupported": False, "sources": []}


def options(**overrides) -> CommandLineOptions:
    values: dict = {
        "audio": None,
        "resolution": {"size": {"width": 1280, "height": 800}, "bitrate": None, "fps": 60, "hdr": None},
        "quit_after": False,
        "show_performance_stats": None,
        "enable_v_sync": None,
        "enable_frame_pacing": None,
        "enable_vrr": None,
        "video_codec": None,
    }
    values.update(overrides)
    return CommandLineOptions(values)  # type: ignore[typeddict-item]


def settings(port: int, exec_path: str, *, runner_type=RunnerType.SteamApp, steam_app_id=892970, app_name=None,
             action=None, cmd_options=None, host_id=HOST_ID, wake_on_lan=0):
    return {
        "runner_type": runner_type,
        "cmd_options": cmd_options or options(),
        "steam_app_id": steam_app_id if runner_type == RunnerType.SteamApp else None,
        "app_name": app_name,
        "action": action,
        "host_id": host_id,
        "hostname": "SuperCube",
        "address": "127.0.0.1",
        "host_port": port,
        "mac": "00:00:00:00:00:00",
        "timeouts": {"servicePing": 1, "wakeOnLan": wake_on_lan},
        "pyrolight_exec_path": exec_path,
        "send_wol_once": True,
        "custom_wol_exec_path": None,
        "wol_port": 9,
        "debug_logs": False,
    }


class RunnerTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_state(self)
        self.pyrolight = FakePyrolight(self)
        self.pyrolight.set_apps([DESKTOP, VALHEIM, PORTAL])
        self.pyrolight.set(stream={"exit": 0, "sleep": 0})

    async def run_runner(self, **kwargs):
        async with FakeHost() as host:
            with record_connections() as connections:
                await PyroshineRunner.run(settings(host.port, str(self.pyrolight.executable), **kwargs), None)  # type: ignore[arg-type]
        return host, connections

    async def assert_fails(self, result: Result, **kwargs) -> RunnerError:
        with self.assertRaises(RunnerError) as caught:
            await self.run_runner(**kwargs)
        self.assertEqual(caught.exception.result, result, caught.exception.message)
        return caught.exception

    async def test_valheim_streams_through_pyrolight_without_buddy(self):
        host, connections = await self.run_runner()

        streams = self.pyrolight.streams()
        self.assertEqual(len(streams), 1, "exactly one Pyrolight stream process per launch")
        self.assertEqual(streams[0][-3:], ["stream", "127.0.0.1", "Valheim"])
        self.assertIn("--no-quit-after", streams[0])
        self.assertNotIn("--quit-after", streams[0])
        self.assertIn("/serverinfo", host.requests)

        # The only host connection is GameStream's serverinfo; nothing reaches
        # MoonDeck Buddy's port.
        self.assertTrue(connections)
        self.assertTrue(all(port == host.port for _, port in connections), connections)
        self.assertNotIn(59999, [port for _, port in connections])
        self.assertIsNone(read_client_process(), "the client record is cleared once Pyrolight exits")

    async def test_closing_the_stream_never_quits_the_host_app(self):
        await self.run_runner()
        actions = [entry["argv"] for entry in self.pyrolight.invocations()]
        self.assertFalse([argv for argv in actions if "quit" in argv], actions)

    async def test_missing_pyrolight_is_reported(self):
        missing = str(self.pyrolight.directory / "missing.AppImage")
        async with FakeHost() as host:
            with self.assertRaises(RunnerError) as caught:
                await PyroshineRunner.run(settings(host.port, missing), None)  # type: ignore[arg-type]
        self.assertEqual(caught.exception.result, Result.PyrolightIsNotInstalled)
        self.assertEqual(host.requests, [], "nothing is contacted before the client is found")

    async def test_offline_host_is_reported(self):
        with self.assertRaises(RunnerError) as caught:
            # Nothing listens on this port.
            await PyroshineRunner.run(settings(9, str(self.pyrolight.executable)), None)  # type: ignore[arg-type]
        self.assertEqual(caught.exception.result, Result.GameStreamDead)
        self.assertEqual(self.pyrolight.invocations(), [])

    async def test_another_host_at_the_address_is_rejected(self):
        await self.assert_fails(Result.GameStreamDead, host_id="00000000-0000-0000-0000-000000000000")

        self.pyrolight.set_apps([VALHEIM], host_uuid="AAAAAAAA-0000-4000-8000-000000000002")
        await self.assert_fails(Result.WrongHost)
        self.assertEqual(self.pyrolight.streams(), [])

    async def test_unpaired_pyrolight_is_reported(self):
        self.pyrolight.set(list={"exit": 255, "stderr": "Computer SuperCube has not been paired. Please open Moonlight to pair before retrieving games list.\n"})
        await self.assert_fails(Result.PyrolightNotPaired)
        self.assertEqual(self.pyrolight.streams(), [])

    async def test_unreadable_app_list_is_reported(self):
        self.pyrolight.set(list={"exit": 0, "stdout": "Valheim\nPortal 2\n"})
        await self.assert_fails(Result.PyrolightListFailed)

    async def test_a_game_the_host_does_not_offer_is_reported(self):
        error = await self.assert_fails(Result.HostAppNotFound, steam_app_id=105600)
        self.assertIn("105600", error.message)
        self.assertEqual(self.pyrolight.streams(), [])

    async def test_gamestream_apps_stream_by_exact_name(self):
        await self.run_runner(runner_type=RunnerType.GameStreamApp, app_name="desktop")
        self.assertEqual(self.pyrolight.streams()[0][-3:], ["stream", "127.0.0.1", "Desktop"])

        self.pyrolight.set_apps([DESKTOP, {**DESKTOP, "id": 7}])
        await self.assert_fails(Result.HostAppAmbiguous, runner_type=RunnerType.GameStreamApp, app_name="Desktop")

    async def test_an_early_pyrolight_crash_is_reported(self):
        self.pyrolight.set(stream={"exit": 3, "sleep": 0})
        error = await self.assert_fails(Result.PyrolightFailed)
        self.assertIn("exit code 3", error.message)

    async def test_utility_actions_run_without_resolving_an_app(self):
        await self.run_runner(runner_type=RunnerType.Utility, action=UtilityAction.Quit)
        argvs = [entry["argv"] for entry in self.pyrolight.invocations()]
        self.assertEqual(argvs, [["quit", "127.0.0.1"]])

        await self.run_runner(runner_type=RunnerType.Utility, action=UtilityAction.Pair)
        self.assertEqual(self.pyrolight.invocations()[-1]["argv"], ["pair", "127.0.0.1"])

    async def test_codec_and_vrr_are_only_passed_when_the_build_offers_them(self):
        self.pyrolight.set(help="  --vrr  Use variable refresh rate\n  --video-codec <video-codec>  Select video codec:\n      AV1/H.264/HEVC/auto.\n")
        await self.run_runner(cmd_options=options(video_codec="PyroWave", enable_vrr=True))
        stream = self.pyrolight.streams()[-1]
        self.assertNotIn("PyroWave", stream)
        self.assertIn("--vrr", stream)

        self.pyrolight.set(help="  --video-codec <video-codec>  Select video codec:\n      AV1/H.264/HEVC/PyroWave/auto.\n")
        await self.run_runner(cmd_options=options(video_codec="PyroWave", enable_vrr=True))
        stream = self.pyrolight.streams()[-1]
        self.assertEqual(stream[stream.index("--video-codec") + 1], "PyroWave")
        self.assertNotIn("--vrr", stream)


class RunnerCancellationTest(unittest.IsolatedAsyncioTestCase):
    """Suspend, Steam's Exit Game and backend cleanup cancel the runner."""

    def setUp(self):
        isolate_state(self)
        self.pyrolight = FakePyrolight(self)
        self.pyrolight.set_apps([VALHEIM])

    async def start_and_cancel(self):
        async with FakeHost() as host:
            task = asyncio.create_task(PyroshineRunner.run(settings(host.port, str(self.pyrolight.executable)), None))  # type: ignore[arg-type]
            for _ in range(200):
                if self.pyrolight.streams() and read_client_process() is not None:
                    break
                await asyncio.sleep(0.02)
            record = read_client_process()
            self.assertIsNotNone(record)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        assert record is not None
        return record[0]

    async def test_cancelling_stops_only_the_started_pyrolight(self):
        self.pyrolight.set(stream={"exit": 0, "sleep": -1})
        # An unrelated client with "pyrolight" in its command line.
        bystander = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", "pyrolight", "moonlight"])
        self.addCleanup(lambda: (bystander.kill(), bystander.wait()))

        pid = await self.start_and_cancel()
        self.assertFalse(process_alive(pid))
        self.assertIsNone(read_client_process())
        self.assertTrue(process_alive(bystander.pid), "other Pyrolight/Moonlight processes are never signalled")

    async def test_a_client_ignoring_sigterm_is_killed(self):
        self.pyrolight.set(stream={"exit": 0, "sleep": -1}, ignore_sigterm=True)
        pid = await self.start_and_cancel()
        self.assertFalse(process_alive(pid))


class BuddyIndependenceTest(unittest.TestCase):
    def test_the_runner_never_imports_buddy(self):
        code = ("import sys; sys.path[:0] = [sys.argv[1], sys.argv[1] + '/externals'];"
                "import pyrodeckrun, lib.runner.pyroshinerunner, lib.runnercontrol;"
                "print([name for name in sys.modules if 'buddy' in name])")
        with tempfile.TemporaryDirectory() as home:
            output = subprocess.run([sys.executable, "-c", code, str(support.PYTHON_ROOT)], check=True,
                                    capture_output=True, text=True, cwd=support.PYTHON_ROOT,
                                    env={**os.environ, "HOME": home, "XDG_CACHE_HOME": home}).stdout
        self.assertEqual(output.strip().splitlines()[-1], "[]")


if __name__ == "__main__":
    unittest.main()
