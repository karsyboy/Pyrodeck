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
`Session::connectionStarted` event with the expected preference revision.
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

Only paired hosts advertising exactly one match for `steam:APPID` are eligible.
The host selected in **Hosts & Pairing** is the persistent default. An eligible
default is selected for one-action launching. If it is absent, even a single
alternative requires explicit selection. Choosing an alternative on a game
page or in Remote Games does not change the default. Each launch pins its host
UUID; an existing session never switches hosts.

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

## Session ownership and recovery

States distinguish none, connecting, launching, streaming, disconnected,
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

Catalog commands must work from Decky's background service without a graphical
session. Pyrolight uses QCoreApplication for list/artwork/network commands and
help/capability queries. A Qt platform initialization failure is a client error,
not an offline host or an empty catalog; the UI points to updating the AppImage
and checking the executable path. No unauthenticated catalog fallback is used.

Pyroshine's Steam scanner reads installed app manifests. Host Steam non-Steam
shortcuts are not scanned; other advertised launcher, desktop and manual entries
remain visible in Remote Games.
