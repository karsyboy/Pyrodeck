"""Stop or query the PyroDeck runner from the plugin backend.

Only processes PyroDeck started are touched: the runner holding PyroDeck's
PID lock, and the Pyrolight process it recorded. Other Pyrolight, Moonlight or
MoonDeck processes are never signalled, so a stream started elsewhere (or by
the MoonDeck plugin) survives PyroDeck's cleanup.
"""

import asyncio
import contextlib

from typing import Optional

from .logger import logger
from .utils import ProcessReaper, get_runner_pid
from .pyrolightproxy import clear_client_process, read_client_process


def get_active_runner() -> Optional[ProcessReaper]:
    try:
        reaper = ProcessReaper(get_runner_pid())
    except Exception:
        return None
    return reaper if reaper.exists() else None


def is_runner_active() -> bool:
    return get_active_runner() is not None


async def wait_gone(reaper: ProcessReaper, timeout: float) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while reaper.exists():
        if loop.time() >= deadline:
            return False
        await asyncio.sleep(0.1)
    return True


async def stop_runner(runner_timeout: float = 8.0, client_timeout: float = 5.0):
    runner = get_active_runner()
    if runner is not None:
        # The runner stops its own Pyrolight on SIGTERM.
        logger.info("Asking the PyroDeck runner to stop")
        runner.send_terminate(children=False)
        if not await wait_gone(runner, runner_timeout):
            logger.warning("PyroDeck runner did not stop in time - killing it and its children")
            runner.send_kill(children=True)
            await wait_gone(runner, 2.0)

    # If the runner died without cleaning up (killed, crashed), its Pyrolight
    # may still be running: stop exactly that process, if it is still the same.
    client = read_client_process()
    if client is not None:
        pid, start_time = client
        reaper = ProcessReaper(pid, expected_start_time=start_time)
        if reaper.exists():
            logger.info(f"Stopping the Pyrolight process the runner left behind ({pid})")
            reaper.send_terminate()
            if not await wait_gone(reaper, client_timeout):
                reaper.send_kill()
                await wait_gone(reaper, 2.0)
        with contextlib.suppress(Exception):
            clear_client_process()
