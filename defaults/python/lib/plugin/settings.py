from typing import Dict, List, Literal, Optional, TypedDict, get_args
from ..settingsmanager import SettingsManager


ControllerConfigOption = Literal["Disable", "Default", "Enable"]
VideoCodecOption = Literal["AV1", "HEVC", "H.264", "PyroWave", "Auto"]
AudioOption = Literal["stereo", "5.1-surround", "7.1-surround"]


class RunnerTimeouts(TypedDict):
    servicePing: int
    wakeOnLan: int
    steamLaunch: int


class Dimension(TypedDict):
    width: int
    height: int
    bitrate: Optional[int]
    fps: Optional[int]
    hdr: Optional[bool]
    linkedDisplays: List[str]


class HostResolution(TypedDict):
    automatic: bool
    appResolutionOverride: Literal["CustomResolution",
                                   "DisplayResolution", "Native", "Default"]
    appResolutionOverrideForInternalDisplay: bool
    useCustomDimensions: bool
    useLinkedDisplays: bool
    selectedDimensionIndex: int
    defaultBitrate: Optional[int]
    defaultFps: Optional[int]
    defaultHdr: Optional[bool]
    dimensions: List[Dimension]


class AudioSettings(TypedDict):
    defaultOption: Optional[AudioOption]
    useLinkedAudio: bool
    linkedAudio: Dict[AudioOption, list[str]]


class GameStreamAppsSettings(TypedDict):
    showQuickAccessButton: bool


class WolSettings(TypedDict):
    useCustomWolExec: bool
    sendOnce: bool
    customWolExecPath: str
    port: int


class HostSettings(TypedDict):
    hostInfoPort: int
    address: str
    staticAddress: bool
    hostName: str
    mac: str
    resolution: HostResolution
    audio: AudioSettings
    runnerTimeouts: RunnerTimeouts
    # "Moonlight" keys keep MoonDeck's names: they hold Pyrolight's options.
    passToMoonlight: bool
    showPerformanceStats : Optional[bool]
    enableVSync : Optional[bool]
    enableFramePacing : Optional[bool]
    enableVrr: Optional[bool]
    videoCodec: Optional[VideoCodecOption]
    gameStreamApps: GameStreamAppsSettings
    wolSettings: WolSettings


class GameSessionSettings(TypedDict):
    autoApplyAppId: bool
    resumeAfterSuspend: bool
    controllerConfig: Optional[ControllerConfigOption]


class ButtonPositionSettings(TypedDict):
    horizontalAlignment: Literal["top", "bottom"]
    verticalAlignment: Literal["left", "right"]
    offsetX: str
    offsetY: str
    offsetForHltb: bool
    zIndex: str


class ButtonStyleSettings(TypedDict):
    showFocusRing: bool
    theme: Literal["HighContrast", "Clean"]


class UserSettings(TypedDict):
    # Continues MoonDeck's numbering: 44 is the first PyroDeck schema.
    version: Literal[44]
    currentHostId: Optional[str]
    gameSession: GameSessionSettings
    buttonPosition: ButtonPositionSettings
    buttonStyle: ButtonStyleSettings
    enableMoondeckShortcuts: bool
    enableMoondeckButtonPrompt: bool
    hostSettings: Dict[str, HostSettings]
    runnerDebugLogs: bool
    # Pyrolight executable: found automatically unless useMoonlightExec is set.
    useMoonlightExec: bool
    moonlightExecPath: str
    pythonExecPath: str


class UserSettingsManager(SettingsManager[UserSettings]):
    def __init__(self, filepath, seed_filepath=None):
        """`seed_filepath`: MoonDeck settings to start from when PyroDeck has none (read only)."""
        super().__init__(filepath)
        self.seed_filepath = seed_filepath

    def _default_settings(self):
        return UserSettings({
            "version": get_args(UserSettings.__annotations__["version"])[0],
            "currentHostId": None,
            "gameSession": {
                "autoApplyAppId": False,
                "resumeAfterSuspend": False,
                "controllerConfig": None
            },
            "buttonPosition": {
                "horizontalAlignment": "bottom",
                "verticalAlignment": "right",
                "offsetX": "",
                "offsetY": "",
                "offsetForHltb": False,
                "zIndex": ""
            },
            "buttonStyle": {
                "showFocusRing": True,
                "theme": "Clean"
            },
            "enableMoondeckShortcuts": True,
            "enableMoondeckButtonPrompt": False,
            "hostSettings": {},
            "runnerDebugLogs": False,
            "useMoonlightExec": False,
            "moonlightExecPath": "",
            "pythonExecPath": ""
        })

    async def _initial_settings(self) -> UserSettings:
        """Hosts and stream preferences from an installed MoonDeck, else defaults.

        MoonDeck's file is only read. Its client executable pointed at
        Moonlight, which PyroDeck cannot use, so the executable is detected
        again.
        """
        from ..logger import logger

        if self.seed_filepath is not None:
            try:
                settings, _ = await self.read_path(self.seed_filepath)
                if settings is not None:
                    settings["useMoonlightExec"] = False
                    settings["moonlightExecPath"] = ""
                    logger.info(f"Imported hosts and preferences from {self.seed_filepath}")
                    return settings
            except Exception:
                logger.exception(f"Could not import {self.seed_filepath}; starting with defaults")
        return self._default_settings()

    def _migrate_settings(self, data: dict):
        if data["version"] == 1:
            data["version"] = 2
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["resolution"] = {
                    "automatic": True,
                    "earlyChangeEnabled": True,
                    "passToMoonlight": True,
                    "useCustomDimensions": False,
                    "customWidth": 1280,
                    "customHeight": 800
                }
        if data["version"] == 2:
            data["version"] = 3
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["staticAddress"] = False
        if data["version"] == 3:
            data["version"] = 4
            for host in data["hostSettings"].keys():
                del data["hostSettings"][host]["resolution"]["customWidth"]
                del data["hostSettings"][host]["resolution"]["customHeight"]
                data["hostSettings"][host]["resolution"]["selectedDimensionIndex"] = -1
                data["hostSettings"][host]["resolution"]["dimensions"] = []
        if data["version"] == 4:
            data["version"] = 5
            for host in data["hostSettings"].keys():
                del data["hostSettings"][host]["resolution"]["earlyChangeEnabled"]
        if data["version"] == 5:
            data["version"] = 6
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["closeSteamOnceSessionEnds"] = False
        if data["version"] == 6:
            data["version"] = 7
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["resolution"]["defaultBitrate"] = None
                for i in range(len(data["hostSettings"][host]["resolution"]["dimensions"])):
                    data["hostSettings"][host]["resolution"]["dimensions"][i]["bitrate"] = None
        if data["version"] == 7:
            data["version"] = 8
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["hostApp"] = {
                    "selectedAppIndex": -1, "apps": []}
        if data["version"] == 8:
            data["version"] = 9
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["resolution"]["appResolutionOverride"] = "CustomResolution"
        if data["version"] == 9:
            data["version"] = 10
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["resolution"]["passToBuddy"] = True
        if data["version"] == 10:
            data["version"] = 11
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["hostInfoPort"] = 47989
        if data["version"] == 11:
            data["version"] = 12
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["runnerTimeouts"] = {
                    "buddyRequests": 5, "servicePing": 5, "initialConditions": 30, "streamReadiness": 30, "appLaunch": 30, "appLaunchStability": 15, "appUpdate": 5}
                data["hostSettings"][host]["runnerDebugLogs"] = False
                data["hostSettings"][host]["resolution"]["defaultFps"] = None
                for i in range(len(data["hostSettings"][host]["resolution"]["dimensions"])):
                    data["hostSettings"][host]["resolution"]["dimensions"][i]["fps"] = None
        if data["version"] == 12:
            data["version"] = 13
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["runnerTimeouts"]["streamEnd"] = 15
        if data["version"] == 13:
            data["version"] = 14
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["resolution"]["useLinkedDisplays"] = True
                for i in range(len(data["hostSettings"][host]["resolution"]["dimensions"])):
                    data["hostSettings"][host]["resolution"]["dimensions"][i]["linkedDisplays"] = [
                    ]
        if data["version"] == 14:
            data["version"] = 15
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["runnerTimeouts"]["wakeOnLan"] = 60
        if data["version"] == 15:
            data["version"] = 16
            for host in data["hostSettings"].keys():
                del data["hostSettings"][host]["runnerDebugLogs"]

            data["runnerDebugLogs"] = False
            data["useMoonlightExec"] = False
            data["moonlightExecPath"] = ""
        if data["version"] == 16:
            data["version"] = 17
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["os"] = "Other"
        if data["version"] == 17:
            data["version"] = 18
            data["buttonPosition"]["zIndex"] = ""
        if data["version"] == 18:
            data["version"] = 19
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["sunshineApps"] = {
                    "showQuickAccessButton": False, "lastSelectedOverride": "Default"}
        if data["version"] == 19:
            data["version"] = 20
            data["enableMoondeckShortcuts"] = True
        if data["version"] == 20:
            data["version"] = 21
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["runnerTimeouts"]["steamLaunch"] = 5
                data["hostSettings"][host]["runnerTimeouts"]["steamLaunchAfterSuspend"] = 15
                data["hostSettings"][host]["runnerTimeouts"]["networkReconnectAfterSuspend"] = 15
        if data["version"] == 21:
            data["version"] = 22
            data["enableMoondeckButtonPrompt"] = False
        if data["version"] == 22:
            data["version"] = 23
            data["gameSession"]["controllerConfig"] = "Noop"
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["sunshineApps"]["lastSelectedControllerConfig"] = "Noop"
        if data["version"] == 23:
            data["version"] = 24
            data["pythonExecPath"] = ""
        if data["version"] == 24:
            data["version"] = 25
            for host in data["hostSettings"].keys():
                if data["hostSettings"][host]["os"] == "Windows":
                    data["hostSettings"][host]["resolution"]["passToBuddy"] = False
        if data["version"] == 25:
            data["version"] = 26
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["runnerTimeouts"]["steamReadiness"] = 60
                del data["hostSettings"][host]["runnerTimeouts"]["appUpdate"]
                del data["hostSettings"][host]["resolution"]["passToBuddy"]
        if data["version"] == 26:
            data["version"] = 27
            for host in data["hostSettings"].keys():
                del data["hostSettings"][host]["sunshineApps"]["lastSelectedOverride"]
                del data["hostSettings"][host]["sunshineApps"]["lastSelectedControllerConfig"]
                data["hostSettings"][host]["resolution"]["appResolutionOverrideForInternalDisplay"] = False
        if data["version"] == 27:
            data["version"] = 28
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["nonSteamApps"] = {
                    "showQuickAccessButton": False}
        if data["version"] == 28:
            data["version"] = 29
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["buddy"] = {
                    "bigPictureMode": True,
                    "port": data["hostSettings"][host]["buddyPort"],
                    "closeSteamOnceSessionEnds": data["hostSettings"][host]["closeSteamOnceSessionEnds"],
                    "hostApp": data["hostSettings"][host]["hostApp"],
                }
                del data["hostSettings"][host]["buddyPort"]
                del data["hostSettings"][host]["closeSteamOnceSessionEnds"]
                del data["hostSettings"][host]["hostApp"]
        if data["version"] == 29:
            data["version"] = 30
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["audio"] = {
                    "defaultOption": None,
                    "useLinkedAudio": True,
                    "linkedAudio": {}
                }
        if data["version"] == 30:
            data["version"] = 31
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["passToMoonlight"] = data["hostSettings"][host]["resolution"]["passToMoonlight"]
                del data["hostSettings"][host]["resolution"]["passToMoonlight"]
        if data["version"] == 31:
            data["version"] = 32
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["resolution"]["defaultHdr"] = None
                for i in range(len(data["hostSettings"][host]["resolution"]["dimensions"])):
                    data["hostSettings"][host]["resolution"]["dimensions"][i]["hdr"] = None
        if data["version"] == 32:
            data["version"] = 33
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["gameStreamApps"] = data["hostSettings"][host]["sunshineApps"]
                del data["hostSettings"][host]["sunshineApps"]
        if data["version"] == 33:
            data["version"] = 34
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["buddy"]["closeSteam"] = "Client" if data["hostSettings"][host]["buddy"]["closeSteamOnceSessionEnds"] else None
                del data["hostSettings"][host]["buddy"]["closeSteamOnceSessionEnds"]
        if data["version"] == 34:
            data["version"] = 35
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["videoCodec"] = None
                data["hostSettings"][host]["showPerformanceStats"] = None
                data["hostSettings"][host]["enableVSync"] = None
                data["hostSettings"][host]["enableFramePacing"] = None
        if data["version"] == 35:
            data["version"] = 36
            if data["gameSession"]["controllerConfig"] == "Noop":
                data["gameSession"]["controllerConfig"] = None
        if data["version"] == 36:
            data["version"] = 37
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["useCustomWolExec"] = False
                data["hostSettings"][host]["customWolExecPath"] = ""
        if data["version"] == 37:
            data["version"] = 38
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["wolSettings"] = {
                    "useCustomWolExec": data["hostSettings"][host]["useCustomWolExec"],
                    "customWolExecPath": data["hostSettings"][host]["customWolExecPath"],
                    "port": 9,
                }
                del data["hostSettings"][host]["useCustomWolExec"]
                del data["hostSettings"][host]["customWolExecPath"]
        if data["version"] == 38:
            data["version"] = 39
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["runnerTimeouts"]["userSwitch"] = 60
        if data["version"] == 39:
            data["version"] = 40
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["buddy"]["hibernateHost"] = False
        if data["version"] == 40:
            data["version"] = 41
            data["gameSession"]["autoSuspendHost"] = False
            for host in data["hostSettings"].keys():
                del data["hostSettings"][host]["runnerTimeouts"]["steamLaunchAfterSuspend"]
                del data["hostSettings"][host]["runnerTimeouts"]["networkReconnectAfterSuspend"]
        if data["version"] == 41:
            data["version"] = 42
            for host in data["hostSettings"].keys():
                data["hostSettings"][host]["wolSettings"]["sendOnce"] = False
        if data["version"] == 42:
            data["version"] = 43
            data["gameSession"]["closeHostAppOnExit"] = False
        if data["version"] == 43:
            # PyroDeck: Pyroshine and Pyrolight replace MoonDeck Buddy. Its
            # client ID, pairing, Steam control, host power commands, Non-Steam
            # sync and launch timeouts have no counterpart; closing the stream
            # never ends the host game, which is an explicit action instead.
            data["version"] = 44
            data.pop("clientId", None)
            data["gameSession"].pop("closeHostAppOnExit", None)
            data["gameSession"].pop("autoSuspendHost", None)
            for host in data["hostSettings"].keys():
                host_settings = data["hostSettings"][host]
                host_settings.pop("os", None)
                host_settings.pop("buddy", None)
                host_settings.pop("nonSteamApps", None)
                timeouts = host_settings["runnerTimeouts"]
                host_settings["runnerTimeouts"] = {
                    "servicePing": timeouts["servicePing"],
                    "wakeOnLan": timeouts["wakeOnLan"],
                    "steamLaunch": timeouts["steamLaunch"],
                }
                host_settings["enableVrr"] = None
