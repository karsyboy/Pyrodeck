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
| Frontend Vitest | 123 tests passed across 15 files |
| Library visual fixture with installed Steam CSS | Checked at 1280×800 and 800×500; idle/focused buttons and footer clearance |
| Backend Python unittest | 82 tests passed |
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

## 0.2.8 highlight, streaming work and release polish

The user confirmed that the action immediately left of Steam Input works with
the intended navigation. The primary action and host arrow now highlight
Steam green (`#8bc53f`) on hover, DOM focus and `gpfocus`, with dark text/icons.
Disabled buttons retain their native state. A visual fixture using the installed
Steam stylesheet confirmed focus on both buttons, including computed colors;
`out/Pyrodeck-0.2.8-preview.png` captures the main action. This is a fixture,
not a capture from Game Mode or proof of physical-controller behavior.

The new regression cases verify:

- Five batches of 200 ancestor transform/focus updates cause zero layout reads
  and zero fiber reads after attachment. Hide/show and inline display changes
  still trigger validation; existing navigation and focus-context tests pass.
- Expired catalogs remain cached during an active stream and while navigating
  to another game's page. Explicit refresh bypasses that cache; normal expiry
  resumes after disconnect. Uncached loads and launch validation remain intact.
- One hundred duplicate quality/window observations cause zero status-file
  replacements. A changed quality writes once; stale generations stay ignored.
- Host polling releases idle timers immediately, cannot restart after a late
  failure during teardown, and restarts after a fresh login lifecycle.
- Diagnostics recover from a transient error and discard a stale log response
  after the selected log changes. Loading actions prevent duplicate UI requests.

All 109 frontend and 82 backend tests pass, along with lint/type checks and
the frontend/package builds. The package version is 0.2.8. These changes remove
confirmed avoidable work, but no Deck frame-time/CPU trace was available to
identify the dominant cause of streaming-only Library stutter. Sustained
streaming and Library scrolling on the target hardware remain required before
calling this release production validated. No client/host build changes, push
or deployment were performed for this follow-up.

## 0.2.9 connecting-button layout

The visual fixture reproduced the primary button growing from 128 px to
175.08 px when Stream changed to Connecting. The label now reserves space for
the longest launch status before Steam measures the button/focus decoration;
the icon also retains its width. Stream, Connecting, Waking host, Starting
stream, Starting game, Streaming, Resume Stream and Retry Stream all measured
206.05 × 48 px in the same fixture, with the containing row staying at 250.05 px.
These dimensions depend on the font; the invariant is an unchanged footprint
through the state transition. The connecting screenshot is
`out/Pyrodeck-0.2.9-connecting.png`. Native Game Mode decoration still needs
device confirmation. This follow-up changes presentation only.

## 0.2.10 Library return and retained-game options

Two new regressions failed before the correction: removing just the owned
Library slot left zero actions on the page, and a presentation update during
pending helper-exit cleanup left the old active app uncleared. The observer now
repairs an externally removed/reordered slot while retaining the existing
container/button. Exit cleanup uses the launch generation, tolerating immutable
subject updates within that launch while rejecting old exits after a newer one.
It also refreshes session state after cleanup.

A test with the real session store, polling hooks and launcher subscription
changes Streaming to Resume Stream on the same mounted Library page, removes
the slot as Steam does, and verifies the same DOM button is restored, enabled
and launches the pinned original host/app. The native Play handler still works.
Existing controller/context, unrelated DOM churn and lookup-cost tests pass.

The Resume Stream arrow now opens Stream options with End Remote Game even
when only one host is eligible. Tests cover confirmation before execution,
the original target after choosing another host, stale-session rejection,
single-flight ending, failure/retry access and missing remote app identity.
The action uses the existing conditional quit utility and host confirmation
instead of changing disconnect behavior. All 118 frontend tests pass across
15 files. Physical controller selection, Steam's real page-restoration sequence
and end/resume against a paired host still require device confirmation.

## 0.2.11 actual dialog contract and overlay-return cleanup

The user reported both 0.2.10 behaviors still failed. The earlier confirmation
test accepted a DOM button as the `showModal` parent, but the installed Decky
wrapper forwards that value to Steam's modal API. Steam keys modal managers by
Window and reads `parent.document.title`; the button is not a valid parent.
The corrected code passes the Library button's owning Window. Tests now reject
DOM parents and check the separate-document case. The menu anchor remains the
button. The confirmation and conditional host/app checks remain intact.

Overlay Exit previously called `killApp` and still depended on a separate
app-lifetime callback for `clearApp`. The Exit operation now checks its owned
runner is stopped, clears that launch generation and refreshes status directly.
A post-exit refresh waits for an earlier in-flight poll to finish and then
fetches again, so joining an old streaming observation cannot leave it stale.
The Exit test now asserts cleanup without delivering any lifetime callback.

Returning cached Library pages can become measurable after their final DOM
mutation. The adapter now observes native panel sizes and subscribes to owned
app changes in addition to the existing document/focus events. Return events
schedule one immediate frame and three settling checks at 100, 400 and 1000 ms;
these do not become a recurring timer. Tests verify attachment on layout-only
restoration and an owned-app update without navigation/DOM mutation, bounded
work and timer/subscription teardown. Existing unrelated DOM churn counts pass.
Rare action logs now distinguish confirmation opening, host-end execution and
completed Steam Exit; end errors are visible outside the Library via a toast.

All 123 frontend tests pass across 15 files. Lint/type checking and the release
build/package checks pass. These reproduce corrected source/API failure modes,
but they do not replace validation of the installed build in Game Mode. Verify
that End Remote Game actually opens a confirmation before accepting it, then
test Shift+Tab Exit and return to the same game page without navigating away.

## Required Steam Deck acceptance — not verified

In each Quick Access subpage (Remote Games, Session, Diagnostics and every
settings category), press B from a focused control. Verify it returns to
PyroDeck's main menu, then a second B returns to Decky's plugin list. An open
dropdown/dialog must consume B before leaving its page. Repeat after closing
and reopening Quick Access, and check the on-screen Back button still works.

For Steam shortcut discovery and saved Library entries, also verify:

- Add a native app and a Proton game to the host's Steam Library, save the
  shortcuts, then rescan Pyroshine and refresh Remote Games. Launch both and
  verify their Steam launch options, working directory and Proton settings.
- At Quick Access width, verify artwork and game titles have room beside the
  compact **⋯** button. Open that menu with A, X, mouse and touch; B must close
  the menu first. Verify the menu stays open when Quick Access loses focus to
  its native popup, and that selecting **Add to Steam Library** saves the entry.
  Long titles should truncate inside their card without widening
  the panel. Verify the same layout in the full settings page.
- Save the advertised **Steam** entry from **⋯ → Add to Steam Library**. Launch it
  from the Deck's Library, verify Big Picture video/audio and controller input,
  then disconnect and resume.
- Change the default host, reload PyroDeck and restart Steam. The saved entry
  must retain its original host and app ID, remain visible, and keep its custom
  artwork. Pairing or streaming another app must not rename or hide it.
- Repeatedly add the same entry, add an equally named entry from a second host,
  and remove/re-add one through Steam. Check duplicate prevention, separate
  host targets and the PyroDeck collection. Legacy bulk sync/purge must leave
  individually saved shortcuts intact.

Use a paired Pyroshine host with retained sessions and the matching Pyrolight
build. Record SteamOS, Steam client, Decky, PyroDeck, Pyrolight, host versions
and handheld/docked display configuration.

1. Open Valheim's native Library page; verify one Stream action immediately
   left of Steam Input, controller focus, and unchanged local actions. Move
   right from Play to Stream, select with A, open the host arrow,
   select/cancel with A/B, and verify focus returns to that arrow. Navigate to
   another game and back; repeat after plugin reload and Steam restart.
   Check green hover/controller highlights on both Stream and the host arrow,
   including Resume/Retry states, and unchanged disabled/native controls.
2. Launch Valheim from Library and Remote Games. Verify the helper reaches its
   real running notification, Steam's spinner clears naturally, and video/audio
   are usable. Check name/artwork, Steam Input, Shift+Tab and Quick Access.
   Verify a single Valheim entry when only the remote game is running.
3. Close overlays and verify input focus returns. Disconnect/Steam Exit, verify
   owned processes/windows close, return to the native Library and resume the
   retained game on its original host with the active profile.
   Remain on that same game page and verify Resume Stream returns without
   navigating away. Open its arrow with A, cancel End Remote Game with B, then
   repeat and confirm to end the retained host game. Repeat with one host and
   with an alternative selected; ending must still target the original host.
4. Confirm and cancel switches on the same host and between hosts. Verify
   conditional cancellation refuses a changed application or unsafe host state.
5. Wake a known offline host, test wake timeout and Retry, and verify catalog
   refreshes do not start extra wake/launch attempts.
6. Suspend during connection, streaming and reconnect; resume or cancel while
   cleanup runs. Repeat handheld/docked, where equipment is available.
7. During a sustained stream, close Quick Access and scroll the native Library
   grid and game pages. Compare responsiveness with streaming stopped; check
   repeated navigation after the catalog's normal 30-second TTL and after
   logout/login. Capture Steam UI frame time and client/Steam CPU if stutter
   persists. The automated operation counts do not establish a device FPS gain.

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
