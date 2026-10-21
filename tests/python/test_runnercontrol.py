import os
import subprocess
import sys
import unittest
from unittest import mock

import support
from support import isolate_state, process_alive

import lib.constants as constants
from lib import runnercontrol
from lib.pyrolightproxy import record_client_process, read_client_process
from lib.runner import envparser
from lib.utils import ProcessReaper, acquire_runner_pid_lock


def sleeper(*tags: str) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", *tags])


class RunnerControlTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_state(self)

    def spawn(self, *tags: str) -> subprocess.Popen:
        process = sleeper(*tags)
        self.addCleanup(lambda: (process.kill(), process.wait()))
        return process

    async def test_stops_the_recorded_client_and_nothing_else(self):
        client = self.spawn("pyrolight", "stream")
        bystander = self.spawn("pyrolight", "stream", "moondeckrun.py")
        record_client_process(client.pid)

        await runnercontrol.stop_runner()
        client.wait(timeout=5)
        self.assertFalse(process_alive(client.pid))
        self.assertTrue(process_alive(bystander.pid))
        self.assertIsNone(read_client_process())

    async def test_a_reused_pid_is_never_signalled(self):
        process = self.spawn("pyrolight")
        start_time = ProcessReaper.start_time(process.pid)
        assert start_time is not None
        with open(constants.RUNNER_CLIENT_FILE, "w") as file:
            file.write(f"{process.pid} {start_time + 1}")

        await runnercontrol.stop_runner()
        self.assertTrue(process_alive(process.pid))
        self.assertIsNone(read_client_process())

    async def test_without_a_runner_nothing_is_active(self):
        self.assertFalse(runnercontrol.is_runner_active())
        await runnercontrol.stop_runner()

    def test_a_second_runner_cannot_start(self):
        lock = acquire_runner_pid_lock()
        self.addCleanup(lock.close)
        with self.assertRaises(Exception):
            acquire_runner_pid_lock()
        self.assertTrue(runnercontrol.is_runner_active(), "the lock holder (this process) is the runner")


class EnvironmentTest(unittest.TestCase):
    def parse(self, **env):
        with mock.patch.dict(os.environ, env, clear=True):
            return envparser.parse_env_settings()

    def test_reads_pyrodeck_variables_only(self):
        settings = self.parse(PYRODECK_APP_TYPE="0", PYRODECK_STEAM_APP_ID="892970", PYRODECK_AUTO_RES="1280x800",
                              MOONDECK_STEAM_APP_ID="620")
        self.assertEqual(settings["runner_type"], envparser.RunnerType.SteamApp)
        self.assertEqual(settings["app_id"], "892970")
        self.assertEqual(settings["auto_resolution"], {"width": 1280, "height": 800})

        self.assertIsNone(self.parse(MOONDECK_APP_TYPE="0")["runner_type"])

    def test_steam_app_ids_are_positive_integers(self):
        for value in ["", "0", "-5", "892970abc", "Valheim", " 892970"]:
            self.assertIsNone(self.parse(PYRODECK_STEAM_APP_ID=value)["app_id"], value)

    def test_actions_and_types(self):
        settings = self.parse(PYRODECK_APP_TYPE="2", PYRODECK_ACTION="quit")
        self.assertEqual((settings["runner_type"], settings["action"]),
                         (envparser.RunnerType.Utility, envparser.UtilityAction.Quit))
        self.assertIsNone(self.parse(PYRODECK_APP_TYPE="9")["runner_type"])
        self.assertIsNone(self.parse(PYRODECK_ACTION="shutdown")["action"])


if __name__ == "__main__":
    unittest.main()
