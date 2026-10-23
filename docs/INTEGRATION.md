# PyroDeck integration

## Responsibilities and interfaces

PyroDeck owns Decky/Steam presentation, drafts, host choice and supervision of
its one Steam-owned runner. Pyrolight owns pairing, client preferences,
profiles, validation, negotiation, input and streaming. Pyroshine owns the
advertised application catalog, launching and retained host sessions.

| Interface | Contract |
| --- | --- |
| Pyroshine → Pyrolight | Paired HTTPS `/applist`, existing GameStream IDs and `PyroshineSource` launcher identities; authenticated artwork through `/appasset` |
| Pyrolight → PyroDeck settings | `pyrolight settings [--json REQUEST]`, schema 1; registry, values, profile IDs and revision |
| Pyrolight launch | `--no-quit-after --integration-events --settings-revision REV --app-id ID stream HOST_UUID` |
| Pyrolight catalog | `list --json ADDRESS[:PORT]`; UUID must match the saved host |
| Pyrolight artwork | `list --json --artwork-id ID ADDRESS[:PORT]`, bounded PNG data URI and checked host UUID |
| Pyrolight network tools | `list --json --network-action check\|calibrate\|fix HOST_UUID`; explicit user actions only |
| Pyrolight lifecycle | `PYROLIGHT_EVENT {"schema":1,"state":"streaming",…}` on stdout; actual Session signals, with negotiated codec, dimensions, FPS, bitrate and display backend |
| Explicit termination | `quit HOST_UUID --app-id ID --integration-events`; Pyroshine compares `expectedAppId` under its lifecycle lock |

No new network service, host credentials or GameStream implementation is
introduced in PyroDeck. Settings CLI calls use a same-user local socket when
the standalone GUI owns the settings. Without that GUI, a short-lived locked
process updates the same QSettings model. A GUI stream cannot accept external
preference writes until it disconnects; PyroDeck streams run in separate
processes with an immutable launch snapshot.

## Settings transaction model

The frontend keeps a draft in a shared store for the current plugin login.
Closing Quick Access keeps it; unloading/logging out discards unsaved edits.
All current settings require a reconnect. None is advertised as safely live.

A patch includes the revision read from Pyrolight. Validation checks the entire
patch before any property changes; stale revisions fail without interruption.
Profile operations use Pyrolight's own create/duplicate/rename/delete/activate
methods, and Default remains protected. Restoring defaults stages the active profile’s default values; saving or applying the draft leaves global preferences intact.

**Save for Next Session** persists preferences without reconnecting.
**Apply & Reconnect** validates, persists and explicitly suspends/resumes the
owned runner. It preserves the host and application ID. Success requires a new
`Session::streamingWindowReady` event with the expected preference revision.
A failed reconnect retains the draft and reports that preferences were saved
but the stream did not confirm them. It never issues `quit` or `/cancel`.
Retry, discard the draft, or launch the same game again. Discarding a draft
does not roll back a preference transaction already saved in Pyrolight.

The prepare-launch transaction saves current GUI edits before a client starts;
`--settings-revision` refuses a launch if that snapshot changed meanwhile.
The registry is generated from writable Qt properties. Tests ensure every
property has exactly one descriptor and a scalar value; adding unsupported
property types makes the parity test fail.

## Settings parity matrix

All rows are editable through Quick Access and the full settings page.
The registry identifies global versus profile scope; every row currently has
reconnect applicability. Standalone-only preferences apply to subsequent GUI
use. PyroDeck overrides quit-after only for its own sessions.

| Category | Settings | Scope |
| --- | --- | --- |
| Profiles | Active, create, duplicate, rename, delete, restore defaults | Pyrolight profile catalog |
| Video & Display | Width/height (custom included), FPS, bitrate, automatic bitrate, V-Sync, frame pacing, codec, HDR, YUV 4:4:4, display mode, VRR | Profile |
| VRR Advanced | Latency preset, buffer fraction, timing target, history, tolerance, reduce judder | Profile |
| Audio | Stereo/5.1/7.1, quality, host playback, focus-loss mute | Profile |
| Controller & Input | Multiple controllers, mouse/touch mode, gamepad mouse, swapped mouse buttons, background gamepad, scrolling, face-button layout, shortcut capture | Global |
| Advanced Streaming | Decoder, bitrate override, packet size, performance overlay, game optimization | Profile |
| Advanced Streaming | Quit-after (standalone), keep awake, rich presence, interface mode, language | Global |
| Platform-specific | Renderer selection on macOS; unsupported platform control hidden | Profile |
| Connection & Diagnostics | mDNS, connection checks, connection/configuration warnings | Global |
| Network tools | Receive-buffer inspection/remediation, explicit bandwidth calibration, stage recommendation | Actions; no automatic preference change |
| Read-only | Negotiated codec/dimensions/FPS/bitrate/chroma, Qt/SDL backend, active and stream profile, PyroWave decoder availability | Last confirmed stream snapshot |

PyroWave choices reflect the decoder probe. VRR timing controls depend on VRR;
VRR requires V-Sync. Automatic bitrate disables manual bitrate editing. HDR,
external display, refresh rate and decoder compatibility are finally checked
on the actual streaming display by Pyrolight. Per-frame decoder/latency/loss
counters remain in Pyrolight's performance overlay; the integration does not
invent those measurements.

## Steam Library and host selection

The library hook inserts a sibling after Steam's native action panel. It never
replaces Play/Install handlers or intercepts normal local launches. The small
Steam-tree adapter fails closed on unknown panel shapes and prevents duplicate
insertion. Its regression test retains the original Play/Install objects and
handlers. Actual Steam UI changes still require device acceptance.

Only validated catalogs advertising exactly one unambiguous match for
`steam:APPID` are eligible. Successful catalogs are retained for seven days,
bound to the configured executable, host UUID, address and port. Only an
unreachable host with Wake-on-LAN configured can use cached eligibility;
unpairing, identity changes, invalid responses and successful empty catalogs
invalidate old claims. Every launch rechecks the authenticated catalog.
The host selected in **Hosts & Pairing** is the persistent default. An eligible
default is selected for one-action launching. If it is absent, even a single
alternative requires explicit selection. Choosing an alternative on a game
page or in Remote Games does not change the default. Each launch pins its host
UUID. Changing an active session requires explicit switch confirmation;
resume defaults to the original host rather than a newly configured default.

One reusable hidden PyroDeck launcher gives Steam ownership of the client
process, input and overlay. Games already in the library need no individual
non-Steam shortcuts. Old generated shortcuts can still be inspected/purged;
optional manual shortcut sync remains separate from normal streaming.

## Remote Games

All advertised applications are shown, including entries without launcher
identities. Host selection, search, source filtering, name/recent sorting and
pagination use stable host/app IDs. Recently played means a connection
confirmed on this Deck, not a host-wide play history. Artwork comes from
Pyrolight's authenticated host request, then Steam metadata, then a title
initial. Catalogs are cached for 30 seconds, with explicit refresh; artwork is
bounded to 64 cached entries for an hour and at most two requests in flight.

Each card has a compact **⋯** action button and an **X** controller action that
open the native game menu. **Add to Steam Library** in that menu saves an individual
streaming shortcut, including the host's Steam/Big Picture entry. The menu closes
when its host, filter or page changes, or the view unmounts. Steam owns native
popup dismissal; a Quick Access visibility change while the popup has focus
must not close it. `ExternalAppShortcuts`
creates these with `PYRODECK_APP_TYPE=3`, `PYRODECK_LIBRARY_SHORTCUT=1`, the
host UUID and stable GameStream application ID. Discovery and launch
interception restore that target across plugin/Steam restarts. Duplicate
checks use host UUID plus application ID; names do not determine identity.
They join the PyroDeck collection and are removed using Steam's normal shortcut
controls. Legacy bulk sync/purge only manages name-based shortcuts.

Saved shortcuts retain their marker on launch and are excluded from shared
helper discovery, hiding and reuse. Normal browser launches still use the
hidden shared helper. A saved shortcut uses its own Steam entry and the active
Pyrolight profile, and rechecks the paired host's catalog before streaming.

## Session ownership and recovery

States distinguish none, waking, connecting, launching, streaming, disconnected,
reconnecting, ending, ended and failed. A private atomic observation file
carries runner generation and attempt; stale events cannot change a replacement
attempt. A dead owned runner is reported as failed rather than streaming.
Disconnect and suspend close only the owned Pyrolight process tree. Host games
remain available under Pyroshine's established retention policy. End Remote
Game always asks for confirmation and pins host/app identity. The conditional
host cancellation extension is required to protect against a different app
replacing the selected one during the request. It does not distinguish two
successive host sessions running the same application ID.

## Validation and remaining device acceptance

Automated checks cover settings/profile parity, revision conflicts and
cross-process IPC, atomic patch validation, failed apply/reconnect reporting,
no implicit reconnect/quit, host matching, all catalog types, artwork fallback
identities, native-action preservation, runner process ownership and host
conditional cancellation. See DEVELOPMENT.md for commands.

Real Steam Deck acceptance remains required for controller focus/restoration
in Quick Access, overlays, library and controller configuration; suspend/resume;
handheld/docked displays; HDR, 4:4:4, VRR; H.264/HEVC/AV1/PyroWave; surround
speakers; and real-host reconnects. Existing Pyrolight Gamescope ownership
logic is preserved, not replaced by globally disabling controllers. Builds
and fake-host tests do not establish these hardware behaviors.

## Menu layout and headless catalogs

Quick Access uses full-width native Steam dialog buttons with native focus
styling. Profiles, video, audio, input, connection, advanced settings and VRR
tuning share categories with the full settings sidebar. Profile editing and
remote-game filters expand only when requested. Legacy shortcut and launcher
tools live under Advanced Tools.

Quick Access subpages handle the native controller cancel event through a
`Focusable` around their content. Bubbling Back returns to PyroDeck's main menu
and stops before Decky's plugin-list handler; child controls and dialogs can
consume Back first. The main menu leaves Decky's normal Back behavior intact,
and retained hidden subpages do not handle cancel events.

Catalog commands must work from Decky's background service without a graphical
session. Pyrolight uses QCoreApplication for list/artwork/network commands and
help/capability queries. A Qt platform initialization failure is a client error,
not an offline host or an empty catalog; the UI points to updating the AppImage
and checking the executable path. No unauthenticated catalog fallback is used.

Pyroshine's Steam scanner reads installed app manifests and host Steam non-Steam
shortcuts. The latter advertise their full 64-bit Steam launch identity as a
string; they remain remote applications rather than Steam store games.
`steamSourceId` accepts only store IDs below `0x80000000`, so shortcut IDs are
never used for native-library matching or Steam CDN artwork requests. Other
advertised launcher, desktop and manual entries remain visible in Remote Games.

## Steam game context while streaming

The Library action uses Decky's supported `/library/app/:appid` route patch.
It preserves the original route children and adds a portal owner whose hidden
probe supplies the actual route's `ownerDocument`. Steam may render that route
in a different BrowserWindow from the plugin's global document; observing the
global document can leave the hook waiting for a panel that is in another window.
The portal uses an owned flex slot inside the native AppButtons group,
immediately before Steam Input. The adapter locates ControllerConfigButton
and inserts before its direct wrapper in that group, preserving tooltip
wrappers, native buttons and callbacks. It restores the slot if Steam replaces
or reorders the controls. There is no fixed positioning or corner overlay.
Button colors, hover, contrast and focus decoration come from Steam's
MenuButton class. A missing insertion target reports `steam_input_unavailable`.

A DOM portal retains the contexts of its React owner, not its DOM destination.
The route owner is outside the Library's nested focus providers, which made the
old action mouse-only despite using Focusable. `librarycontext.ts` collects
the committed native controls' nearest React providers (React 18 and 19), then
wraps the portal content with those values. Native Focusable/Button now
register under the same navigation parent as the controller/gear buttons,
with a row flow for Stream and its host chooser. The inline slot already has
the native DOM ancestry, so it bypasses the external-portal event bridge:
Steam's root maps raw input and direction/cancel events bubble normally. This
avoids duplicate activation while retaining the context bridge needed for
native focus registration.
No second navigation tree, global controller handler or automatic focus
stealing is installed. Context
changes observed during page updates rebind the action in place. A missing
navigation contract reports `focus_context_unavailable` and hides the action.

Steam's Play dropdown selects Steam streaming clients using
`SetStreamingClientForApp`; it has no arbitrary-action extension contract.
PyroDeck therefore keeps a separate Stream action beside Steam Input, rather
than representing a Pyrolight host as a Steam streaming client. The arrow on
Stream opens a native Menu/MenuItem context menu, anchored to that button and
preferring upward placement. Native menu selection/cancel restores focus; page
teardown also hides an outstanding menu. Default-host and resume rules remain
the same.

It reads the mounted panel's current React fiber, including the alternate tree,
so it follows reused panels and no longer depends on route renderFunc or
renderChildrenFunc shapes. A batched observer handles navigation, text updates
and visibility changes. Leaving the route removes the observer and owned
container; plugin unload also removes the exact registered route patch.
Steam's native action nodes and their callbacks are never replaced.

Browser launches with one exact Steam source use the matching local Library
entry when one exists; other apps retain remote identity. The original Steam
App ID and selected GameStream application ID travel together. The backend
checks that the advertised app still claims that Steam source before launch.
Reconnect retains both IDs and the selected host.

The helper always has a readable game name. Numeric-title association is no
longer used. The running-game adapter projects the matched Steam metadata when
Steam reads the owned helper through its overview lookup. It warms
the native details registration and releases it on disconnect. The projection
uses only the native descriptive title/sort metadata and artwork requests.
The helper retains its App ID, app type, shortcut classification, details, game
ID, running state and compositor override. Returning a native App ID or details
object for a helper lookup confuses launch/window ownership and is forbidden. The raw app map and process IDs stay
unchanged. Native-game lookups remain the original objects, preserving local
Play/Install and native launch configuration.

Explicit Resume, focus and close commands receiving the presentation ID are
directed to the helper. Window discovery queries keep their original IDs:
Steam's `ScopeRunningApps()` checks `BHasAppWindow()` for each raw app overview,
so aliasing the native game's window queries to the helper creates two running
entries for a single stream. No running-app list filtering is needed.
Exit disconnects only the owned stream; unrelated games pass through.
If the same native game is actually launching, running or terminating locally,
presentation and execution aliases are disabled so local play stays independent.
The adapters unregister on plugin unload and recover an owned active stream
after reload only when backend and shortcut Steam identities match. Recovery
cannot outlive plugin unload or override a new launch.

**Troubleshooting & Diagnostics** is directly accessible in Quick Access and
the settings sidebar, independent of preference loading. It reports Library
registration, selector/identity states, observed/visible panel and fiber counts,
provider count and native navigation availability,
the route document's visibility, current App ID, eligibility, client and
runner observations, errors/stages and bounded redacted logs. Host software
version is marked unavailable because the catalog does not advertise it.
Attachment observations are logged when they change. Missing panels no longer
retain the stale settings-loading message.

These integrations display Steam metadata; they do not synthesize local
playtime, achievements, cloud sync or host Steam rich presence. Automated tests
exercise React DOM mounting and the Decky patcher, but real Gaming Mode overlay,
controller navigation and Gamescope focus still require device acceptance on
the installed Steam client version.

## UI background work during streaming

Steam overview/artwork hooks first check the cached owned helper identity.
Unrelated app lookups return immediately, without reading helper/native MobX
state or registering dependencies on the running stream. The launcher subject
refreshes the identity when the owned app changes; helper operations still
validate local-running state and preserve execution/window ownership.

The Library MutationObserver filters before scheduling a frame. It ignores
PyroDeck's owned slot and unrelated focus/overlay animation. Panel visibility,
native control replacement, title/artwork structure, navigation, document
visibility and window focus still trigger attachment checks. The native title
region is included even when it lies outside PlaySection. No polling loop
replaces these DOM events. Inline transform/background changes and the native
`gpfocus`/`gpfocuswithin` flags do not schedule a layout or fiber scan; inline
display/visibility changes and other structural classes still do.

All mounted session views share one completion-paced two-second timer and one
in-flight status request. The timer stops when the last visible consumer
leaves; a slow request cannot accumulate more requests. Equal observations,
including timestamp-only updates, preserve the store snapshot. The latest
timestamp is tracked separately to reject stale responses. Settings/profile
controls subscribe to a separate snapshot, and Library/browser controls read
only the session snapshot. The runner also skips status-file replacements for
identical quality/window observations while preserving generation checks.

Quick Access visibility pauses its consumers' subscriptions and polling while
retaining their local page/search/profile state and the central settings draft.
The Library's automatic catalog refresh pauses while a client is active, so it
does not launch periodic headless catalog processes during gameplay. Navigation
to another game also reuses a loaded catalog during a stream, including after
its normal 30-second TTL. Initial uncached loads, explicit Refresh and
launch-time validation remain available. Concurrent
catalog/settings refreshes join their existing requests. Remote Games caches
filter/sort results until its catalog or filter controls change.

Host-status polling cancels idle timers as soon as its last consumer leaves.
A failure from an in-flight callback cannot revive a stopped loop. Logout and
login reset its lifecycle before the next consumer starts it. Diagnostics
clear errors on retry, show log-loading progress and ignore late responses
after a log selection change or unmount.

When Steam removes the owned Library slot while restoring a game page, the
observer reinserts that same container and React/controller controls. Its own
successful insertion is still ignored, avoiding a mutation feedback loop or
extra catalog fetch. Helper exit cleanup compares the launch generation rather
than immutable subject-object identity, and refreshes session state after
clearing the ended helper. Presentation changes within that generation cannot
leave the action disabled; an older exit cannot clear a newer launch.
Overlay Exit also completes generation-checked cleanup directly after the
owned runner stops, without depending on a second lifetime notification. Its
status refresh waits out any poll begun before Exit and then reads fresh state.
Owned-app changes, window focus and visibility schedule a Library scan plus
three settling checks (100, 400 and 1000 ms). A ResizeObserver on the discovered
native panels catches zero-size-to-visible restoration without DOM changes.
These observers/subscriptions/timers are removed with the route; no recurring
attachment polling runs while browsing or streaming.

A retained Library session offers an options arrow even with one eligible host.
End Remote Game uses the existing confirmation and `endHostGame` utility path,
pinned to the retained host/application instead of the selected alternative.
Before confirmation executes, the current session generation and identities
must still match and no resumed runner may be active. Ending is single-flight;
backend conditional cancellation remains the final check on the actual host app.
The context menu uses the button as its anchor; the confirmation modal uses
that button's `ownerDocument.defaultView`, since Steam keys modal managers by
Window. End failures are also surfaced as a toast if the game page loses focus.


## Launch progress and window observations

Native settings, Library registration and diagnostic routes start before the
optional non-Steam discovery retry loop. A login generation prevents late
initialization after unload. A synchronous launch guard protects independent
Library/browser presses even before a runner PID exists. Only the owned helper’s
lifetime notification or completed owned Exit operation clears its active launch.

The Python runner has no display dependency or fullscreen splash. The old
Pyglet canvas provided progress labels only, stayed alive for the full stream,
and never hid/closed when Pyrolight took over. Steam provides launch progress;
Quick Access and the Library show session progress. The shell exec and Python
parent retain ownership of Pyrolight. Display/Steam environment variables are
inherited unchanged; no forced X11 backend or detached client is introduced.

`connectionStarted` confirms transport, before SDL window creation. It emits
`transport_ready`, while `window` events report actual SDL ID, shown/focus state,
renderer availability, SteamGameId and the native X11 ID when available.
`streaming` now comes from `streamingWindowReady` after a shown window has a
renderer. The `windowReadiness` capability opts the runner into a bounded
60-second initialization watchdog; explicit client switch confirmation pauses
that budget. Failure stops only the owned client. Older clients remain usable
but their transport event records `window_unverified`, never confirmed streaming.

Shown-window/renderer observations do not prove compositor visibility, a first
video frame, audio output or controller focus. Those require Game Mode testing.
No spinner suppression or synthetic Steam success event is used.

Wake attempts run only inside the launch runner, not catalog/UI refreshes.
Existing send-once or bounded ten-second retry preferences are honored; the
configured wake timeout also bounds a custom wake command. UUID availability
checks precede Pyrolight’s paired, pinned-host catalog verification.

Confirmed switches pass `--terminate-app-id ID` once. The client compares the
current host app to that authorization and uses conditional server cancellation.
Changed apps and server refusal fail safely. Explicit Pyrolight switch dialogs
also pin the application seen at confirmation. Same-app reconnect uses the
existing resume path and never carries an old termination authorization.
