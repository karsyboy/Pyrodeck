import os
import subprocess
import sys
import unittest
from unittest import mock

import support
from support import isolate_state, process_alive

import lib.constants as constants
from lib import runnercontrol, runnerresult, runtimefiles, sessionstate, utils
from lib.pyrolightproxy import record_client_process, read_client_process
from lib.runner import envparser
from lib.utils import ProcessReaper, acquire_runner_pid_lock


def sleeper(*tags: str, token: str | None = None) -> subprocess.Popen:
    env = dict(os.environ)
    if token is not None:
        env[constants.CLIENT_TOKEN_VARIABLE] = token
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", *tags], env=env)


class RunnerControlTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_state(self)

    def spawn(self, *tags: str, token: str | None = None) -> subprocess.Popen:
        process = sleeper(*tags, token=token)
        self.addCleanup(lambda: (process.kill(), process.wait()))
        return process

    async def test_stops_the_recorded_client_and_nothing_else(self):
        client = self.spawn("pyrolight", "stream", token="owned")
        bystander = self.spawn("pyrolight", "stream", "moondeckrun.py")
        record_client_process(client.pid, "owned")

        await runnercontrol.stop_runner()
        client.wait(timeout=5)
        self.assertFalse(process_alive(client.pid))
        self.assertTrue(process_alive(bystander.pid))
        self.assertIsNone(read_client_process())

    async def test_a_reused_pid_is_never_signalled(self):
        process = self.spawn("pyrolight", token="owned")
        start_time = ProcessReaper.start_time(process.pid)
        assert start_time is not None
        with open(constants.RUNNER_CLIENT_FILE, "w") as file:
            file.write(f"{process.pid} {start_time + 1} owned")

        await runnercontrol.stop_runner()
        self.assertTrue(process_alive(process.pid))
        self.assertIsNone(read_client_process())

    async def test_a_forged_record_is_never_signalled(self):
        # Correct PID and start time, but not a process a runner started:
        # its environment lacks the record's token.
        for token in (None, "other"):
            process = self.spawn("pyrolight", token=token)
            start_time = ProcessReaper.start_time(process.pid)
            with open(constants.RUNNER_CLIENT_FILE, "w") as file:
                file.write(f"{process.pid} {start_time} owned")

            await runnercontrol.stop_runner()
            self.assertTrue(process_alive(process.pid), token)
            self.assertIsNone(read_client_process())

    async def test_a_legacy_record_is_never_signalled(self):
        process = self.spawn("pyrolight")
        with open(constants.RUNNER_CLIENT_FILE, "w") as file:
            file.write(f"{process.pid} {ProcessReaper.start_time(process.pid)}")

        self.assertIsNone(read_client_process())
        await runnercontrol.stop_runner()
        self.assertTrue(process_alive(process.pid))

    async def test_without_a_runner_nothing_is_active(self):
        self.assertFalse(runnercontrol.is_runner_active())
        await runnercontrol.stop_runner()

    def test_a_second_runner_cannot_start(self):
        lock = acquire_runner_pid_lock()
        self.addCleanup(lock.close)
        with self.assertRaises(Exception):
            acquire_runner_pid_lock()
        self.assertTrue(runnercontrol.is_runner_active(), "the lock holder (this process) is the runner")


class RuntimeFileTest(unittest.TestCase):
    def setUp(self):
        self.directory = isolate_state(self)
        self.sentinel = self.directory / "sentinel"
        self.sentinel.write_text("untouched")

    def test_writes_never_follow_a_planted_link(self):
        for name in ("RUNNER_CLIENT_FILE", "RUNNER_READY_FILE", "RUNNER_RESULT_FILE", "PYROLIGHT_LOG_FILE"):
            os.symlink(self.sentinel, getattr(constants, name))
        with self.assertRaises(OSError):
            utils.change_runner_ready_state(True)
        with self.assertRaises(OSError):
            runtimefiles.open_file(constants.PYROLIGHT_LOG_FILE, "w")
        # Records are replaced, so the link itself goes and the target stays.
        record_client_process(os.getpid(), "token")
        runnerresult.set_result(runnerresult.Result.Terminated)
        self.assertEqual(self.sentinel.read_text(), "untouched")
        self.assertFalse(os.path.islink(constants.RUNNER_CLIENT_FILE))
        self.assertFalse(utils.is_runner_ready(), "a link is not a ready flag")

    def test_a_fifo_or_foreign_file_is_not_read(self):
        os.mkfifo(constants.RUNNER_CLIENT_FILE)
        self.assertIsNone(read_client_process(), "opening the FIFO must not block")
        os.mkfifo(constants.SESSION_STATE_FILE)
        self.assertEqual(sessionstate.read()["state"], "none")

        os.unlink(constants.RUNNER_CLIENT_FILE)
        record_client_process(os.getpid(), "token")
        with mock.patch("os.getuid", return_value=os.getuid() + 1):
            self.assertIsNone(read_client_process())

    def test_the_runtime_directory_must_be_private(self):
        directory = self.directory / "runtime"
        directory.mkdir(mode=0o755)
        directory.chmod(0o755)
        runtimefiles.ensure_dir(str(directory))
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)

        with mock.patch("os.getuid", return_value=os.getuid() + 1):
            with self.assertRaises(runtimefiles.UnsafeRuntimeFile):
                runtimefiles.ensure_dir(str(directory))

        link = self.directory / "link"
        link.symlink_to(directory)
        with self.assertRaises(runtimefiles.UnsafeRuntimeFile):
            runtimefiles.ensure_dir(str(link))

    def test_the_runner_record_names_its_start_time(self):
        lock = utils.acquire_runner_pid_lock()
        self.addCleanup(lock.close)
        with open(constants.RUNNER_PID_FILE) as file:
            self.assertEqual(file.read(), f"{os.getpid()} {ProcessReaper.start_time(os.getpid())}")
        self.assertEqual(utils.get_runner_process().pids(), [os.getpid()])


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
