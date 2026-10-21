# PyroDeck development

PyroDeck is the Steam Deck side of a three-part system. Each part keeps its
own job and they meet only at the interfaces below.

| Part | Owns |
| --- | --- |
| PyroDeck (this repository) | Steam UI: library button, shortcuts, Steam Input, display/resolution choice, host selection, Wake-on-LAN, suspend/resume, launching and supervising Pyrolight, error reporting |
| [Pyrolight](https://github.com/karsyboy/pyrolight) | GameStream pairing and connections, decoding, codecs (PyroWave), HDR, VRR, input |
| [Pyroshine](https://github.com/karsyboy/pyroshine) | Steam game discovery, application identities, launching and owning the host session |

## Launch flow

```text
library page (Steam app ID) ── PyroDeck button
  └─ frontend: hidden per-game shortcut, launch options PYRODECK_*=…, SteamClient.Apps launch
      └─ Steam runs pyrodeckrun.sh (Steam owns the process tree: focus, overlay, Exit Game)
          └─ runner (defaults/python/lib/runner/pyroshinerunner.py)
              1. serverinfo (HTTP) of the selected host; Wake-on-LAN while it is off
              2. pyrolight list --json HOST          → app list + launcher identities
              3. pick the app whose sources contain steam:<app id>
              4. pyrolight --no-quit-after … stream HOST "<that app's name>"
                  └─ Pyrolight: /launch or /resume (paired TLS) → Pyroshine session manager
```

`HOST` is the host's address, with `:port` when its HTTP port is not 47989.
The runner checks that the UUID Pyrolight reports is the selected host's.

Nothing in this flow talks to MoonDeck Buddy, opens Buddy's port or needs a
special host application.

## Interfaces

**Pyroshine → Pyrolight** (GameStream extension, see Pyroshine's
[`docs/CLIENT_INTEGRATION.md`](https://github.com/karsyboy/pyroshine/blob/main/docs/CLIENT_INTEGRATION.md)):
`/applist` carries `<PyroshineSource>steam:892970</PyroshineSource>` per app,
for paired clients only; `/serverinfo` advertises `<PyroshineAppSources>1` and,
while a Steam game's session is live, `<PyroshineGameState>` (`launching`,
`updating`, `running`, `exited`) next to `currentgame`. PyroDeck shows the
state in the quick access menu and Host Info (`lib/gamestreaminfo.py`).

**Pyrolight → PyroDeck**: `pyrolight list --json HOST` prints one line,

```json
{"schema":1,"host":{"name":"SuperCube","uuid":"…"},"apps":[{"name":"Valheim","id":1943979320,"hdrSupported":true,"hidden":false,"sources":["steam:892970"]}]}
```

`parse_app_list` (`lib/pyrolightproxy.py`) rejects any other schema. Exit
codes and stderr distinguish "not paired", "cannot connect" and a Pyrolight
without `--json`.

**Pyrolight command lines** PyroDeck builds (argv lists, never a shell):
`list --json HOST`, `[options] stream HOST APP`, `pair HOST`, `quit HOST`.
`--video-codec` (other than `auto`) and `--vrr` are passed only when
`pyrolight stream --help` lists them for the installed build.

**Frontend → runner**: Steam launch options on the shortcut, read by
`lib/runner/envparser.py`:

| Variable | Meaning |
| --- | --- |
| `PYRODECK_APP_TYPE` | 0 library game, 1 synced host app, 2 utility action |
| `PYRODECK_STEAM_APP_ID` | Steam app ID of the library entry (type 0) |
| `PYRODECK_APP_NAME` | Host app name (type 1) |
| `PYRODECK_ACTION` | `pair` or `quit` (type 2) |
| `PYRODECK_AUTO_RES`, `PYRODECK_LINKED_AUDIO`, `PYRODECK_LINKED_DISPLAY`, `PYRODECK_PYTHON` | Display, audio and runner options, as in MoonDeck |

## Resolving a game

A Steam game is found by identity, never by title (`resolve_steam_app`):
Pyroshine suffixes equal titles (`Hades (Steam 1145361)`), a manual
Pyroshine entry can override a game under its own title, and different games
share titles. Exactly one app must report `steam:<id>`. None reported on a host
that advertises app sources means "not installed or hidden"; none at all on a
host without the feature means "update Pyroshine". Pyrolight's `stream` then
selects that app by its advertised name, which Pyroshine keeps unique.

Synced host apps (type 1) stream by exact name and are refused when two apps
share it.

## Process ownership

- One runner at a time (flock on `/tmp/pyrodeck-runner-pid`).
- The runner starts one Pyrolight per launch and records its PID and start
  time in `/tmp/pyrodeck-runner-client`. On cancellation it sends SIGTERM to
  that process tree, then SIGKILL after 5 s.
- The backend's `kill_runner` (`lib/runnercontrol.py`) signals only the runner
  holding the lock and, if the runner died, the recorded Pyrolight if its
  start time still matches. Other Pyrolight, Moonlight or MoonDeck processes are
  never matched by name or signalled.
- The environment is passed through except Steam's `LD_LIBRARY_PATH`, so
  `WAYLAND_DISPLAY`, `DISPLAY` and `SteamGameId` reach Pyrolight unchanged and
  its own display-backend selection applies. The runner logs them.

## Session lifecycle

| Action | What happens on the host |
| --- | --- |
| Close Pyrolight, Steam's Exit Game, Disconnect | Nothing ends: `--no-quit-after`, no request. Pyroshine pauses the stream and keeps the game. |
| Launch the same game again | Pyrolight sees it running and resumes it (`/resume`). |
| Deck suspend | The runner is suspended (Pyrolight closed); on resume it reconnects when "Resume stream after system suspension" is on, otherwise the stream stays closed. |
| End Game on Host | Confirmed in the UI; a running stream is disconnected, then `pyrolight quit` runs through the hidden "PyroDeck" utility shortcut (`/cancel`). |
| Launch another game while one runs | Pyrolight's own dialog asks whether to quit the running one; nothing is ended silently. |

## Coexistence with MoonDeck

PyroDeck's identifiers are all its own: plugin name, `pyrodeckrun.sh`,
`PYRODECK_*` variables, the "PyroDeck" Steam collection, the `/pyrodeck`
route, `pyrodeck-*` CSS names, `/tmp/pyrodeck-*` files and
`~/.config/pyrodeck/settings.json`. Shortcuts are adopted only if they run
`pyrodeckrun.sh`. On first start, MoonDeck's `~/.config/moondeck/settings.json`
is read (never written) to seed PyroDeck's settings.

## Settings

The schema lives twice: `defaults/python/lib/plugin/settings.py` (validated on
every write) and `src/lib/settingsmanager.ts`. Keep them identical. Version 44
continues MoonDeck's numbering; `_migrate_settings` upgrades MoonDeck files of
any version. Some keys keep MoonDeck names (`passToMoonlight`,
`useMoonlightExec`, `moonlightExecPath`, `enableMoondeckShortcuts`) but hold
Pyrolight and PyroDeck options.

## Building

```sh
pnpm install
pnpm run build           # frontend bundle
pnpm run setup && pnpm run build:plugin   # plugin zip in out/
```

Deploying to a Deck over SSH: copy `.env.example` to `.env`, fill it in and run
`pnpm run build:deploy`.

## Tests

```sh
pnpm run test         # eslint
pnpm run typecheck    # tsc
pnpm run test:unit    # vitest, tests/frontend: launch options, shortcut ownership,
                      # library app data, duplicate launches, utility shortcut, suspend/resume
pnpm run test:python  # unittest, tests/python: runner with a fake Pyrolight,
                      # argument construction, app-list parsing, process ownership,
                      # settings migration, Buddy independence
```

The Python suite uses `tests/python/fakes/fake_pyrolight.py` and a local HTTP
server for serverinfo, and records every connection to check that nothing
reaches Buddy's port. CI runs it on Python 3.13, SteamOS's version.

## Hardware acceptance

Automated tests do not cover Game Mode. On a Steam Deck with a Pyroshine host
and at least two installed Steam games:

1. No MoonDeck Buddy installed. Pair through Host Selection; Check shows Paired.
2. Launch game A from its library page: it starts on the host; video, audio and
   controller input work; the Pyrolight window has focus in Game Mode.
3. `/tmp/pyrodeck-runner.log` shows `WAYLAND_DISPLAY`/`DISPLAY` as Game Mode
   provides them and Pyrolight's log the expected display backend.
4. Disconnect; game A keeps running on the host. Launch it again: it resumes.
5. Suspend and wake the Deck with resume enabled: the stream reconnects.
6. End Game on Host: game A closes on the host.
7. Repeat with game B; then launch B while A runs: Pyrolight asks first.
8. A Moonlight or second Pyrolight started outside PyroDeck survives every
   step; MoonDeck's shortcuts (if installed) are untouched.
9. With Steam running on the host's desktop, a launch reports "Steam is
   already running on the host" and nothing opens there.
