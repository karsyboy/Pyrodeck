"""Stream a game from a Pyroshine host through Pyrolight.

The runner is what the PyroDeck Steam shortcut executes, so Steam owns the
launch (Game Mode focus, Steam Input, the overlay's Exit Game) exactly as for
any game. It:

1. wakes the host if needed and checks that the selected host answers;
2. finds the host app to stream (by Steam app ID for library games);
3. starts one Pyrolight process with `stream HOST APP` and waits for it.

The host owns the game. Closing Pyrolight, suspending the Deck or a network
drop only ends this client's connection: Pyrolight is started with
`--no-quit-after` and the runner never asks the host to quit anything. Ending
the host game is the separate "quit" utility action, which the user starts
on purpose.
"""

from typing import Optional

from .settingsparser import RunnerSettings
from .envparser import RunnerType, UtilityAction
from ..runnerresult import Result, RunnerError
from ..gamestreaminfo import GameStreamHost, get_server_info
from ..logger import logger
from ..pyrolightproxy import HostApp, HostAppList, PyrolightListError, PyrolightProxy, build_stream_args, find_pyrolight, needs_capability_probe
from ..splashscreen.overlay import OverlayStack


# Phase 1 mapping, until hosts report Steam app IDs: Steam app ID -> host app name.
STATIC_STEAM_APPS = {892970: "Valheim"}

# A Pyrolight exit with an error this soon after start is a launch failure.
EARLY_EXIT_SECS = 10


def find_app_by_name(app_list: HostAppList, name: str) -> HostApp:
    """The app Pyrolight's `stream HOST NAME` would pick: case-insensitive exact name."""
    matches = [app for app in app_list.apps if app.name.lower() == name.lower()]
    if not matches:
        raise RunnerError(Result.HostAppNotFound,
                          f"\"{name}\" is not available on {app_list.host_name or 'the host'}!")
    if len(matches) > 1:
        # Pyrolight would silently take the first; refuse instead of guessing.
        raise RunnerError(Result.HostAppAmbiguous,
                          f"{app_list.host_name or 'The host'} offers {len(matches)} apps named \"{name}\"!")
    return matches[0]


def resolve_steam_app(app_list: HostAppList, steam_app_id: int) -> HostApp:
    name = STATIC_STEAM_APPS.get(steam_app_id)
    if name is None:
        raise RunnerError(Result.HostAppNotFound,
                          f"Steam app {steam_app_id} is not available on {app_list.host_name or 'the host'}!")
    return find_app_by_name(app_list, name)


class PyroshineRunner:
    @staticmethod
    async def check_connectivity(overlay_stack: OverlayStack, settings: RunnerSettings) -> GameStreamHost:
        """Wake the host if needed and return its server info once the selected host answers."""
        import asyncio

        logger.info("Checking connection to the host")

        # Lazy import to improve CLI performance
        from .wolsplashscreen import WolSplashScreen

        async with WolSplashScreen(overlay_stack, None, None, settings["address"], settings["mac"],
                                   settings["timeouts"]["wakeOnLan"], settings["hostname"], settings["wol_port"],
                                   settings["send_wol_once"], settings["custom_wol_exec_path"]) as splash:
            while True:
                server_info = await get_server_info(address=settings["address"],
                                                    port=settings["host_port"],
                                                    timeout=settings["timeouts"]["servicePing"])
                online = server_info is not None and server_info["uniqueId"] == settings["host_id"]
                if not await splash.update(None, online):
                    if not online or server_info is None:
                        raise RunnerError(Result.GameStreamDead)
                    return server_info
                # A refused connection returns at once; do not spin.
                await asyncio.sleep(1)

    @staticmethod
    async def list_host_apps(proxy: PyrolightProxy, settings: RunnerSettings) -> HostAppList:
        try:
            app_list = await proxy.list_apps(settings["address"])
        except PyrolightListError as err:
            if err.reason == "not_paired":
                raise RunnerError(Result.PyrolightNotPaired) from err
            if err.reason == "unreachable":
                raise RunnerError(Result.PyrolightCannotReachHost) from err
            raise RunnerError(Result.PyrolightListFailed) from err
        except TimeoutError as err:
            raise RunnerError(Result.PyrolightCannotReachHost) from err

        # Pyrolight answers for whichever host has this address now; make sure
        # it is the one the user selected (and whose TLS identity Pyrolight
        # pinned when pairing).
        if app_list.host_uuid.lower() != settings["host_id"].lower():
            logger.error(f"Expected host {settings['host_id']}, Pyrolight reached {app_list.host_uuid}")
            raise RunnerError(Result.WrongHost)
        return app_list

    @classmethod
    async def resolve_target(cls, proxy: PyrolightProxy, settings: RunnerSettings) -> HostApp:
        app_list = await cls.list_host_apps(proxy, settings)
        if settings["runner_type"] == RunnerType.SteamApp:
            assert settings["steam_app_id"] is not None
            app = resolve_steam_app(app_list, settings["steam_app_id"])
        else:
            assert settings["app_name"] is not None
            app = find_app_by_name(app_list, settings["app_name"])
        logger.info(f"Streaming host app \"{app.name}\" (ID {app.id})")
        return app

    @staticmethod
    async def run_pyrolight(proxy: PyrolightProxy, args: list[str]):
        import asyncio

        started = asyncio.get_running_loop().time()
        await proxy.start(args)
        returncode = await proxy.wait()
        elapsed = asyncio.get_running_loop().time() - started
        logger.info(f"Pyrolight exited with {returncode} after {elapsed:.1f} s")
        if returncode not in (0, None):
            # Pyrolight shows host and stream errors in its own dialog and then
            # exits normally; a failing exit code is a crash or a rejected
            # command line.
            detail = None
            if elapsed < EARLY_EXIT_SECS:
                detail = f"Pyrolight failed to start (exit code {returncode})! See /tmp/pyrodeck-runner-pyrolight.log."
            raise RunnerError(Result.PyrolightFailed, detail)

    @classmethod
    async def run(cls, settings: RunnerSettings, overlay_stack: OverlayStack):
        exec_path = find_pyrolight(settings["pyrolight_exec_path"])
        if exec_path is None:
            raise RunnerError(Result.PyrolightIsNotInstalled)
        logger.info(f"Using Pyrolight at {exec_path}")

        await cls.check_connectivity(overlay_stack, settings)

        async with PyrolightProxy(exec_path) as proxy:
            if settings["runner_type"] == RunnerType.Utility:
                action: Optional[UtilityAction] = settings["action"]
                assert action is not None
                logger.info(f"Running Pyrolight action: {action.value}")
                await cls.run_pyrolight(proxy, [action.value, settings["address"]])
                return

            app = await cls.resolve_target(proxy, settings)
            capabilities = None
            if needs_capability_probe(settings["cmd_options"]):
                capabilities = await proxy.probe_capabilities()
            args = build_stream_args(settings["address"], app.name, settings["cmd_options"], capabilities)
            await cls.run_pyrolight(proxy, args)
