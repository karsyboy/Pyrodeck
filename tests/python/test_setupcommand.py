import asyncio
import importlib
import os
import pathlib
import tempfile
import unittest
from unittest import mock

import support
from support import isolate_state

from lib.runner.envparser import RunnerType
from lib.runnerresult import Result, RunnerError


class SetupCommandTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_state(self)
        # Imported after isolate_state so the runner log goes to the test directory.
        self.runner = importlib.import_module("pyrodeckrun")
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix="pyrodeck-setup-"))

    async def test_no_command_runs_nothing(self):
        with mock.patch("asyncio.create_subprocess_shell") as spawn:
            await self.runner.run_setup_command(None)
            await self.runner.run_setup_command("")
        spawn.assert_not_called()

    async def test_the_launch_waits_for_the_command(self):
        marker = self.directory / "ran"
        await self.runner.run_setup_command(f"sleep 0.2; echo setup-output; touch '{marker}'")
        self.assertTrue(marker.exists())

    async def test_a_failing_command_stops_the_launch(self):
        with self.assertRaises(RunnerError) as caught:
            await self.runner.run_setup_command("echo broken >&2; exit 3")
        self.assertEqual(caught.exception.result, Result.SetupCommandFailed)

    async def test_a_cancelled_launch_stops_the_command(self):
        pid_file = self.directory / "pid"
        task = asyncio.create_task(self.runner.run_setup_command(f"echo $$ > '{pid_file}'; exec sleep 30"))
        for _ in range(100):
            if pid_file.exists() and pid_file.read_text().strip():
                break
            await asyncio.sleep(0.02)
        pid = int(pid_file.read_text())
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        for _ in range(100):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            await asyncio.sleep(0.02)
        else:
            self.fail("the setup command outlived the cancelled launch")


class SetupCommandSettingsTest(unittest.IsolatedAsyncioTestCase):
    async def parse(self, runner_type: RunnerType, setup_command: str, **env):
        from lib.plugin.settings import UserSettingsManager
        from lib.runner import settingsparser

        directory = pathlib.Path(tempfile.mkdtemp(prefix="pyrodeck-setup-settings-"))
        manager = UserSettingsManager(directory / "settings.json")
        settings = manager._default_settings()
        settings["setupCommand"] = setup_command
        environment = {"PYRODECK_APP_TYPE": str(runner_type.value), "PYRODECK_HOST_ID": "host",
                       "PYRODECK_STEAM_APP_ID": "892970", "PYRODECK_ACTION": "pair", **env}
        host = {"host": {"hostName": "Host", "address": "10.0.0.2", "hostInfoPort": 47989, "mac": "AA:BB:CC:DD:EE:FF"}}
        with mock.patch.object(settingsparser, "UserSettingsManager") as manager_type, \
                mock.patch.object(settingsparser, "parse_cmd_options", return_value={}), \
                mock.patch.dict(os.environ, environment):
            settings["hostSettings"] = {"host": {**host["host"], "passToMoonlight": True,
                                                 "runnerTimeouts": {"servicePing": 5, "wakeOnLan": 60},
                                                 "wolSettings": {"sendOnce": False, "useCustomWolExec": False,
                                                                 "customWolExecPath": "", "port": 9}}}
            manager_type.return_value.read = mock.AsyncMock(return_value=(settings, False))
            return await settingsparser.parse_settings()

    async def test_stream_launches_carry_the_setup_command(self):
        parsed = await self.parse(RunnerType.SteamApp, "  /home/deck/wake.sh  ")
        self.assertEqual(parsed["setup_command"], "/home/deck/wake.sh")

    async def test_pair_and_quit_never_run_it(self):
        parsed = await self.parse(RunnerType.Utility, "/home/deck/wake.sh")
        self.assertIsNone(parsed["setup_command"])

    async def test_an_empty_command_is_none(self):
        parsed = await self.parse(RunnerType.SteamApp, "   ")
        self.assertIsNone(parsed["setup_command"])


if __name__ == "__main__":
    unittest.main()
