"""Find PyroDeck updates on its GitHub releases.

Decky Loader installs the update: the frontend passes the release ZIP's URL
and SHA-256 to Decky's own plugin installer, which asks the user to confirm,
verifies the checksum, replaces the plugin and reloads it. This module only
chooses the release and its checksum.
"""

import re

from . import githubreleases

REPOSITORY = "karsyboy/pyrodeck"
RELEASES_URL = githubreleases.releases_url(REPOSITORY)
ASSET_PATTERN = re.compile(r"^pyrodeck-v[0-9][0-9A-Za-z.\-]*\.zip$")


async def check(current: str, prerelease: bool) -> dict:
    """The newest release on the channel, with its checksum, and whether it is newer than `current`."""
    async with githubreleases.session() as client:
        release = await githubreleases.latest(client, RELEASES_URL, prerelease, ASSET_PATTERN, "PyroDeck")
        release["sha256"] = await githubreleases.expected_digest(client, release)
    return {"schema": 1, "ok": True, "current": current, "release": release,
            "updateAvailable": githubreleases.is_newer(release["tag"], f"v{current}")}
