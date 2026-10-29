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
             action=None, cmd_options=None, host_id=HOST_ID, wake_on_lan=0, remote_app_id=None):
    return {
        "runner_type": runner_type,
        "cmd_options": cmd_options or options(),
        "steam_app_id": steam_app_id if runner_type == RunnerType.SteamApp else None,
        "app_name": app_name,
        "remote_app_id": remote_app_id,
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

    async def run_runner(self, fake_host: FakeHost | None = None, **kwargs):
        async with (fake_host or FakeHost()) as host:
            # Not GameStream's default port, so Pyrolight gets "address:port".
            self.host_arg = f"127.0.0.1:{host.port}"
            with record_connections() as connections:
                await PyroshineRunner.run(settings(host.port, str(self.pyrolight.executable), **kwargs), None)  # type: ignore[arg-type]
        return host, connections

    async def assert_fails(self, result: Result, fake_host: FakeHost | None = None, **kwargs) -> RunnerError:
        with self.assertRaises(RunnerError) as caught:
            await self.run_runner(fake_host, **kwargs)
        self.assertEqual(caught.exception.result, result, caught.exception.message)
        return caught.exception

    async def test_valheim_streams_through_pyrolight_without_buddy(self):
        host, connections = await self.run_runner()

        streams = self.pyrolight.streams()
        self.assertEqual(len(streams), 1, "exactly one Pyrolight stream process per launch")
        self.assertEqual(streams[0][-3:], ["stream", self.host_arg, "Valheim"])
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
        await self.assert_fails(Result.WrongHost, host_id="00000000-0000-0000-0000-000000000000")

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

    async def test_each_steam_game_resolves_by_app_id(self):
        await self.run_runner(steam_app_id=620)
        self.assertEqual(self.pyrolight.streams()[-1][-1], "Portal 2")
        await self.run_runner(steam_app_id=892970)
        self.assertEqual(self.pyrolight.streams()[-1][-1], "Valheim")

    async def test_browser_steam_identity_keeps_selected_remote_target(self):
        await self.run_runner(steam_app_id=892970, remote_app_id=VALHEIM["id"])
        self.assertEqual(self.pyrolight.streams()[-1][-1], "Valheim")
        await self.assert_fails(Result.HostAppNotFound, steam_app_id=892970, remote_app_id=PORTAL["id"])

    async def test_titles_never_decide_which_game_streams(self):
        self.pyrolight.set_apps([
            # A manual entry titled like the game, but not the game.
            {"name": "Valheim", "id": 1, "sources": []},
            # Pyroshine suffixes equal titles; each keeps its identity.
            {"name": "Hades (Steam 1145360)", "id": 2, "sources": ["steam:1145360"]},
            {"name": "Hades (Steam 1145361)", "id": 3, "sources": ["steam:1145361"]},
            {"name": "Hades (Heroic)", "id": 4, "sources": ["heroic:legendary/Hades"]},
            {"name": "Valheim (Steam)", "id": 5, "sources": ["steam:892970"]},
        ])
        await self.run_runner(steam_app_id=1145361)
        self.assertEqual(self.pyrolight.streams()[-1][-1], "Hades (Steam 1145361)")
        await self.run_runner(steam_app_id=892970)
        self.assertEqual(self.pyrolight.streams()[-1][-1], "Valheim (Steam)")

    async def test_a_manual_override_on_the_host_streams_for_its_game(self):
        self.pyrolight.set_apps([{"name": "Valheim (modded)", "id": 9, "sources": ["steam:892970"]}])
        await self.run_runner()
        self.assertEqual(self.pyrolight.streams()[-1][-1], "Valheim (modded)")

    async def test_unavailable_and_unsupported_hosts_are_told_apart(self):
        # Pyroshine with app sources, game not installed or hidden there.
        self.pyrolight.set_apps([DESKTOP, PORTAL])
        error = await self.assert_fails(Result.HostAppNotFound)
        self.assertIn("892970", error.message)

        # Same, on a Pyroshine host without a single Steam game.
        self.pyrolight.set_apps([DESKTOP])
        await self.assert_fails(Result.HostAppNotFound)

        # A host that reports no identities at all (older Pyroshine, Sunshine).
        self.pyrolight.set_apps([{**DESKTOP}, {"name": "Valheim", "id": 1001, "sources": []}])
        await self.assert_fails(Result.HostWithoutAppSources, FakeHost(app_sources=None))
        self.assertEqual(self.pyrolight.streams(), [])

    async def test_conflicting_identities_are_never_guessed(self):
        self.pyrolight.set_apps([VALHEIM, {**VALHEIM, "name": "Valheim 2", "id": 77}])
        await self.assert_fails(Result.HostAppAmbiguous)
        self.assertEqual(self.pyrolight.streams(), [])

    async def test_an_outdated_pyrolight_is_reported(self):
        self.pyrolight.set(list={"exit": 1, "stderr": "Unknown options: json\n"})
        await self.assert_fails(Result.PyrolightOutdated)

    async def test_gamestream_apps_stream_by_exact_name(self):
        await self.run_runner(runner_type=RunnerType.GameStreamApp, app_name="desktop")
        self.assertEqual(self.pyrolight.streams()[0][-3:], ["stream", self.host_arg, "Desktop"])

        self.pyrolight.set_apps([DESKTOP, {**DESKTOP, "id": 7}])
        await self.assert_fails(Result.HostAppAmbiguous, runner_type=RunnerType.GameStreamApp, app_name="Desktop")

    async def test_an_early_pyrolight_crash_is_reported(self):
        self.pyrolight.set(stream={"exit": 3, "sleep": 0})
        error = await self.assert_fails(Result.PyrolightFailed)
        self.assertIn("exit code 3", error.message)

    async def test_utility_actions_run_without_resolving_an_app(self):
        await self.run_runner(runner_type=RunnerType.Utility, action=UtilityAction.Quit)
        argvs = [entry["argv"] for entry in self.pyrolight.invocations()]
        self.assertEqual(argvs, [["quit", HOST_ID, "--integration-events"]])

        await self.run_runner(runner_type=RunnerType.Utility, action=UtilityAction.Pair)
        self.assertEqual(self.pyrolight.invocations()[-1]["argv"], ["pair", self.host_arg])

    async def test_explicit_quit_matches_the_client_on_pyroshine_and_other_hosts(self):
        for conditional_cancel in (1, None):
            with self.subTest(conditional_cancel=conditional_cancel):
                # Quit App ends the host's current application, even when it
                # differs from the remembered app. No expected-ID check is sent.
                await self.run_runner(FakeHost(conditional_cancel=conditional_cancel, current_game=PORTAL["id"]),
                                      runner_type=RunnerType.Utility, action=UtilityAction.Quit, remote_app_id=VALHEIM["id"])
                self.assertEqual(self.pyrolight.invocations()[-1]["argv"], ["quit", HOST_ID, "--integration-events"])

    async def test_explicit_quit_reports_lifecycle_and_failure_without_host_extensions(self):
        from lib import sessionstate

        for state, exit_code in (("ended", 0), ("failed", 1)):
            with self.subTest(state=state):
                self.pyrolight.set(quit={"exit": exit_code, "events": [
                    {"schema": 1, "state": "ending"},
                    {"schema": 1, "state": state, "error": "Host refused quit" if exit_code else ""},
                ]})
                async with FakeHost(app_sources=None, conditional_cancel=None) as host:
                    selected = settings(host.port, str(self.pyrolight.executable), runner_type=RunnerType.Utility,
                                        action=UtilityAction.Quit, remote_app_id=VALHEIM["id"])
                    selected["generation"] = sessionstate.begin(selected)
                    if exit_code:
                        with self.assertRaises(RunnerError) as caught:
                            await PyroshineRunner.run(selected)
                        self.assertEqual(caught.exception.result, Result.PyrolightFailed)
                    else:
                        await PyroshineRunner.run(selected)
                self.assertEqual(sessionstate.read()["state"], state)
                self.assertEqual(sessionstate.read()["error"], "Host refused quit" if exit_code else None)

    async def run_quit(self, events):
        from unittest import mock
        from lib import sessionstate
        from lib.runner import pyroshinerunner

        self.pyrolight.set(quit={"exit": 0, "sleep": -1, "events": events})
        async with FakeHost() as host:
            selected = settings(host.port, str(self.pyrolight.executable), runner_type=RunnerType.Utility,
                                action=UtilityAction.Quit)
            selected["generation"] = sessionstate.begin(selected)
            with mock.patch.object(pyroshinerunner, "QUIT_COMPLETION_TIMEOUT", 0.3), \
                    mock.patch.object(pyroshinerunner, "QUIT_EXIT_GRACE", 0.1):
                await asyncio.wait_for(PyroshineRunner.run(selected), 10)
        pid = self.pyrolight.invocations()[-1]["pid"]
        self.assertFalse(process_alive(pid), "the quit window never outlives the quit")
        self.assertIsNone(read_client_process())
        return sessionstate.read()

    async def test_a_quit_client_left_open_after_ending_the_app_is_closed(self):
        state = await self.run_quit([{"schema": 1, "state": "ending"}, {"schema": 1, "state": "ended", "error": ""}])
        self.assertEqual(state["state"], "ended")

    async def test_a_quit_client_that_never_reports_completion_is_closed(self):
        # Pyrolight builds that waited for a host poll after the quit request.
        state = await self.run_quit([{"schema": 1, "state": "ending"}])
        self.assertEqual(state["state"], "ended")
        self.assertIsNone(state["error"])

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


class NativeProfileRunnerTest(unittest.IsolatedAsyncioTestCase):
    run_runner = RunnerTest.run_runner

    def setUp(self):
        isolate_state(self)
        self.pyrolight = FakePyrolight(self)
        self.pyrolight.set_apps([DESKTOP, VALHEIM, PORTAL])
        import json
        self.pyrolight.set(settings={"exit": 0, "stdout": json.dumps({"schema": 1, "ok": True, "revision": "native-revision", "values": {"fps": 90}})},
                           help="--app-id ID --vrr Select video codec: auto / H.264 / HEVC / AV1 / PyroWave. ")

    async def test_native_profile_owns_every_stream_option(self):
        await self.run_runner(cmd_options=options(enable_v_sync=False, video_codec="HEVC", audio="7.1-surround"))
        args = self.pyrolight.streams()[-1]
        self.assertEqual(args[-2:], ["stream", HOST_ID])
        self.assertNotIn("Valheim", args)
        self.assertEqual(args[args.index("--app-id") + 1], "1001")
        self.assertEqual(args[args.index("--settings-revision") + 1], "native-revision")
        self.assertIn("--no-quit-after", args)
        for option in ("--resolution", "--fps", "--no-vsync", "--video-codec", "--audio-config", "--quit-after"):
            self.assertNotIn(option, args)

    async def test_duplicate_names_launch_by_advertised_id(self):
        self.pyrolight.set_apps([{**VALHEIM, "name": "Same name", "id": 31}, {**PORTAL, "name": "Same name", "id": 32}])
        await self.run_runner(steam_app_id=620)
        args = self.pyrolight.streams()[-1]
        self.assertEqual(args[args.index("--app-id") + 1], "32")

    async def test_reconnect_does_not_retarget_a_changed_catalog(self):
        async with FakeHost() as host:
            selected = settings(host.port, str(self.pyrolight.executable))
            await PyroshineRunner.run(selected, None)
            self.pyrolight.set_apps([{**VALHEIM, "id": 999}])
            with self.assertRaises(RunnerError) as caught:
                await PyroshineRunner.run(selected, None)
            self.assertEqual(caught.exception.result, Result.HostAppNotFound)
        self.assertEqual(len(self.pyrolight.streams()), 1)
        self.assertFalse(any("quit" in entry["argv"] for entry in self.pyrolight.invocations()))

    async def test_failure_event_is_not_overwritten_by_session_finished(self):
        from lib import sessionstate
        self.pyrolight.set(stream={"exit": 0, "events": [{"schema": 1, "state": "failed", "error": "Negotiation failed"}, {"schema": 1, "state": "disconnected"}]})
        async with FakeHost() as host:
            selected = settings(host.port, str(self.pyrolight.executable))
            selected["generation"] = sessionstate.begin(selected)
            with self.assertRaises(RunnerError):
                await PyroshineRunner.run(selected, None)
        self.assertEqual(sessionstate.read()["state"], "failed")
        self.assertEqual(sessionstate.read()["error"], "Negotiation failed")


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
    def test_the_runner_never_imports_buddy_or_a_display_toolkit(self):
        code = ("import sys; sys.path[:0] = [sys.argv[1], sys.argv[1] + '/externals'];"
                "import pyrodeckrun, lib.runner.pyroshinerunner, lib.runnercontrol;"
                "print([name for name in sys.modules if 'buddy' in name or 'pyglet' in name])")
        with tempfile.TemporaryDirectory() as home:
            output = subprocess.run([sys.executable, "-c", code, str(support.PYTHON_ROOT)], check=True,
                                    capture_output=True, text=True, cwd=support.PYTHON_ROOT,
                                    env={**os.environ, "HOME": home, "XDG_CACHE_HOME": home,
                                         "DISPLAY": ":pyrodeck-missing", "WAYLAND_DISPLAY": "pyrodeck-missing"}).stdout
        self.assertEqual(output.strip().splitlines()[-1], "[]")


if __name__ == "__main__":
    unittest.main()
