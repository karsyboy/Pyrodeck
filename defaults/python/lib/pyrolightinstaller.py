"""Install and update the Pyrolight AppImage from Pyrolight's GitHub releases.

PyroDeck installs exactly one copy, `~/Applications/Pyrolight.AppImage`, which
`find_pyrolight` then finds like a manually downloaded AppImage. Every
download is checked against the SHA-256 digest GitHub publishes for the
release asset (or the release's SHA256SUMS) before it replaces anything; the
replacement is an atomic rename, so a failed or cancelled update keeps the
previous AppImage. Executables installed by other means (a distribution
package on PATH, a selected file) are never modified.
"""

import asyncio
import re
from pathlib import Path
from typing import Optional

from . import constants
from .logger import logger

REPOSITORY = "karsyboy/pyrolight"
RELEASES_URL = f"https://api.github.com/repos/{REPOSITORY}/releases?per_page=30"
ASSET_PATTERN = re.compile(r"^pyrolight-v?(?P<version>[0-9][0-9A-Za-z.\-]*)-linux-x86_64\.AppImage$")
INSTALL_NAME = "Pyrolight.AppImage"
CHUNK_SIZE = 1 << 16
# An AppImage is an ELF executable with "AI" and its type at offset 8.
APPIMAGE_MAGIC = (b"\x7fELF", b"AI\x02")


class InstallerError(Exception):
    pass


def install_path() -> Path:
    return Path.home() / "Applications" / INSTALL_NAME


def state_path() -> Path:
    return constants.get_config_file_path().with_name("pyrolight-install.json")


def version_key(tag: str) -> tuple:
    """Order release tags: v6.2.8-prerelease < v6.2.8-prerelease.2 < v6.2.8 < v6.2.9."""
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-prerelease(?:\.(\d+))?)?", tag)
    if not match:
        return ()
    major, minor, patch, build, pre = match.groups()
    prerelease = "-prerelease" in tag
    return (int(major), int(minor), int(patch), int(build or 0), 0 if prerelease else 1, int(pre or 0))


def is_newer(candidate: str, installed: Optional[str]) -> bool:
    if not installed:
        return True
    new, old = version_key(candidate), version_key(installed)
    return bool(new and old) and new > old or (not old and candidate != installed)


def read_state() -> Optional[dict]:
    """The PyroDeck-installed AppImage, if it is still in place."""
    import json

    try:
        value = json.loads(state_path().read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(value, dict) or value.get("path") != str(install_path()) or not isinstance(value.get("tag"), str):
        return None
    return value if install_path().is_file() else None


def write_state(value: dict):
    import json
    import os
    import tempfile

    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix="pyrolight-install.")
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def ssl_context():
    """Verified TLS, also where the bundled Python has no default CA store."""
    import os
    import ssl

    try:
        import certifi  # type: ignore[import-not-found]
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    context = ssl.create_default_context()
    if not context.cert_store_stats().get("x509_ca"):
        for bundle in ("/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem"):
            if os.path.isfile(bundle):
                context.load_verify_locations(bundle)
                break
    return context


def select_release(releases: list, prerelease: bool) -> dict:
    """The newest published release with a Linux AppImage on the selected channel."""
    candidates = []
    for release in releases if isinstance(releases, list) else []:
        if not isinstance(release, dict) or release.get("draft") or (release.get("prerelease") and not prerelease):
            continue
        tag = release.get("tag_name")
        assets = [asset for asset in release.get("assets") or [] if isinstance(asset, dict)]
        appimage = next((asset for asset in assets if ASSET_PATTERN.match(str(asset.get("name")))), None)
        if not isinstance(tag, str) or not version_key(tag) or appimage is None:
            continue
        sums = next((asset for asset in assets if asset.get("name") == "SHA256SUMS"), None)
        candidates.append({
            "tag": tag,
            "prerelease": bool(release.get("prerelease")),
            "publishedAt": release.get("published_at"),
            "url": release.get("html_url"),
            "asset": {
                "name": appimage["name"],
                "size": appimage.get("size"),
                "url": appimage.get("browser_download_url"),
                "digest": appimage.get("digest"),
            },
            "sumsUrl": sums.get("browser_download_url") if sums else None,
        })
    if not candidates:
        raise InstallerError("No Pyrolight release with a Linux AppImage was found" +
                             ("." if prerelease else ". Include prereleases to see test builds."))
    return max(candidates, key=lambda candidate: version_key(candidate["tag"]))


class PyrolightInstaller:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.progress: dict = {"state": "idle"}

    @staticmethod
    def _session():
        import aiohttp

        return aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=None, connect=15, sock_read=60),
            headers={"User-Agent": "PyroDeck", "Accept": "application/vnd.github+json"},
            connector=aiohttp.TCPConnector(ssl=ssl_context()))

    async def latest(self, prerelease: bool) -> dict:
        async with self._session() as session:
            async with session.get(RELEASES_URL) as response:
                if response.status != 200:
                    raise InstallerError(f"GitHub answered {response.status} for Pyrolight's releases")
                return select_release(await response.json(), prerelease)

    async def check(self, prerelease: bool) -> dict:
        installed = read_state()
        release = await self.latest(prerelease)
        return {"schema": 1, "ok": True, "release": release, "installed": installed,
                "updateAvailable": is_newer(release["tag"], installed and installed["tag"])}

    async def _expected_digest(self, session, release: dict) -> str:
        digest = release["asset"].get("digest")
        if isinstance(digest, str) and digest.startswith("sha256:"):
            return digest[len("sha256:"):].lower()
        if release.get("sumsUrl"):
            async with session.get(release["sumsUrl"]) as response:
                if response.status == 200:
                    for line in (await response.text()).splitlines():
                        parts = line.split()
                        if len(parts) == 2 and parts[1].lstrip("*") == release["asset"]["name"]:
                            return parts[0].lower()
        raise InstallerError("The release publishes no SHA-256 checksum for its AppImage; nothing was installed")

    async def install(self, prerelease: bool) -> dict:
        """Download the newest AppImage of the channel and put it in place."""
        import hashlib
        import os
        import time

        if self.lock.locked():
            return {"schema": 1, "ok": False, "error": {"code": "busy", "message": "Pyrolight is already being installed"}}
        async with self.lock:
            target = install_path()
            partial = target.with_name(f".{INSTALL_NAME}.part")
            self.progress = {"state": "checking"}
            try:
                release = await self.latest(prerelease)
                size = release["asset"].get("size")
                self.progress = {"state": "downloading", "tag": release["tag"], "received": 0,
                                 "total": size if isinstance(size, int) else None}
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                async with self._session() as session:
                    expected = await self._expected_digest(session, release)
                    async with session.get(release["asset"]["url"], headers={"Accept": "application/octet-stream"}) as response:
                        if response.status != 200:
                            raise InstallerError(f"The AppImage download failed with HTTP {response.status}")
                        with open(partial, "wb") as output:
                            head = b""
                            async for chunk in response.content.iter_chunked(CHUNK_SIZE):
                                if len(head) < 11:
                                    head += chunk[:11 - len(head)]
                                output.write(chunk)
                                digest.update(chunk)
                                self.progress["received"] += len(chunk)
                            output.flush()
                            os.fsync(output.fileno())
                self.progress["state"] = "verifying"
                if digest.hexdigest() != expected:
                    raise InstallerError("The downloaded AppImage does not match the release checksum; nothing was installed")
                if head[:4] != APPIMAGE_MAGIC[0] or head[8:11] != APPIMAGE_MAGIC[1]:
                    raise InstallerError("The downloaded file is not an AppImage; nothing was installed")
                os.chmod(partial, 0o755)
                os.replace(partial, target)
                state = {"path": str(target), "tag": release["tag"], "prerelease": release["prerelease"],
                         "sha256": expected, "installedAt": time.time()}
                write_state(state)
                logger.info(f"Installed Pyrolight {release['tag']} at {target}")
                self.progress = {"state": "installed", "tag": release["tag"]}
                return {"schema": 1, "ok": True, "installed": state, "release": release}
            except Exception as error:
                message = str(error) or type(error).__name__
                if not isinstance(error, InstallerError):
                    logger.exception("Pyrolight installation failed")
                    message = f"Could not install Pyrolight: {message}"
                self.progress = {"state": "failed", "error": message}
                return {"schema": 1, "ok": False, "error": {"code": "install", "message": message}}
            finally:
                partial.unlink(missing_ok=True)
