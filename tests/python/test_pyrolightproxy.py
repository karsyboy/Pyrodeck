import json
import os
import pathlib
import shutil
import stat
import tempfile
import time
import unittest
from unittest import mock

import support  # noqa: F401  (sets sys.path)

from lib.pyrolightproxy import (Capabilities, CommandLineOptions, PyrolightListError, build_stream_args,
                                classify_list_failure, find_pyrolight, needs_capability_probe, parse_app_list,
                                parse_capabilities, pyrolight_host)

# `pyrolight stream --help` of Pyrolight 6.2.7 with PyroWave, as Qt wraps it.
PYROLIGHT_HELP = """Usage: /opt/pyrolight/usr/bin/pyrolight [options] stream <host> "<app>"
  --vrr                                        Use variable refresh rate
                                               presentation (requires V-Sync).
  --no-vrr                                     Do not use variable refresh rate
  --video-codec <video-codec>                  Select video codec:
                                               AV1/H.264/HEVC/PyroWave/auto.
  --video-decoder <video-decoder>              Select video decoder:
                                               auto/hardware/software.
"""


def options(**overrides) -> CommandLineOptions:
    values: dict = {"audio": None, "resolution": None, "quit_after": None, "show_performance_stats": None,
                    "enable_v_sync": None, "enable_frame_pacing": None, "enable_vrr": None, "video_codec": None}
    values.update(overrides)
    return CommandLineOptions(values)  # type: ignore[typeddict-item]


class StreamArgumentsTest(unittest.TestCase):
    def test_the_app_name_is_one_argument_whatever_it_contains(self):
        name = "Tom Clancy's \"Rainbow\" Six; rm -rf ~ $(id)"
        self.assertEqual(build_stream_args("192.168.1.10", name, None), ["stream", "192.168.1.10", name])

    def test_settings_map_to_pyrolight_options(self):
        args = build_stream_args("host", "Valheim", options(
            audio="5.1-surround",
            resolution={"size": {"width": 1280, "height": 800}, "bitrate": 20000, "fps": 90, "hdr": False},
            quit_after=False, show_performance_stats=True, enable_v_sync=False, enable_frame_pacing=True))
        self.assertEqual(args, ["--audio-config", "5.1-surround", "--resolution", "1280x800", "--fps", "90", "--no-hdr",
                                "--bitrate", "20000", "--no-quit-after", "--performance-overlay", "--no-vsync",
                                "--frame-pacing", "stream", "host", "Valheim"])

    def test_unset_settings_leave_pyrolight_defaults(self):
        self.assertEqual(build_stream_args("host", "Valheim", options()), ["stream", "host", "Valheim"])

    def test_codecs_and_vrr_need_a_build_that_offers_them(self):
        capabilities = parse_capabilities(PYROLIGHT_HELP)
        self.assertEqual(capabilities, Capabilities(video_codecs={"AV1", "H.264", "HEVC", "PyroWave", "auto"}, vrr=True))

        args = build_stream_args("host", "Valheim", options(video_codec="PyroWave", enable_vrr=True), capabilities)
        self.assertEqual(args[:4], ["--vrr", "--video-codec", "PyroWave", "stream"])

        without = Capabilities(video_codecs={"AV1", "H.264", "HEVC", "auto"}, vrr=False)
        self.assertEqual(build_stream_args("host", "Valheim", options(video_codec="PyroWave", enable_vrr=True), without),
                         ["stream", "host", "Valheim"])
        self.assertEqual(build_stream_args("host", "Valheim", options(video_codec="HEVC"), None),
                         ["stream", "host", "Valheim"])
        self.assertEqual(build_stream_args("host", "Valheim", options(video_codec="Auto"), None),
                         ["--video-codec", "auto", "stream", "host", "Valheim"])
        self.assertEqual(build_stream_args("host", "Valheim", options(video_codec="H.264"), capabilities)[:2],
                         ["--video-codec", "H.264"])

    def test_only_codec_and_vrr_settings_need_a_probe(self):
        self.assertFalse(needs_capability_probe(options()))
        self.assertFalse(needs_capability_probe(options(video_codec="Auto", enable_v_sync=True)))
        self.assertTrue(needs_capability_probe(options(video_codec="PyroWave")))
        self.assertTrue(needs_capability_probe(options(enable_vrr=False)))


class HostArgumentTest(unittest.TestCase):
    def test_the_port_is_added_only_when_it_is_not_the_default(self):
        self.assertEqual(pyrolight_host("192.168.1.10", 47989), "192.168.1.10")
        self.assertEqual(pyrolight_host("192.168.1.10", 48089), "192.168.1.10:48089")
        self.assertEqual(pyrolight_host("host.lan", 50000), "host.lan:50000")
        self.assertEqual(pyrolight_host("fd00::5", 48089), "[fd00::5]:48089")


class AppListTest(unittest.TestCase):
    def document(self, **overrides):
        data = {"schema": 1, "host": {"name": "SuperCube", "uuid": "B1B2"},
                "apps": [{"name": "Valheim", "id": 5, "hdrSupported": True, "hidden": False, "sources": ["steam:892970"]},
                         {"name": "Desktop", "id": 6, "hdrSupported": False, "hidden": False, "sources": []}]}
        data.update(overrides)
        return json.dumps(data)

    def test_parses_apps_and_launcher_identities(self):
        app_list = parse_app_list(("Establishing connection to PC...\n" + self.document() + "\n").encode())
        self.assertEqual((app_list.host_name, app_list.host_uuid), ("SuperCube", "B1B2"))
        self.assertEqual([(app.name, app.id, app.sources) for app in app_list.apps],
                         [("Valheim", 5, ["steam:892970"]), ("Desktop", 6, [])])

    def test_older_or_other_hosts_simply_have_no_sources(self):
        document = json.loads(self.document())
        for app in document["apps"]:
            del app["sources"]
        self.assertEqual(parse_app_list(json.dumps(document)).apps[0].sources, [])

    def test_rejects_unknown_schemas_and_malformed_output(self):
        for output in [self.document(schema=2), "Valheim\nDesktop\n", "", self.document(apps=[{"name": 3, "id": 1}]),
                       self.document(apps=[{"name": "X", "id": 1, "sources": "steam:1"}])]:
            with self.assertRaises(ValueError, msg=output):
                parse_app_list(output)

    def test_classifies_list_failures(self):
        self.assertEqual(classify_list_failure("Computer X has not been paired. Please open Moonlight").reason, "not_paired")
        self.assertEqual(classify_list_failure("Failed to connect to 10.0.0.2").reason, "unreachable")
        self.assertIsInstance(classify_list_failure(""), PyrolightListError)
        self.assertEqual(classify_list_failure("boom").reason, "failed")


class FindPyrolightTest(unittest.TestCase):
    def setUp(self):
        self.home = pathlib.Path(tempfile.mkdtemp(prefix="pyrodeck-home-"))
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)
        patcher = mock.patch.dict(os.environ, {"HOME": str(self.home), "PATH": str(self.home / "bin")})
        patcher.start()
        self.addCleanup(patcher.stop)

    def make(self, relative: str, executable=True) -> str:
        path = self.home / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("#!/bin/sh\n")
        if executable:
            path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return str(path)

    def test_a_configured_path_is_used_only_if_executable(self):
        configured = self.make("custom/pyrolight", executable=False)
        self.make("Applications/Pyrolight-v6.2.7-linux-x86_64.AppImage")
        self.assertIsNone(find_pyrolight(configured), "a broken setting is reported, not replaced")
        os.chmod(configured, 0o755)
        self.assertEqual(find_pyrolight(configured), configured)

    def test_prefers_path_then_the_newest_appimage(self):
        self.assertIsNone(find_pyrolight(None))
        old = self.make("Applications/Pyrolight-v6.2.6-linux-x86_64.AppImage")
        new = self.make("Downloads/pyrolight-v6.2.7-linux-x86_64.AppImage")
        self.make("Applications/Moonlight-6.1.0-x86_64.AppImage")
        os.utime(old, (time.time() - 100, time.time() - 100))
        self.assertEqual(find_pyrolight(None), new)
        on_path = self.make("bin/pyrolight")
        self.assertEqual(find_pyrolight(None), on_path)


if __name__ == "__main__":
    unittest.main()
