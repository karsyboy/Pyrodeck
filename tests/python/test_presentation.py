import asyncio
import json
import signal
import unittest
from unittest.mock import AsyncMock, patch
from support import FakeHost, FakePyrolight, HOST_ID, isolate_state, process_alive
from test_runner import settings, VALHEIM
from lib import sessionstate
from lib.runner.pyroshinerunner import PyroshineRunner
from lib.runnerresult import Result, RunnerError


class PresentationTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_state(self)
        self.client = FakePyrolight(self)
        self.client.set_apps([VALHEIM])
        self.client.set(settings={"exit": 0, "stdout": json.dumps({"schema": 1, "ok": True, "revision": "profile", "capabilities": {"windowReadiness": True}})},
                        help="--app-id ID --terminate-app-id ID Select video codec: auto / H.264.")

    async def run_session(self):
        async with FakeHost() as host:
            selected = settings(host.port, str(self.client.executable))
            selected["generation"] = sessionstate.begin(selected)
            await PyroshineRunner.run(selected)
        return sessionstate.read()

    async def test_transport_ready_is_not_window_ready(self):
        self.client.set(stream={"exit": 0, "events": [{"schema": 1, "state": "transport_ready"}, {"schema": 1, "state": "streaming"}]})
        with self.assertRaisesRegex(RunnerError, "before confirming"):
            await self.run_session()
        self.assertNotEqual(sessionstate.read()["state"], "streaming")
        self.assertFalse(sessionstate.read()["streamConfirmed"])

    async def test_success_requires_shown_window_and_renderer(self):
        window = {"id": 7, "shown": True, "focused": True, "rendererReady": True}
        self.client.set(stream={"exit": 0, "events": [{"schema": 1, "state": "transport_ready"},
            {"schema": 1, "state": "window", "window": window},
            {"schema": 1, "state": "streaming", "window": window, "displayBackend": "wayland"}]})
        state = await self.run_session()
        self.assertEqual(state["state"], "streaming")
        self.assertTrue(state["streamConfirmed"])
        self.assertEqual(state["effectivePreferences"]["revision"], "profile")
        self.assertEqual(state["window"], window)
        self.assertEqual(state["displayBackend"], "wayland")

    async def test_no_window_timeout_stops_owned_client_without_ending_game(self):
        self.client.set(stream={"sleep": -1, "events": [{"schema": 1, "state": "transport_ready"}]})
        with patch("lib.runner.pyroshinerunner.WINDOW_READY_TIMEOUT", 0.1):
            with self.assertRaisesRegex(RunnerError, "visible window"):
                await self.run_session()
        streams = [item for item in self.client.invocations() if "stream" in item["argv"] and "--help" not in item["argv"]]
        self.assertFalse(process_alive(streams[0]["pid"]))
        self.assertFalse(any("quit" in item["argv"] for item in self.client.invocations()))

    async def test_initialization_failure_stops_client_even_if_error_dialog_stays_open(self):
        self.client.set(stream={"sleep": -1, "events": [{"schema": 1, "state": "failed", "error": "SDL_CreateWindow failed"}]})
        with self.assertRaisesRegex(RunnerError, "SDL_CreateWindow"):
            await self.run_session()

    async def test_wake_is_sent_once_and_expected_host_must_answer(self):
        selected = settings(9, str(self.client.executable), wake_on_lan=10)
        server = {"uniqueId": HOST_ID}
        with patch("lib.runner.pyroshinerunner.get_server_info", new=AsyncMock(side_effect=[None, None, server])) as ping, patch("lib.utils.wake_on_lan", new=AsyncMock()) as wake, patch("asyncio.sleep", new=AsyncMock()):
            self.assertEqual(await PyroshineRunner.check_connectivity(None, selected), server)
        wake.assert_awaited_once()
        self.assertEqual(ping.await_count, 3)

    async def test_legacy_stream_remains_usable_without_claiming_window_readiness(self):
        self.client.set(settings={"exit": 0, "stdout": json.dumps({"schema": 1, "ok": True, "revision": "old"})},
                        stream={"exit": 0, "events": [{"schema": 1, "state": "streaming"}]})
        state = await self.run_session()
        self.assertEqual(state["stage"], "window_unverified")
        self.assertNotEqual(state["state"], "streaming")

    async def test_resume_delivered_during_suspend_cleanup_is_not_lost(self):
        import pyrodeckrun
        selected = settings(9, str(self.client.executable))
        selected["generation"] = sessionstate.begin(selected)
        first = asyncio.Event(); cleaning = asyncio.Event(); release = asyncio.Event(); second = asyncio.Event()
        calls = 0
        async def run(_):
            nonlocal calls
            calls += 1
            if calls == 1:
                first.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cleaning.set(); await release.wait(); raise
            second.set()
            await asyncio.Event().wait()
        handlers = {}
        loop = asyncio.get_running_loop()
        with patch.object(loop, "add_signal_handler", side_effect=lambda key, callback: handlers.update({key: callback})), patch.object(loop, "remove_signal_handler"), patch.object(PyroshineRunner, "run", side_effect=run):
            task = asyncio.create_task(pyrodeckrun.run_with_suspend_resume(selected))
            await asyncio.wait_for(first.wait(), 1)
            handlers[signal.SIGUSR1](); await asyncio.wait_for(cleaning.wait(), 1)
            handlers[signal.SIGUSR2](); release.set()
            await asyncio.wait_for(second.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
        self.assertEqual(calls, 2)

    async def test_confirmed_switch_authorization_is_not_replayed_on_resume(self):
        async with FakeHost() as host:
            selected = settings(host.port, str(self.client.executable))
            selected["terminate_app_id"] = 99
            await PyroshineRunner.run(selected)
            await PyroshineRunner.run(selected)
        streams = self.client.streams()
        self.assertEqual(streams[0][streams[0].index("--terminate-app-id") + 1], "99")
        self.assertNotIn("--terminate-app-id", streams[1])

    async def test_confirmed_switch_is_refused_by_a_host_without_the_check(self):
        async with FakeHost(conditional_cancel=None) as host:
            selected = settings(host.port, str(self.client.executable))
            selected["terminate_app_id"] = 99
            with self.assertRaises(RunnerError) as caught:
                await PyroshineRunner.run(selected)
        self.assertEqual(caught.exception.result, Result.HostWithoutConditionalCancel)
        self.assertEqual(self.client.streams(), [])
