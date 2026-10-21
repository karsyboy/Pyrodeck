# autopep8: off
# >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
def add_plugin_to_path():
    import sys
    from pathlib import Path

    script_dir = Path(__file__).parent.resolve()
    directories = [["python"], ["python", "lib"], ["python", "externals"]]
    for dir in directories:
        sys.path.append(str(script_dir.joinpath(*dir)))

add_plugin_to_path()  
# <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
# autopep8: on


import asyncio
import logging
import pathlib
import lib.gamestreaminfo as gamestreaminfo
import lib.constants as constants
import lib.utils as utils

from typing import Optional
from lib.plugin.settings import UserSettings, UserSettingsManager
from lib.logger import logger, set_logger_settings, get_logger
from lib.utils import wake_on_lan, change_runner_ready_state
from lib.runnerresult import set_result, get_result
from lib.pyrolightproxy import PyrolightListError, PyrolightProxy, find_pyrolight, pyrolight_host
from lib import runnercontrol

set_logger_settings(logger, constants.BACKEND_LOG_FILE, rotate=True, verbose=True)

frontend_logger = get_logger("frontend")
set_logger_settings(frontend_logger, constants.FRONTEND_LOG_FILE, rotate=True, log_preamble="", verbose=True)

settings_manager = UserSettingsManager(constants.get_config_file_path(), constants.get_moondeck_config_file_path())


class Plugin:
    def __cleanup_states(self):
        set_result(None)
        change_runner_ready_state(False)

    @utils.async_scope_log(logger.info)
    async def _main(self):
        self.__cleanup_states()

    @utils.async_scope_log(logger.info)
    async def _unload(self):
        self.__cleanup_states()

    async def frontend_log_entry(self, level: str, message: str):
        try:
            frontend_logger.log(logging._checkLevel(level), message)
        except Exception:
            logger.exception("Failed to save frontend log")

    @utils.async_scope_log(logger.info)
    async def set_runner_ready(self):
        change_runner_ready_state(True)

    @utils.async_scope_log(logger.info)
    async def get_runner_result(self):
        result = get_result()
        # Cleanup is needed to differentiate between moondeck launches
        set_result(None)
        return result
    
    def set_log_levels(self, data: UserSettings):
        level = logging.DEBUG if data["runnerDebugLogs"] else logging.INFO
        for instance in [logger, frontend_logger]:
            if instance.level != level:
                instance.setLevel(level)
                instance.info(f"Set logger log level to {logging.getLevelName(level)}")

    @utils.async_scope_log(logger.info)
    async def get_user_settings(self):
        try:
            data = await settings_manager.read_or_update()
            self.set_log_levels(data)
            return data
        except Exception:
            logger.exception("Failed to get user settings")
            return None

    @utils.async_scope_log(logger.info)
    async def set_user_settings(self, data: UserSettings):
        try:
            await settings_manager.write(data)
            self.set_log_levels(data)
        except Exception:
            logger.exception("Failed to set user settings")

    @utils.async_scope_log(logger.info)
    async def scan_for_hosts(self, timeout: float):
        try:
            return await gamestreaminfo.scan_for_hosts(timeout=timeout)
        except Exception:
            logger.exception("Unhandled exception")
            return []

    @utils.async_scope_log(logger.info)
    async def find_host(self, host_id: str, timeout: float):
        try:
            return await gamestreaminfo.find_host(host_id, timeout=timeout)
        except Exception:
            logger.exception("Unhandled exception")
            return None

    @utils.async_scope_log(logger.info)
    async def get_server_info(self, address: str, port: int, timeout: float):
        try:
            return await gamestreaminfo.get_server_info(address, port, timeout=timeout)
        except Exception:
            logger.exception("Unhandled exception")
            return None

    @utils.async_scope_log(logger.info)
    async def wake_on_lan(self, hostname: str, address: str, mac: str, port: int, custom_exec: Optional[str]):
        try:
            await wake_on_lan(hostname, address, mac, port, custom_exec)
        except Exception:
            logger.exception("Unhandled exception")

    @utils.async_scope_log(logger.info)
    async def get_runner_path(self):
        try:
            return str(pathlib.Path(__file__).parent.resolve().joinpath("python", "pyrodeckrun.sh"))
        except Exception:
            logger.exception("Unhandled exception")
            return None

    @utils.async_scope_log(logger.info)
    async def get_home_dir(self):
        try:
            return str(pathlib.Path.home())
        except Exception:
            logger.exception("Unhandled exception")
            return None

    @utils.async_scope_log(logger.info)
    async def kill_runner(self):
        try:
            await runnercontrol.stop_runner()

        except Exception:
            logger.exception("Unhandled exception")

    @utils.async_scope_log(logger.info)
    async def suspend_runner(self):
        try:
            utils.ProcessReaper(utils.get_runner_pid()).send_usr1()
            await utils.wait_runner_suspended_state(expected_suspended=True)
            return True

        except Exception:
            logger.exception("Unhandled exception")
            return False
        
    @utils.async_scope_log(logger.info)
    async def unsuspend_runner(self):
        try:
            utils.ProcessReaper(utils.get_runner_pid()).send_usr2()
            await utils.wait_runner_suspended_state(expected_suspended=False)
            return True

        except Exception:
            logger.exception("Unhandled exception")
            return False

    @utils.async_scope_log(logger.info)
    async def is_runner_active(self):
        try:
            return runnercontrol.is_runner_active()

        except Exception:
            logger.exception("Unhandled exception")
            return False

    @utils.async_scope_log(logger.info)
    async def get_game_stream_app_names(self, address: str, port: int, pyrolight_exec_path: str | None, timeout: float):
        try:
            exec_path = find_pyrolight(pyrolight_exec_path)
            if exec_path is None:
                logger.error("Pyrolight is not installed!")
                return None

            async with PyrolightProxy(exec_path) as client:
                app_list = await client.list_apps(pyrolight_host(address, port), timeout=timeout)
                return sorted({app.name for app in app_list.apps})

        except (PyrolightListError, TimeoutError) as err:
            logger.error(f"Failed to get the host's apps from Pyrolight: {err}")
            return None

        except Exception:
            logger.exception("Unhandled exception")
            return None

    @utils.async_scope_log(logger.info)
    async def get_pyrolight_path(self, configured_path: Optional[str]):
        """The Pyrolight executable the runner would use, or None."""
        try:
            return find_pyrolight(configured_path)
        except Exception:
            logger.exception("Unhandled exception")
            return None

    @utils.async_scope_log(logger.info)
    async def get_pairing_status(self, address: str, port: int, host_id: str, configured_path: Optional[str], timeout: float):
        """Whether Pyrolight is paired with the host, by asking it for the app list.

        One of "Paired", "NotPaired", "Unreachable", "WrongHost", "Outdated",
        "NotInstalled" or "Error". Runs Pyrolight's headless `list` command
        once; nothing is polled.
        """
        try:
            exec_path = find_pyrolight(configured_path)
            if exec_path is None:
                return "NotInstalled"

            async with PyrolightProxy(exec_path) as client:
                app_list = await client.list_apps(pyrolight_host(address, port), timeout=timeout)
            if app_list.host_uuid.lower() != host_id.lower():
                return "WrongHost"
            return "Paired"

        except PyrolightListError as err:
            return {"not_paired": "NotPaired", "unreachable": "Unreachable", "outdated": "Outdated"}.get(err.reason, "Error")

        except TimeoutError:
            return "Unreachable"

        except Exception:
            logger.exception("Unhandled exception")
            return "Error"
