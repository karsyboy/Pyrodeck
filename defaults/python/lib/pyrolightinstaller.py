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

from . import constants, githubreleases
from .githubreleases import ReleaseError as InstallerError, is_newer, version_key  # noqa: F401
from .logger import logger

REPOSITORY = "karsyboy/pyrolight"
RELEASES_URL = githubreleases.releases_url(REPOSITORY)
ASSET_PATTERN = re.compile(r"^pyrolight-v?(?P<version>[0-9][0-9A-Za-z.\-]*)-linux-x86_64\.AppImage$")
INSTALL_NAME = "Pyrolight.AppImage"
CHUNK_SIZE = 1 << 16
# An AppImage is an ELF executable with "AI" and its type at offset 8.
APPIMAGE_MAGIC = (b"\x7fELF", b"AI\x02")


def install_path() -> Path:
    return Path.home() / "Applications" / INSTALL_NAME


def state_path() -> Path:
    return constants.get_config_file_path().with_name("pyrolight-install.json")


def select_release(releases: list, prerelease: bool) -> dict:
    """The newest release on the channel with a Linux AppImage."""
    return githubreleases.select_release(releases, prerelease, ASSET_PATTERN, "Pyrolight")


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


class PyrolightInstaller:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.progress: dict = {"state": "idle"}

    async def latest(self, prerelease: bool) -> dict:
        async with githubreleases.session() as client:
            return await githubreleases.latest(client, RELEASES_URL, prerelease, ASSET_PATTERN, "Pyrolight")

    async def check(self, prerelease: bool) -> dict:
        installed = read_state()
        release = await self.latest(prerelease)
        return {"schema": 1, "ok": True, "release": release, "installed": installed,
                "updateAvailable": is_newer(release["tag"], installed and installed["tag"])}

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
                async with githubreleases.session() as client:
                    expected = await githubreleases.expected_digest(client, release)
                    async with client.get(release["asset"]["url"], headers={"Accept": "application/octet-stream"}) as response:
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
