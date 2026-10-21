import asyncio
import contextlib

from typing import Optional
from datetime import datetime, timedelta, timezone
from ..logger import logger
from ..utils import wake_on_lan
from ..splashscreen.overlay import OverlayStack
from ..splashscreen.wolscreen import WolScreen


class WolSplashScreen:
    def __init__(self, stack: OverlayStack, address: str, mac: str, timeout: int, hostname: str, wol_port: int, send_wol_once: bool, custom_wol_exec: Optional[str]):
        self.__address = address
        self.__hostname = hostname
        self.__mac = mac
        self.__wol_port = wol_port
        self.__send_wol_once = send_wol_once
        self.__custom_wol_exec = custom_wol_exec
        self.__wol_task = None
        self.__wol_screen_task = None
        if timeout > 0:
            self.__timeout_data = {
                "end": datetime.now(timezone.utc) + timedelta(seconds=timeout),
                "wol_screen": WolScreen(stack, self.__hostname, None, None),
                "wol_shown": False
            }
        else:
            self.__timeout_data = None

    async def __do_wol(self):
        await wake_on_lan(hostname=self.__hostname,
                          address=self.__address,
                          mac=self.__mac,
                          port=self.__wol_port,
                          custom_exec=self.__custom_wol_exec)

    async def __wol_loop(self):
        while True:
            await self.__do_wol()
            await asyncio.sleep(10)

    async def __show_wol_screen(self):
        if self.__timeout_data:
            await asyncio.sleep(3)
            self.__timeout_data["wol_shown"] = True
            await self.__timeout_data["wol_screen"].__aenter__()      

    async def __aenter__(self):
        if self.__timeout_data is None:
            return self

        if self.__send_wol_once is False:
            self.__wol_task = asyncio.create_task(self.__wol_loop())
        self.__wol_screen_task = asyncio.create_task(self.__show_wol_screen())
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.__timeout_data:
            assert self.__wol_screen_task

            self.__wol_screen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.__wol_screen_task

            if self.__wol_task:
                self.__wol_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self.__wol_task

            if self.__timeout_data["wol_shown"]:
                await self.__timeout_data["wol_screen"].__aexit__(exc_type, exc, tb)

    async def update(self, server_status: bool) -> bool:
        """Whether to keep waiting for the host: False once it is online or the timeout passed."""
        logger.info(f"Host online: {server_status}")
        if self.__timeout_data is None:
            return False

        timeout_elapsed = datetime.now(timezone.utc) > self.__timeout_data["end"]
        if server_status or timeout_elapsed:
            return False

        if self.__send_wol_once:
            await self.__do_wol()
            self.__send_wol_once = None

        return True
