from typing import Optional, TypedDict, cast

from .envparser import EnvSettings, parse_env_settings, RunnerType, UtilityAction
from ..runnerresult import RunnerError, Result
from ..plugin.settings import Dimension, HostSettings, UserSettingsManager
from ..pyrolightproxy import ResolutionDimensions, CommandLineOptions
from ..logger import logger
from .. import constants


class RunnerTimeouts(TypedDict):
    servicePing: int
    wakeOnLan: int


class RunnerSettings(TypedDict):
    runner_type: RunnerType
    cmd_options: CommandLineOptions
    # Set for RunnerType.SteamApp: the Steam app ID of the library entry.
    steam_app_id: Optional[int]
    # Set for RunnerType.GameStreamApp: the host app's advertised name.
    app_name: Optional[str]
    # Set for RunnerType.Utility.
    action: Optional[UtilityAction]
    host_id: str
    hostname: str
    address: str
    host_port: int
    mac: str
    timeouts: RunnerTimeouts
    pyrolight_exec_path: Optional[str]
    send_wol_once: bool
    custom_wol_exec_path: Optional[str]
    wol_port: int
    debug_logs: bool
    remote_app_id: Optional[int]
    terminate_app_id: Optional[int]


def parse_audio_settings(host_settings: HostSettings, env_settings: EnvSettings) -> Optional[str]:
    audio_option = host_settings["audio"]["defaultOption"]

    if host_settings["audio"]["useLinkedAudio"]:
        linked_audio_device = env_settings["linked_audio"]
        if linked_audio_device:
            for option, devices in host_settings["audio"]["linkedAudio"].items():
                if linked_audio_device in devices:
                    logger.info(f"Using linked audio device \"{linked_audio_device}\".")
                    audio_option = option

    logger.info(f"Parsed audio option: {audio_option}")
    return audio_option

def parse_resolution_settings(host_settings: HostSettings, env_settings: EnvSettings) -> ResolutionDimensions:
    dimensions: ResolutionDimensions = {
        "size": None,
        "bitrate": host_settings["resolution"]["defaultBitrate"],
        "fps": host_settings["resolution"]["defaultFps"],
        "hdr": host_settings["resolution"]["defaultHdr"],
    }

    dimension_list = host_settings["resolution"]["dimensions"]

    def update_dimensions(dimension: Dimension):
        dimensions["size"] = { "width": dimension["width"], "height": dimension["height"] }
        if dimension["bitrate"] is not None:
            dimensions["bitrate"] = dimension["bitrate"]
        if dimension["fps"] is not None:
            dimensions["fps"] = dimension["fps"]
        if dimension["hdr"] is not None:
            dimensions["hdr"] = dimension["hdr"]

    if host_settings["resolution"]["useLinkedDisplays"] and len(dimension_list) > 0:
        linked_display = env_settings["linked_display"]
        if linked_display:
            for dimension in dimension_list:
                if linked_display in dimension["linkedDisplays"]:
                    logger.info(f"Using linked custom resolution for display \"{linked_display}\".")
                    update_dimensions(dimension)

    if not dimensions["size"] and host_settings["resolution"]["useCustomDimensions"] and len(dimension_list) > 0:
        index = host_settings["resolution"]["selectedDimensionIndex"]
        if index >= 0 and index < len(dimension_list):
            logger.info("Using custom resolution.")
            update_dimensions(dimension_list[index])
        else:
            logger.warning(f"Dimension index ({index}) out of range ([0;{len(dimension_list)}]). Still continuing...")

    if not dimensions["size"] and host_settings["resolution"]["automatic"]:
        auto_resolution = env_settings["auto_resolution"]

        logger.info(f"Using auto resolution from PyroDeck: {auto_resolution}")
        if auto_resolution:
            dimensions["size"] = { "width": auto_resolution["width"], "height": auto_resolution["height"] }
        else:
            logger.warning(f"Cannot use automatic resolution! PyroDeck did not pass resolution. Still continuing...")

    logger.info(f"Parsed resolution settings: {dimensions}")
    return dimensions

def parse_cmd_options(pass_to_pyrolight: bool, host_settings: HostSettings, env_settings: EnvSettings) -> CommandLineOptions:
    return CommandLineOptions({
        "audio": parse_audio_settings(host_settings=host_settings, env_settings=env_settings) if pass_to_pyrolight else None,
        "resolution": parse_resolution_settings(host_settings=host_settings, env_settings=env_settings) if pass_to_pyrolight else None,
        "show_performance_stats": host_settings["showPerformanceStats"] if pass_to_pyrolight else None,
        "enable_v_sync": host_settings["enableVSync"] if pass_to_pyrolight else None,
        "enable_frame_pacing": host_settings["enableFramePacing"] if pass_to_pyrolight else None,
        "enable_vrr": cast(dict, host_settings).get("enableVrr") if pass_to_pyrolight else None,
        "video_codec": host_settings["videoCodec"] if pass_to_pyrolight else None,

        # Closing the stream never ends the game on the host: Pyroshine keeps
        # it for the next connection. Ending it is a separate, explicit action.
        "quit_after": False
    })

async def parse_settings() -> RunnerSettings:
    logger.info("Getting current host settings")
    settings_manager = UserSettingsManager(constants.get_config_file_path())
    user_settings, _ = await settings_manager.read()
    host_settings = None

    if user_settings is None:
        raise RunnerError(Result.NoSettings)

    env_settings = parse_env_settings()
    host_id = env_settings["host_id"] or user_settings["currentHostId"]
    if host_id is not None and host_id in user_settings["hostSettings"]:
        host_settings = user_settings["hostSettings"][host_id]

    if host_settings is None:
        raise RunnerError(Result.HostNotSelected)

    logger.info("Parsing ENV settings")
    env_settings = parse_env_settings()

    runner_type = env_settings["runner_type"]
    if runner_type is None:
        raise RunnerError(Result.NoRunnerType)

    steam_app_id: Optional[int] = None
    app_name: Optional[str] = None
    action: Optional[UtilityAction] = None
    if runner_type == RunnerType.SteamApp:
        if env_settings["app_id"] is None:
            raise RunnerError(Result.NoAppId)
        steam_app_id = int(env_settings["app_id"])
    elif runner_type in (RunnerType.GameStreamApp, RunnerType.RemoteApp):
        if env_settings["app_name"] is None and runner_type == RunnerType.GameStreamApp:
            raise RunnerError(Result.NoAppName)
        app_name = env_settings["app_name"] or "Remote application"
        if runner_type == RunnerType.RemoteApp and env_settings["remote_app_id"] is None:
            raise RunnerError(Result.HostAppNotFound)
    else:
        if env_settings["action"] is None:
            raise RunnerError(Result.NoAction)
        action = env_settings["action"]

    pass_to_pyrolight = host_settings["passToMoonlight"]
    if not pass_to_pyrolight:
        logger.info("Settings will NOT be passed to Pyrolight")

    wol_settings = host_settings["wolSettings"]
    return RunnerSettings({
        "runner_type": runner_type,
        "cmd_options": parse_cmd_options(pass_to_pyrolight, host_settings=host_settings, env_settings=env_settings),
        "steam_app_id": steam_app_id,
        "app_name": app_name,
        "action": action,
        "host_id": cast(str, host_id),
        "hostname": host_settings["hostName"],
        "address": host_settings["address"],
        "host_port": host_settings["hostInfoPort"],
        "mac": host_settings["mac"],
        "timeouts": {
            "servicePing": host_settings["runnerTimeouts"]["servicePing"],
            "wakeOnLan": host_settings["runnerTimeouts"]["wakeOnLan"],
        },
        "pyrolight_exec_path": user_settings["moonlightExecPath"] if user_settings["useMoonlightExec"] else None,
        "send_wol_once": wol_settings["sendOnce"],
        "custom_wol_exec_path": wol_settings["customWolExecPath"] if wol_settings["useCustomWolExec"] else None,
        "wol_port": wol_settings["port"],
        "debug_logs": user_settings["runnerDebugLogs"],
        "remote_app_id": env_settings["remote_app_id"],
        "terminate_app_id": env_settings["terminate_app_id"],
    })
