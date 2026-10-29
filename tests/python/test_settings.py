import json
import pathlib
import shutil
import tempfile
import unittest

import support  # noqa: F401  (sets sys.path)

from lib.plugin.settings import UserSettingsManager

# A MoonDeck 1.13 (version 43) settings file with one host and Buddy settings.
MOONDECK_43 = {
    "version": 43,
    "clientId": "6f1c7a8e-buddy-client",
    "currentHostId": "B1B2C3D4",
    "gameSession": {"autoApplyAppId": True, "closeHostAppOnExit": True, "resumeAfterSuspend": True,
                    "autoSuspendHost": True, "controllerConfig": "Enable"},
    "buttonPosition": {"horizontalAlignment": "bottom", "verticalAlignment": "right", "offsetX": "", "offsetY": "",
                       "offsetForHltb": False, "zIndex": ""},
    "buttonStyle": {"showFocusRing": True, "theme": "Clean"},
    "enableMoondeckShortcuts": True,
    "enableMoondeckButtonPrompt": False,
    "hostSettings": {
        "B1B2C3D4": {
            "hostInfoPort": 47989, "address": "192.168.1.10", "staticAddress": True, "hostName": "SuperCube",
            "mac": "AA:BB:CC:DD:EE:FF", "os": "Linux",
            "resolution": {"automatic": True, "appResolutionOverride": "CustomResolution",
                           "appResolutionOverrideForInternalDisplay": False, "useCustomDimensions": False,
                           "useLinkedDisplays": True, "selectedDimensionIndex": -1, "defaultBitrate": 40000,
                           "defaultFps": 90, "defaultHdr": None,
                           "dimensions": [{"width": 1280, "height": 800, "bitrate": None, "fps": None, "hdr": None,
                                           "linkedDisplays": ["internal"]}]},
            "audio": {"defaultOption": None, "useLinkedAudio": True, "linkedAudio": {}},
            "runnerTimeouts": {"buddyRequests": 5, "servicePing": 7, "initialConditions": 30, "streamReadiness": 30,
                               "steamReadiness": 60, "userSwitch": 60, "appLaunch": 30, "appLaunchStability": 15,
                               "streamEnd": 15, "wakeOnLan": 90, "steamLaunch": 5},
            "passToMoonlight": True, "showPerformanceStats": None, "enableVSync": None, "enableFramePacing": True,
            "videoCodec": "HEVC",
            "buddy": {"bigPictureMode": True, "port": 59999, "closeSteam": None,
                      "hostApp": {"selectedAppIndex": -1, "apps": []}, "hibernateHost": False},
            "gameStreamApps": {"showQuickAccessButton": False},
            "nonSteamApps": {"showQuickAccessButton": False},
            "wolSettings": {"useCustomWolExec": False, "sendOnce": False, "customWolExecPath": "", "port": 9},
        }
    },
    "runnerDebugLogs": False,
    "useMoonlightExec": True,
    "moonlightExecPath": "/home/deck/Applications/Moonlight.AppImage",
    "pythonExecPath": "",
}


class SettingsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix="pyrodeck-settings-"))
        self.addCleanup(shutil.rmtree, self.directory, ignore_errors=True)
        self.pyrodeck = self.directory / "pyrodeck" / "settings.json"
        self.moondeck = self.directory / "moondeck" / "settings.json"

    def write_moondeck(self, data=MOONDECK_43):
        self.moondeck.parent.mkdir(parents=True)
        self.moondeck.write_text(json.dumps(data))
        return self.moondeck.read_bytes()

    async def test_fresh_install_without_moondeck_gets_buddy_free_defaults(self):
        settings = await UserSettingsManager(self.pyrodeck, self.moondeck).read_or_update()
        self.assertEqual(settings["version"], 46)
        self.assertNotIn("clientId", settings)
        self.assertEqual(settings["hostSettings"], {})
        self.assertTrue(self.pyrodeck.exists())

    async def test_moondeck_settings_seed_pyrodeck_without_being_modified(self):
        original = self.write_moondeck()
        settings = await UserSettingsManager(self.pyrodeck, self.moondeck).read_or_update()

        self.assertEqual(self.moondeck.read_bytes(), original, "MoonDeck's file is never written")
        host = settings["hostSettings"]["B1B2C3D4"]
        self.assertEqual(settings["currentHostId"], "B1B2C3D4")
        self.assertEqual((host["address"], host["mac"], host["videoCodec"]), ("192.168.1.10", "AA:BB:CC:DD:EE:FF", "HEVC"))
        self.assertEqual(host["resolution"]["dimensions"][0]["linkedDisplays"], ["internal"])
        self.assertEqual(host["runnerTimeouts"], {"servicePing": 7, "wakeOnLan": 90, "steamLaunch": 5})
        self.assertIsNone(host["enableVrr"])
        for buddy_only in ("buddy", "os", "nonSteamApps"):
            self.assertNotIn(buddy_only, host)
        self.assertEqual(settings["gameSession"], {"autoApplyAppId": True, "resumeAfterSuspend": True,
                                                   "controllerConfig": "Enable"})
        # MoonDeck's executable was Moonlight; Pyrolight is detected again.
        self.assertFalse(settings["useMoonlightExec"])
        self.assertEqual(settings["moonlightExecPath"], "")

        written = json.loads(self.pyrodeck.read_text())
        self.assertEqual(written["version"], 46)

    async def test_existing_pyrodeck_settings_win_over_moondeck(self):
        await UserSettingsManager(self.pyrodeck, None).read_or_update()
        self.write_moondeck()
        settings = await UserSettingsManager(self.pyrodeck, self.moondeck).read_or_update()
        self.assertEqual(settings["hostSettings"], {})

    async def test_an_unreadable_moondeck_file_falls_back_to_defaults(self):
        self.write_moondeck({"version": 999, "garbage": True})
        settings = await UserSettingsManager(self.pyrodeck, self.moondeck).read_or_update()
        self.assertEqual(settings["version"], 46)
        self.assertEqual(settings["hostSettings"], {})


if __name__ == "__main__":
    unittest.main()

class NativeButtonMigrationTest(unittest.IsolatedAsyncioTestCase):
    async def test_v44_offsets_are_removed_and_explicit_disable_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "settings.json"
            manager = UserSettingsManager(path)
            old = manager._default_settings()
            old.update(version=44, enableMoondeckShortcuts=False,
                       buttonPosition={"offsetX": "999px"}, buttonStyle={"theme": "Clean"})
            path.write_text(json.dumps(old))
            migrated = await manager.read_or_update()
            self.assertEqual(migrated["version"], 46)
            self.assertFalse(migrated["enableMoondeckShortcuts"])
            self.assertNotIn("buttonPosition", migrated)
            self.assertNotIn("buttonStyle", migrated)


class PrereleaseSettingsTest(unittest.IsolatedAsyncioTestCase):
    async def test_v46_written_without_prerelease_keys_is_repaired(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "settings.json"
            old = UserSettingsManager(path)._default_settings()
            old.update(pyrolightPrereleases=True)
            del old["pyrodeckPrereleases"]
            path.write_text(json.dumps(old))
            settings = await UserSettingsManager(path, installed_version="0.3.0-prerelease.2").read_or_update()
            self.assertEqual((settings["version"], settings["pyrolightPrereleases"], settings["pyrodeckPrereleases"]),
                             (46, True, True))
            self.assertTrue(json.loads(path.read_text())["pyrodeckPrereleases"])

    async def test_pyrodeck_prereleases_follow_the_installed_version(self):
        with tempfile.TemporaryDirectory() as directory:
            for version, expected in (("0.3.0-prerelease.2", True), ("0.3.0", False), (None, False)):
                with self.subTest(version=version):
                    path = pathlib.Path(directory) / f"{version}.json"
                    settings = await UserSettingsManager(path, installed_version=version).read_or_update()
                    self.assertIs(settings["pyrodeckPrereleases"], expected)
                    self.assertFalse(settings["pyrolightPrereleases"])
