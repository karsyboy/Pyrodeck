# autopep8: off
# >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
def add_plugin_to_path():
    import sys
    from pathlib import Path

    script_dir = Path(__file__).parent.resolve()
    directories = [["lib"], ["externals"]]
    for dir in directories:
        sys.path.append(str(script_dir.joinpath(*dir)))

add_plugin_to_path()
# <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
# autopep8: on  

import asyncio
import contextlib
import signal
import logging

from lib.runner.pyroshinerunner import PyroshineRunner
from lib.logger import logger, set_logger_settings
from lib.utils import is_runner_ready, change_runner_suspended_state, acquire_runner_pid_lock
from lib.runner.settingsparser import RunnerSettings, parse_settings

import lib.constants as constants
import lib.runnerresult as runnerresult
from lib import sessionstate


set_logger_settings(logger, constants.RUNNER_LOG_FILE, rotate=False)


async def run_with_suspend_resume(settings: RunnerSettings):
    # Steam owns launch progress; Pyrolight owns the only client windows. The
    # old Pyglet canvas provided labels only, but stayed fullscreen until exit,
    # required an extra X11/OpenGL context, and never relinquished its surface.
    suspend_requested = asyncio.Event()
    resume_requested = asyncio.Event()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGUSR1, suspend_requested.set)
    loop.add_signal_handler(signal.SIGUSR2, resume_requested.set)
    try:
        while True:
            suspend_requested.clear()
            resume_requested.clear()
            runner_task = asyncio.create_task(PyroshineRunner.run(settings))
            suspend_task = asyncio.create_task(suspend_requested.wait())
            try:
                await asyncio.wait({runner_task, suspend_task}, return_when=asyncio.FIRST_COMPLETED)
                if runner_task.done():
                    await runner_task
                    return
                runner_task.cancel(msg=constants.RUNNER_SUSPEND_CANCEL_MSG)
                with contextlib.suppress(asyncio.CancelledError):
                    await runner_task
                change_runner_suspended_state(True)
                sessionstate.update(settings["generation"], state="disconnected", stage="suspended")
                # A resume delivered during client cleanup is intentionally kept.
                await resume_requested.wait()
                change_runner_suspended_state(False)
                sessionstate.update(settings["generation"], state="reconnecting", stage="connecting")
            finally:
                runner_task.cancel()
                suspend_task.cancel()
                await asyncio.gather(runner_task, suspend_task, return_exceptions=True)
    finally:
        loop.remove_signal_handler(signal.SIGUSR1)
        loop.remove_signal_handler(signal.SIGUSR2)
        change_runner_suspended_state(False)


async def main():
    # Handle the SIGTERM in a similar way to SIGINT
    loop = asyncio.get_running_loop()
    main_task = asyncio.current_task()
    assert main_task    
    loop.add_signal_handler(signal.SIGTERM, main_task.cancel)

    try:
        with acquire_runner_pid_lock():
            logger.info("Resetting runner result and suspended state")
            runnerresult.set_result(runnerresult.Result.ClosedPrematurely, log_result=False)
            change_runner_suspended_state(False)

            if not is_runner_ready():
                raise runnerresult.RunnerError(runnerresult.Result.RunnerNotReady)

            import os
            logger.info("Display environment: WAYLAND_DISPLAY=%s DISPLAY=%s XDG_SESSION_TYPE=%s XDG_CURRENT_DESKTOP=%s SteamGameId=%s",
                        os.environ.get("WAYLAND_DISPLAY"), os.environ.get("DISPLAY"), os.environ.get("XDG_SESSION_TYPE"),
                        os.environ.get("XDG_CURRENT_DESKTOP"), os.environ.get("SteamGameId"))

            logger.info("Owned process pid=%s parent=%s SteamAppId=%s SDL_VIDEODRIVER=%s QT_QPA_PLATFORM=%s",
                        os.getpid(), os.getppid(), os.environ.get("SteamAppId"),
                        os.environ.get("SDL_VIDEODRIVER"), os.environ.get("QT_QPA_PLATFORM"))
            logger.info("Parsing runner settings")
            settings = await parse_settings()
            settings["generation"] = sessionstate.begin(settings)

            if settings["debug_logs"]:
                logger.setLevel(logging.DEBUG)

            await run_with_suspend_resume(settings)
            if sessionstate.read().get("state") not in ("failed", "ended"):
                sessionstate.update(settings["generation"], state="disconnected")
            runnerresult.set_result(None)

    except asyncio.CancelledError as err:
        current = sessionstate.read()
        if current.get("generation") == locals().get("settings", {}).get("generation"):
            sessionstate.update(current["generation"], state="disconnected")
        if isinstance(err.__cause__, runnerresult.RunnerError):
            runnerresult.set_result(err.__cause__)
        else:
            runnerresult.set_result(runnerresult.Result.Terminated)

    except runnerresult.RunnerError as err:
        current = sessionstate.read()
        if current.get("generation") == locals().get("settings", {}).get("generation"):
            sessionstate.update(current["generation"], state="failed", error=str(err))
        runnerresult.set_result(err)

    except Exception:
        logger.exception("Unhandled exception")
        current = sessionstate.read()
        if current.get("generation") == locals().get("settings", {}).get("generation"):
            sessionstate.update(current["generation"], state="failed", error="Runner exception; see /tmp/pyrodeck-runner.log")
        runnerresult.set_result(runnerresult.Result.Exception)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
