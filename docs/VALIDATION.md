# Implementation and validation report

## Completed changes

PyroDeck adds a separate eligible-host Steam Library streaming action while
retaining native Play/Install, one reusable Steam launcher, explicit default
and alternative host policy, a complete advertised-app browser, artwork/search/
filters/recent sorting, Quick Access categories, native profiles and persistent
in-memory drafts, explicit Apply & Reconnect, and pinned session controls.
Obsolete duplicated streaming settings views and the launch confirmation path
were removed. Host configuration migration and optional legacy shortcut cleanup
remain supported. The plugin version is 0.2.1.

Pyrolight adds schema-1 settings/profile transactions, a generated 46-property
registry, same-user GUI IPC with locked headless fallback, cross-process stale
write checks, prepare-launch revision checks, stable-ID stream/quit targets,
structured lifecycle and connection-quality events, negotiated diagnostics,
authenticated artwork and explicit native network tools. The existing profile,
bitrate, validation, controller-focus and transport implementations remain the
authority. No client streaming algorithm was redesigned.

Pyroshine retains its existing authenticated catalog and launcher identity
extension and adds optional conditional application cancellation under the
existing lifecycle lock. Standard GameStream clients keep their existing
requests and semantics. No client profiles, hot reload or privileged management
service was added to the host.

The architecture, interfaces, complete settings parity matrix, library adapter,
host policy, browser, transaction/failure semantics and device matrix are in
[INTEGRATION.md](INTEGRATION.md). User instructions are in [README](../README.md).

## App discovery and menu follow-up

The reported missing apps were caused by Pyrolight initializing Qt graphics
before executing `list`. Decky's service has no display variables; the AppImage
attempted EGLFS, which it does not ship, and aborted before querying applications.
List, artwork, network tools and help/capability queries now execute without Qt
platform or SDL video initialization. Pairing and pinned HTTPS remain enforced.
The plugin distinguishes this client startup failure from an empty catalog.

Quick Access and streaming settings use full-width native Steam buttons and
shared focused categories. Profile management and game filters expand on demand;
legacy tools are grouped separately. Settings descriptions explain disabled
controls and pending edits without repeating reconnect text on every row.

The standard client and the PyroWave AppImage both pass three real CLI regression
tests against temporary HTTP/HTTPS fixtures with intentionally invalid Qt/SDL
video drivers: catalog source IDs, artwork, network checks, unpaired refusal,
help and malformed help-like arguments. The headless suite is included in client
build CI. The final plugin passes lint, type checking, 29 frontend tests and 64
backend tests. The existing 16 client tests pass. Both install packages were built;
real Deck UI positioning, focus and contrast still need device acceptance.

Host Steam non-Steam shortcuts are not scanned from `shortcuts.vdf`. Apps must be
advertised through a supported Pyroshine scanner or manual configuration.

## Executed validation

| Check | Result |
| --- | --- |
| PyroDeck ESLint | Pass |
| PyroDeck TypeScript | Pass |
| Frontend Vitest | 29 passed across 4 files |
| Backend Python unittest | 64 passed, including loopback fake-host/process tests |
| Frontend Rollup bundle | Pass |
| Decky Docker packaging | Pass; local `out/Pyrodeck.zip` |
| Pyrolight Qt preference/profile/registry tests | 13 passed |
| Pyrolight same-user IPC and cross-process persistence tests | 4 passed |
| Pyrolight existing CMake/CTest suites | 16/16 passed, including Gamescope ownership and Qt gamepad navigation using temporary Xvfb servers |
| Pyrolight standard client build | Pass, with libplacebo disabled for this build |
| Pyrolight PyroWave/libplacebo-enabled client build | Pass with cached dependency headers/libraries |
| Actual native CLI smoke | Read, registry scalar types, create profile, patch, stale-write refusal, persistence and stream/quit/list help passed |
| Actual offscreen Pyrolight GUI + settings CLI IPC | Pass using isolated temporary configuration, no paired host |
| Pyroshine workspace tests, all features | 1,137 passed, 36 hardware-dependent tests ignored |
| Pyroshine Clippy, all targets/features, warnings denied | Pass |
| Pyroshine rustdoc, workspace/all features, warnings denied | Pass |
| Pyroshine rustfmt | Pass |
| Diff whitespace checks | Pass in all three repositories |

Local Python is 3.14; the existing CI also targets SteamOS Python 3.13. The
frontend dependency cache lacked the GNU Rollup native module and the client
test cache referenced a removed Xvfb. Temporary dependencies under `/tmp`
resolved those environment issues; no system package was installed. Tests
requiring local sockets were run with those sockets enabled.

Pyroshine's separate release-readiness check (`scripts/changelog.py check`)
remains failing because Cargo is v0.18.0-alpha.1 and the latest dated entry is
v0.18.0-alpha.0. The same mismatch exists in HEAD before this change. The new
conditional-cancel entry is under Unreleased; no release preparation, tagging,
upstream synchronization, pushing or deployment was performed.

## Unverified hardware and known limitations

This is an implemented integration with automated validation, not a claim of
production acceptance on SteamOS. A real Steam Deck and Pyroshine host must
still exercise library/controller focus, Quick Access/Steam overlays,
controller configuration, suspend/resume, handheld and docked displays,
H.264/HEVC/AV1/PyroWave, HDR, 4:4:4, VRR, stereo/surround and changed-setting
reconnects. No hardware performance or latency measurement was performed.

The Steam tree adapter is isolated and fails closed when its expected native
panel shape changes, but real Steam client compatibility is not established by
a synthetic tree test. Display/HDR/decoder restrictions that need the streaming
window are checked by Pyrolight at launch; the settings API cannot promise
unknown display capabilities before that window exists. Detailed rendered-FPS,
decoder and latency counters remain in Pyrolight's overlay. Quick Access shows
only negotiated stream snapshots and the native good/poor connection signal.

External preference writes during a stream started inside the standalone GUI
are refused until it disconnects. Normal PyroDeck streams use independent
client processes and support the explicit reconnect transaction. Drafts survive
Quick Access dismissal, but not plugin unload/logout. After failed reconnect,
saved preferences remain available for subsequent launches; discarding a draft
does not undo that already committed transaction.

Conditional cancellation distinguishes application IDs, not two successive
host sessions running the same application. Artwork and catalogs use bounded
caches, so explicit refresh or cache expiry may be required after host changes.
Old Pyrolight builds retain only the limited legacy launch path and cannot
provide the modern settings or lifecycle features. All three integration
builds are required for the full contract.

Outstanding work is the real-device acceptance matrix and any fixes it reveals;
instance-specific conditional cancellation and pre-launch display capability
probing are additional limits identified above. The project should not be
called hardware-validated until those acceptance checks are recorded.
