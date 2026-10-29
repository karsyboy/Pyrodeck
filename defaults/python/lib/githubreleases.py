"""Read PyroDeck's and Pyrolight's GitHub releases: channels, versions and checksums.

Release tags are vMAJOR.MINOR.PATCH[.BUILD] or vMAJOR.MINOR.PATCH-prerelease[.N]
(both repositories' release workflows enforce this). The stable channel
ignores prereleases; the prerelease channel takes the highest version of either
kind. Drafts are never used, and an asset is only offered with a SHA-256
checksum: GitHub's asset digest, else the release's SHA256SUMS.
"""

import re
from typing import Optional


class ReleaseError(Exception):
    pass


def releases_url(repository: str) -> str:
    return f"https://api.github.com/repos/{repository}/releases?per_page=30"


def version_key(tag: str) -> tuple:
    """Order release tags: v6.2.8-prerelease < v6.2.8-prerelease.2 < v6.2.8 < v6.2.9."""
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(-prerelease(?:\.(\d+))?)?", tag)
    if not match:
        return ()
    major, minor, patch, build, prerelease, number = match.groups()
    return (int(major), int(minor), int(patch), int(build or 0), 0 if prerelease else 1, int(number or 0))


def is_newer(candidate: str, installed: Optional[str]) -> bool:
    if not installed:
        return True
    new, old = version_key(candidate), version_key(installed)
    if new and old:
        return new > old
    return not old and candidate != installed


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


def session():
    import aiohttp

    return aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=None, connect=15, sock_read=60),
        headers={"User-Agent": "PyroDeck", "Accept": "application/vnd.github+json"},
        connector=aiohttp.TCPConnector(ssl=ssl_context()))


def select_release(releases: list, prerelease: bool, asset_pattern: re.Pattern, product: str) -> dict:
    """The newest published release on the channel with an asset matching `asset_pattern`."""
    candidates = []
    for release in releases if isinstance(releases, list) else []:
        if not isinstance(release, dict) or release.get("draft") or (release.get("prerelease") and not prerelease):
            continue
        tag = release.get("tag_name")
        assets = [asset for asset in release.get("assets") or [] if isinstance(asset, dict)]
        asset = next((asset for asset in assets if asset_pattern.match(str(asset.get("name")))), None)
        if not isinstance(tag, str) or not version_key(tag) or asset is None:
            continue
        sums = next((asset for asset in assets if asset.get("name") == "SHA256SUMS"), None)
        candidates.append({
            "tag": tag,
            "prerelease": bool(release.get("prerelease")),
            "publishedAt": release.get("published_at"),
            "url": release.get("html_url"),
            "asset": {
                "name": asset["name"],
                "size": asset.get("size"),
                "url": asset.get("browser_download_url"),
                "digest": asset.get("digest"),
            },
            "sumsUrl": sums.get("browser_download_url") if sums else None,
        })
    if not candidates:
        raise ReleaseError(f"No {product} release was found" +
                           ("." if prerelease else ". Include prereleases to see test builds."))
    return max(candidates, key=lambda candidate: version_key(candidate["tag"]))


async def latest(client, url: str, prerelease: bool, asset_pattern: re.Pattern, product: str) -> dict:
    async with client.get(url) as response:
        if response.status != 200:
            raise ReleaseError(f"GitHub answered {response.status} for {product}'s releases")
        return select_release(await response.json(), prerelease, asset_pattern, product)


async def expected_digest(client, release: dict) -> str:
    """The asset's SHA-256 as hex; ReleaseError when the release publishes none."""
    digest = release["asset"].get("digest")
    if isinstance(digest, str) and digest.startswith("sha256:"):
        return digest[len("sha256:"):].lower()
    if release.get("sumsUrl"):
        async with client.get(release["sumsUrl"]) as response:
            if response.status == 200:
                for line in (await response.text()).splitlines():
                    parts = line.split()
                    if len(parts) == 2 and parts[1].lstrip("*") == release["asset"]["name"]:
                        return parts[0].lower()
    raise ReleaseError(f"The release publishes no SHA-256 checksum for {release['asset']['name']}; nothing was installed")
