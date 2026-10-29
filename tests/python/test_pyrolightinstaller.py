import hashlib
import json
import os
import unittest
from unittest.mock import patch

from support import isolate_state

from lib import pyrolightinstaller
from lib.pyrolightinstaller import PyrolightInstaller, is_newer, select_release, version_key

APPIMAGE = b"\x7fELF\x02\x01\x01\x00AI\x02" + b"\x00" * 4096


def release(tag, prerelease=False, draft=False, payload=APPIMAGE, digest=True, base="http://127.0.0.1"):
    name = f"pyrolight-{tag}-linux-x86_64.AppImage"
    return {"tag_name": tag, "prerelease": prerelease, "draft": draft, "published_at": "2026-10-20T00:00:00Z",
            "html_url": f"https://github.com/karsyboy/pyrolight/releases/tag/{tag}",
            "assets": [
                {"name": f"pyrolight-{tag}-windows-x64-portable.zip", "size": 1, "browser_download_url": f"{base}/{tag}/zip"},
                {"name": name, "size": len(payload), "browser_download_url": f"{base}/{tag}/{name}",
                 "digest": f"sha256:{hashlib.sha256(payload).hexdigest()}" if digest else None},
            ]}


class ReleaseSelectionTest(unittest.TestCase):
    def test_versions_order_prereleases_before_their_release(self):
        tags = ["v6.2.8", "v6.2.8-prerelease.2", "v6.2.7", "v6.2.8-prerelease", "v6.2.10"]
        self.assertEqual(sorted(tags, key=version_key),
                         ["v6.2.7", "v6.2.8-prerelease", "v6.2.8-prerelease.2", "v6.2.8", "v6.2.10"])
        self.assertTrue(is_newer("v6.2.8", "v6.2.8-prerelease"))
        self.assertFalse(is_newer("v6.2.7", "v6.2.8-prerelease"))
        self.assertTrue(is_newer("v6.2.7", None))

    def test_the_channel_decides_whether_prereleases_count(self):
        releases = [release("v6.2.8-prerelease", prerelease=True), release("v6.2.9", draft=True), release("v6.2.7"), release("v6.2.6")]
        self.assertEqual(select_release(releases, False)["tag"], "v6.2.7")
        self.assertEqual(select_release(releases, True)["tag"], "v6.2.8-prerelease")
        # A newer stable release wins on the prerelease channel too.
        self.assertEqual(select_release([*releases, release("v6.2.8")], True)["tag"], "v6.2.8")

    def test_releases_without_a_linux_appimage_are_skipped(self):
        without = release("v6.2.9")
        without["assets"] = without["assets"][:1]
        self.assertEqual(select_release([without, release("v6.2.7")], False)["tag"], "v6.2.7")
        with self.assertRaises(pyrolightinstaller.InstallerError):
            select_release([without], False)


class InstallTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp import web

        self.directory = isolate_state(self)
        self.target = self.directory / "Applications" / "Pyrolight.AppImage"
        self.files: dict[str, bytes] = {}
        self.releases: list = []

        async def releases(_request):
            return web.json_response(self.releases)

        async def asset(request):
            body = self.files.get(request.path)
            return web.Response(body=body) if body is not None else web.Response(status=404)

        app = web.Application()
        app.router.add_get("/releases", releases)
        app.router.add_get("/{tail:.*}", asset)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.base = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"  # type: ignore[union-attr]
        for patcher in (patch.object(pyrolightinstaller, "RELEASES_URL", f"{self.base}/releases"),
                        patch.object(pyrolightinstaller, "install_path", lambda: self.target),
                        patch.object(pyrolightinstaller, "state_path", lambda: self.directory / "pyrolight-install.json")):
            patcher.start()
            self.addCleanup(patcher.stop)

    async def asyncTearDown(self):
        await self.runner.cleanup()

    def publish(self, tag, payload=APPIMAGE, served=None, **kwargs):
        """Publish `tag` with the checksum of `payload`, serving `served` (default: `payload`)."""
        value = release(tag, payload=payload, base=self.base, **kwargs)
        self.files[f"/{tag}/{value['assets'][1]['name']}"] = payload if served is None else served
        self.releases.insert(0, value)
        return value

    async def test_installs_and_updates_one_verified_executable_appimage(self):
        installer = PyrolightInstaller()
        self.publish("v6.2.7")
        result = await installer.install(False)
        self.assertTrue(result["ok"], result)
        self.assertEqual(self.target.read_bytes(), APPIMAGE)
        self.assertTrue(os.access(self.target, os.X_OK))
        self.assertEqual(pyrolightinstaller.read_state()["tag"], "v6.2.7")
        self.assertEqual(installer.progress["state"], "installed")

        self.publish("v6.2.8-prerelease", prerelease=True, payload=APPIMAGE + b"new")
        self.assertFalse((await installer.check(False))["updateAvailable"])
        checked = await installer.check(True)
        self.assertTrue(checked["updateAvailable"])
        self.assertEqual(checked["release"]["tag"], "v6.2.8-prerelease")
        self.assertTrue((await installer.install(True))["ok"])
        self.assertEqual(self.target.read_bytes(), APPIMAGE + b"new")
        self.assertEqual(json.loads((self.directory / "pyrolight-install.json").read_text())["tag"], "v6.2.8-prerelease")
        self.assertEqual([path.name for path in self.target.parent.iterdir()], ["Pyrolight.AppImage"])

    async def test_a_corrupt_or_unverifiable_download_keeps_the_installed_appimage(self):
        installer = PyrolightInstaller()
        self.publish("v6.2.7")
        self.assertTrue((await installer.install(False))["ok"])
        cases = {
            "v6.2.8": dict(payload=APPIMAGE + b"published", served=APPIMAGE + b"tampered"),
            "v6.2.9": dict(payload=b"<html>not an appimage</html>"),
            "v6.2.10": dict(digest=False),
        }
        for tag, kwargs in cases.items():
            with self.subTest(tag=tag):
                self.publish(tag, **kwargs)
                result = await installer.install(False)
                self.assertFalse(result["ok"])
                self.assertIn("nothing was installed", result["error"]["message"])
                self.assertEqual(installer.progress["state"], "failed")
                self.assertEqual(self.target.read_bytes(), APPIMAGE)
                self.assertEqual(pyrolightinstaller.read_state()["tag"], "v6.2.7")
                self.assertEqual([path.name for path in self.target.parent.iterdir()], ["Pyrolight.AppImage"])

    async def test_an_appimage_replaced_by_the_user_is_no_longer_managed(self):
        self.publish("v6.2.7")
        self.assertTrue((await PyrolightInstaller().install(False))["ok"])
        self.target.unlink()
        self.assertIsNone(pyrolightinstaller.read_state())


if __name__ == "__main__":
    unittest.main()
