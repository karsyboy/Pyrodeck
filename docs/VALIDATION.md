# Implementation and validation report

## Evidence and causes

The checkout investigated was PyroDeck `8011dff`, Pyrolight `e0e48d81` and
Pyroshine `ac27451`. No upstream synchronization or publishing was performed.
No Steam Deck Game Mode trace was available during the initial implementation.
The subsequent user-supplied logs and diagnostic photo are described below.

| Finding | Evidence and correction |
| --- | --- |
| Library startup can be blocked by unrelated discovery | `src/index.tsx` registered routes only after `getAllNonSteamAppDetails()` succeeded. `src/lib/pluginstartup.ts` now registers native services first and retries optional discovery independently. Tests reproduce unavailable discovery and unload during initialization. |
| Offline eligibility disappeared | `eligibleHosts()` accepted only live paired results, and `Integration.catalogs()` overwrote availability on outages. UUID/endpoint-bound validated caches now preserve unambiguous known games for bounded offline waking. |
| Reused pages could retain action state | Library controls previously reused catalog/host state across App IDs; asynchronous initialization did not always reset host selection. Portals are keyed by App ID, stale queries are cancelled and current committed fibers are validated. Compound CSS classes and teardown are covered. |
| Helper identity was mixed with the native game | `installSteamPresentation()` returned a native `appid`, `app_type`, shortcut classification and details for helper lookups. Only descriptive metadata/artwork are now projected; helper execution identity and details remain intact. Regression tests check both native local behavior and helper window IDs. |
| Runner kept a competing fullscreen surface | `run_with_suspend_resume()` held the Pyglet fullscreen canvas for the entire client lifetime. Its role was progress labels/WOL; it supplied no Steam ownership or window-transfer protocol. Progress now uses Steam and session state without a Python display/window dependency. |
| Transport readiness was incorrectly reported as streaming | `Session::connectionStarted` occurs before `SDL_CreateWindow()` and renderer initialization. Pyrolight now reports transport separately, then observed window/renderer readiness. The runner watchdog catches missing-window/initialization failures and reaps the owned client. |
| Resume could be lost during suspension cleanup | The runner cleared the resume event after cancelling the client. It now clears before the attempt and retains signals delivered during cleanup; the race has a regression. |

These are confirmed code defects and contract corrections. They do **not** prove
which failure caused the reported device's missing button or persistent spinner.
The actual installed Steam/Decky DOM, process tree and Gamescope focus sequence
remain unverified. Pyroshine's current source already advertises exact Steam
identities and implements conditional cancellation; no host change was needed.

## Automated validation

| Check | Result |
| --- | --- |
| PyroDeck ESLint | Pass |
| PyroDeck TypeScript | Pass |
| Frontend Vitest | 101 tests passed across 12 files |
| Library visual fixture with installed Steam CSS | Checked at 1280×800 and 800×500; idle/focused buttons and footer clearance |
| Backend Python unittest | 80 tests passed |
| Python compilation | Pass |
| Rollup frontend bundle | Pass |
| Decky Docker packaging | Pass; local `out/Pyrodeck.zip` |
| Pyrolight standard client build | Pass, libplacebo disabled |
| Pyrolight PyroWave/libplacebo client build | Pass |
| Pyrolight CMake/CTest | 17/17 passed, including Gamescope ownership, controller navigation and conditional-switch policy |
| Pyrolight settings/profile Qt tests | 13 passed |
| Pyrolight settings IPC Qt tests | 4 passed |
| Real headless CLI against local HTTPS fixtures | 3 passed for each standard/PyroWave client |
| Diff whitespace checks | Pass |

Tests ran on Linux with Python 3.14, Qt 6.12, Node 26 and the installed Decky
UI 4.11.1/API 1.1.3. Existing CI also exercises SteamOS Python 3.13; it was not
run locally. Missing Rollup, SDL2_ttf, Vulkan-header and Xvfb dependencies were
restored under `/tmp`; no system package installation was needed. Local fixture
sockets and sanitizer process inspection required execution outside the sandbox.

The frontend tests cover real React DOM navigation/mounting, native Play
preservation, missing structures, reload cleanup, eligibility, default and
alternative hosts, offline wake eligibility, resume targeting, Retry, launch
serialization, helper failure, Steam timeout/cancellation cleanup and confirmed
switching. Backend tests include fake-host/process ownership, real child cleanup,
readiness failures, profile preservation, one-shot termination authorization,
corrupt/expired/offline caches, diagnostic redaction and the early-resume race.
These are automated contract checks, not hardware acceptance.

## 0.2.4 follow-up: Library attachment and duplicate overlay entries

The supplied `pyrodeck-.zip` logs show Library integration enabled, normal
startup, and a single Valheim helper launch. They contain no successful Library
attachment. The user's diagnostic text and photo show `waiting_for_page`, stale
`Loading settings`, no Steam App ID and no eligible hosts. That phase precedes
host eligibility checks: the observer found no visible Library action panel.
The user reports that streaming otherwise works, but this does not verify all
the acceptance cases below.

Inspection of the locally installed Steam `steamui/sp.js` confirms the
`/library/app/:appid` route, PlaySection/overview panel, owning overview props,
separate BrowserWindow support, and `ScopeRunningApps()`'s window scan.
Decky's route-hook source confirms that supported route patches wrap route
children. The previous global observer could watch a different document from
the Library page. The replacement wraps that Library route and takes the
observed document from a rendered probe. A real React DOM regression renders
the route in a separate iframe document and checks attachment, navigation,
route exit/reentry, reload, one action, and unchanged native Play callbacks.
The separate-window mismatch is a reproducible failure mode; its occurrence
on the user's device still needs the new build's observations to confirm.

The duplicate overlay entry has a reproducible code cause: redirecting the
native game's `BHasAppWindow`/`GetAppWindowIDs` reads to the helper makes Steam's
raw running-app scan include both IDs. Read aliases are removed; only explicit
Resume/focus/close commands redirect. Regressions run the nested window-query
scan and verify one helper entry while preserving a genuinely running local
copy as a separate entry. The helper keeps its title, artwork and execution ID.

Diagnostics now replace the stale loading label with the current failure phase
and log selector, panel, visible-panel, fiber and document-visibility counts.
Version 0.2.4 identifies this plugin build. No further runner, Pyrolight or
Pyroshine changes were needed for this follow-up. The user subsequently
confirmed that the action appears, launching it starts streaming, and Shift+Tab
shows only one Valheim. The user also reported poor placement/styling and no
controller navigation; those remaining problems are addressed below.

## 0.2.5 follow-up: Library appearance and controller navigation

The old bare Button had no native Library class. Its route-owned portal also
retained the route owner's React contexts, not the destination panel's nested
navigation contexts. Steam's installed Focusable implementation registers a
node only when its parent navigation context exists, so a visible button could
still be unreachable by controller.

The new corner action uses Steam's MenuButton styling with a labelled Stream
button and compact host arrow. It sits at bottom right above the native footer.
It bridges the nearest committed native controller/gear controls' React
providers so its Focusable registers in the same tree. A native context menu
replaces the inline host form and handles controller select/cancel. The
installed Play dropdown is tied to Steam streaming-client selection, so the
requested corner fallback avoids changing local Play or advertising fake
Steam clients.

Regressions verify nested-provider precedence, React 18/19 provider shapes,
native navigation registration in a separate document, raw button-down mapping
on the original target, OK activation and direction/cancel bubbling to native
controls, context replacement, cleanup, missing-focus diagnostics, native button
classes/ring/row flow, host-menu anchoring, default-host absence and menu
teardown. The visual fixture renders the actual StreamAction with installed
Steam CSS and stand-in native primitives. It is **not** a live Steam UI or
physical controller test. Real 0.2.5 Game Mode D-pad reachability, A activation,
B cancellation, focus restoration and overlay stacking are **not verified**.
No runner, Pyrolight or Pyroshine changes were needed for this UI follow-up.

## 0.2.6 follow-up: inline placement before Steam Input

At the user's request, Stream now occupies the native AppButtons row directly
before Steam Input instead of the corner. Insertion respects Steam Input's
outer wrapper and restores the slot after native control updates. Focus
contexts are retained, while the external-portal event bridge is bypassed
because the inline DOM already bubbles to Steam's root. Regressions verify
placement/order, native Steam Input and Play handlers, raw A activation once,
direction/cancel bubbling, navigation and teardown. Device confirmation of
this placement and physical controller navigation is still outstanding.

## 0.2.7 performance follow-up

The completed Library/streaming changes were committed as `c246e1c` before
performance work began, as requested. No upstream synchronization or push was
performed. The following checks ran against the pre-optimization code and the
updated implementation; they count operations, not device CPU time or FPS.

| Reproduction | Before | After |
| --- | --- | --- |
| Read 10,000 unrelated app overviews while a stream is mapped | 30,000 underlying lookups | 10,000 underlying lookups; zero extra helper/native reads |
| Change native stream state while an unrelated MobX game view observes its overview | The lookup reads stream/native state and adds unrelated dependencies | Unrelated view remains at one render |
| Five batches of unrelated/native focus animation and owned-slot updates | 10 fiber reads | Zero fiber reads after initial attachment |
| Four simultaneous status refreshes | Four backend calls | One backend call |
| Poll an unchanged session with a newer timestamp | Store replacement and subscriber notification | Same snapshot; no subscriber notification |

Four session consumers now share one timer; the fake-clock test observes five
requests across the initial fetch and eight seconds, with no timer after the
last consumer leaves. A blocked backend request creates no queue or restarted
poll after teardown. Hidden-view tests observe no polling or renders from
external session changes, then restore the latest state with local UI state
preserved. The Library catalog test observes only its initial request over
60 seconds of active streaming; the periodic refresh resumes after disconnect.
Settings/profile snapshots stay stable across session-only changes. Existing
navigation, native actions, controller events, resume and launch cleanup tests
remain green.

These findings confirm avoidable code work, including broad Steam MobX
dependencies and overlapping polling. They do not prove which cost dominates
the reported device's lag. Real Game Mode frame time/CPU and sustained-stream
responsiveness are **not verified**. Compare Quick Access, Library navigation
and Steam Input/Shift+Tab during a sustained Valheim stream after installing
0.2.7. No Pyrolight, Pyroshine or backend protocol changes were needed.

## Required Steam Deck acceptance — not verified

Use a paired Pyroshine host with retained sessions and the matching Pyrolight
build. Record SteamOS, Steam client, Decky, PyroDeck, Pyrolight, host versions
and handheld/docked display configuration.

1. Open Valheim's native Library page; verify one Stream action immediately
   left of Steam Input, controller focus, and unchanged local actions. Move
   right from Play to Stream, select with A, open the host arrow,
   select/cancel with A/B, and verify focus returns to that arrow. Navigate to
   another game and back; repeat after plugin reload and Steam restart.
2. Launch Valheim from Library and Remote Games. Verify the helper reaches its
   real running notification, Steam's spinner clears naturally, and video/audio
   are usable. Check name/artwork, Steam Input, Shift+Tab and Quick Access.
   Verify a single Valheim entry when only the remote game is running.
3. Close overlays and verify input focus returns. Disconnect/Steam Exit, verify
   owned processes/windows close, return to the native Library and resume the
   retained game on its original host with the active profile.
4. Confirm and cancel switches on the same host and between hosts. Verify
   conditional cancellation refuses a changed application or unsafe host state.
5. Wake a known offline host, test wake timeout and Retry, and verify catalog
   refreshes do not start extra wake/launch attempts.
6. Suspend during connection, streaming and reconnect; resume or cancel while
   cleanup runs. Repeat handheld/docked, where equipment is available.

For a persistent spinner, collect **Troubleshooting & Diagnostics** and all four
log tails immediately. Correlate the helper's Steam launch action/lifetime,
runner PID/parent and inherited display/Steam variables, Pyrolight lifecycle,
SDL/native window ID, shown/renderer/focus flags and SteamGameId. In Game Mode,
compare that native window to Gamescope's `GAMESCOPE_FOCUSED_APP`,
`GAMESCOPE_FOCUSED_APP_GFX` and `GAMESCOPE_FOCUSABLE_WINDOWS` on its X root where
available. SDL shown/renderer readiness without compositor visibility needs a
Gamescope/window-identity trace; absent renderer readiness needs the client log.

## Remaining limits

The Library/Fiber and metadata adapters use private Steam interfaces behind
owned, validated, removable adapters. Real client compatibility is outstanding.
Inline placement adds only an owned slot and preserves Steam's native action
nodes and handlers. Context bridging depends on validated private provider/navigation shapes and must be
retested after Steam UI updates; an incompatible focus context fails closed.

Window readiness does not attest first-frame presentation, audio or compositor
focus. Older clients remain launchable with unverified window state and cannot
confirm settings reconnects. Host software version is explicitly unavailable
when not advertised. Safe conditional switching requires the matching host
implementation; application IDs do not distinguish two successive instances
of the same host game. Catalog availability expires after seven days and is
always revalidated at launch. No live host, Steam Deck, deployment, hardware
performance or latency measurement was used for this work.
