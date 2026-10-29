import hashlib
import unittest
from unittest.mock import patch

from support import isolate_state

from lib import pyrodeckupdate
from lib.githubreleases import ReleaseError


def release(tag, prerelease=False, base="", digest=True, sums=None):
    name = f"pyrodeck-{tag}.zip"
    assets = [{"name": name, "size": 10, "browser_download_url": f"{base}/{tag}/{name}",
               "digest": f"sha256:{hashlib.sha256(tag.encode()).hexdigest()}" if digest else None}]
    if sums is not None:
        assets.append({"name": "SHA256SUMS", "browser_download_url": f"{base}/{tag}/SHA256SUMS"})
    return {"tag_name": tag, "prerelease": prerelease, "draft": False, "assets": assets}


class PyroDeckUpdateTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp import web

        isolate_state(self)
        self.releases: list = []
        self.files: dict[str, str] = {}

        async def releases(_request):
            return web.json_response(self.releases)

        async def asset(request):
            body = self.files.get(request.path)
            return web.Response(text=body) if body is not None else web.Response(status=404)

        app = web.Application()
        app.router.add_get("/releases", releases)
        app.router.add_get("/{tail:.*}", asset)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.base = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"  # type: ignore[union-attr]
        patcher = patch.object(pyrodeckupdate, "RELEASES_URL", f"{self.base}/releases")
        patcher.start()
        self.addCleanup(patcher.stop)

    async def asyncTearDown(self):
        await self.runner.cleanup()

    async def test_the_channel_and_installed_version_decide_the_update(self):
        self.releases = [release("v0.3.0-prerelease.2", True, self.base), release("v0.2.9", base=self.base)]
        stable = await pyrodeckupdate.check("0.2.9", False)
        self.assertEqual(stable["release"]["tag"], "v0.2.9")
        self.assertFalse(stable["updateAvailable"])
        testing = await pyrodeckupdate.check("0.2.9", True)
        self.assertEqual(testing["release"]["tag"], "v0.3.0-prerelease.2")
        self.assertTrue(testing["updateAvailable"])
        self.assertEqual(testing["release"]["sha256"], hashlib.sha256(b"v0.3.0-prerelease.2").hexdigest())
        # A prerelease is older than its release, never offered over it.
        self.assertFalse((await pyrodeckupdate.check("0.3.0", True))["updateAvailable"])

    async def test_a_release_needs_a_checksum_for_decky_to_verify(self):
        digest = "ab" * 32
        self.releases = [release("v0.3.0", base=self.base, digest=False, sums=True)]
        self.files["/v0.3.0/SHA256SUMS"] = f"{digest}  pyrodeck-v0.3.0.zip\n"
        self.assertEqual((await pyrodeckupdate.check("0.2.9", False))["release"]["sha256"], digest)
        self.releases = [release("v0.3.0", base=self.base, digest=False)]
        with self.assertRaises(ReleaseError):
            await pyrodeckupdate.check("0.2.9", False)

    async def test_only_prereleases_are_reported_on_the_stable_channel(self):
        self.releases = [release("v0.3.0-prerelease.1", True, self.base)]
        with self.assertRaisesRegex(ReleaseError, "Include prereleases"):
            await pyrodeckupdate.check("0.3.0-prerelease.1", False)


if __name__ == "__main__":
    unittest.main()
