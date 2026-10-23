# PyroDeck

A [Decky Loader](https://decky.xyz/) plugin that streams the Steam games installed
on your [Pyroshine](https://github.com/karsyboy/pyroshine) host to the Steam Deck
through [Pyrolight](https://github.com/karsyboy/pyrolight): open a game's page in
your Steam library, select **Stream** and play. Steam’s local Play and Install buttons stay unchanged.

PyroDeck is a fork of [MoonDeck](https://github.com/FrogTheFrog/moondeck) by
FrogTheFrog. It keeps MoonDeck's Steam Deck integration and needs no extra
program on the host: no MoonDeck Buddy, no special host app.

## Requirements

- A Linux PC running Pyroshine 0.18 or newer, with Steam and your games
  installed there. Older Pyroshine versions and other GameStream hosts cannot
  tell PyroDeck which Steam game is which.
- A Steam Deck (SteamOS 3.7 or newer) with [Decky Loader](https://decky.xyz/).
- A matching Pyrolight build with the schema-1 `settings` API, stable application IDs, integration events and headless catalog commands. Use the builds containing this integration in all three repositories.

## 1. Install Pyrolight on the Steam Deck

1. Switch to Desktop Mode.
2. Download the `Pyrolight-*-x86_64.AppImage` from the
   [Pyrolight releases](https://github.com/karsyboy/pyrolight/releases) into
   `~/Applications` (create the folder if needed).
3. Make it executable: right-click it, **Properties → Permissions → Is
   executable**, or run:

   ```sh
   chmod +x ~/Applications/Pyrolight-*-x86_64.AppImage
   ```

PyroDeck finds `pyrolight` on `PATH`, or the newest Pyrolight AppImage in
`~/Applications`, `~/AppImages`, `~/Downloads` or your home folder. To use
another file, set it under **Hosts & Pairing → Use a specific Pyrolight executable**.

## 2. Install PyroDeck

Install the `pyrodeck.zip` from the [releases](https://github.com/karsyboy/pyrodeck/releases)
through Decky Loader: **Decky settings → Developer → Install Plugin from ZIP**
(enable Developer mode first). PyroDeck can be installed next to MoonDeck; the
two never use each other's shortcuts, settings or processes. On its first start
PyroDeck copies the hosts and stream preferences of an installed MoonDeck
(MoonDeck's own files are left unchanged).

## 3. Select the host

Open PyroDeck from the quick access menu, press the settings icon and go to
**Hosts & Pairing**:

- **Scan local network** finds Pyroshine hosts that announce themselves (mDNS).
- **Add host manually** adds a host by IP address or name when scanning cannot
  find it (VPN, other subnet, firewall).

Select the default host. Pair each additional host separately. **Host Details** shows whether it reports Steam app IDs.

## 4. Pair

On **Hosts & Pairing**, under **Pyrolight**:

1. Press **Pair**. Pyrolight opens and shows a four-digit PIN.
2. On the host, approve the request with that PIN in Pyroshine's web
   interface (**Clients**) or with `pyroshine pair`.
3. Pyrolight closes. Press **Check**: the pairing status shows **Paired**.

Pairing is Pyrolight's own. PyroDeck never reads or copies its credentials.

## 5. Stream games

Open a game’s Steam Library page and choose **Stream**, immediately to the
left of the Steam Input button. On a controller, navigate through the native
action row to Stream, then press **A**. The
separate action appears when a configured, paired host advertises that Steam
App ID. Previously validated games remain available for Wake-on-LAN for up to
seven days while that host is offline and has a MAC address configured. The
runner checks the host identity, pairing and current catalog again before launch. Steam’s Play and Install buttons keep their local behavior. The
eligible default host is selected; use **▾** to open Steam's host-selection menu
(**A** selects, **B** cancels). If the
default does not offer the game, choose an eligible host explicitly. That selection applies to this launch only.

Open **Remote Games** in Quick Access or the settings page to browse every
application advertised by a host: Steam, Heroic, Lutris, desktop entries and
manual applications. Search, filter by source and sort by name or recently
played on this Deck. Select a card to launch. Adding games as Steam shortcuts
is optional; the browser uses one shared hidden Steam launcher. **Filter & Sort…**
opens source and recent-play filters. The page count and Previous/Next controls
appear above the cards; search covers every page.

Adding a non-Steam shortcut to the host's Steam Library does **not** by itself
make it discoverable. Pyroshine's Steam scanner reads installed Steam game
manifests, not Steam's `shortcuts.vdf`. Non-Steam applications appear when
advertised through Pyroshine's Heroic, Lutris, desktop-entry scanners or manual
application configuration.

For a remote game with one exact Steam App ID that is also in your Deck's Steam
Library, the Gaming Mode running-game menu uses the real game's name, artwork
and descriptive Steam metadata. Resume returns to the stream; Steam's Exit action disconnects
it. The helper always keeps the game's readable name. The Library action uses
Steam's native button styling and the Library's controller focus tree.
Games without a matching Steam Library entry keep their remote-app identity.

Steam still owns a hidden helper process. Playtime, achievements and cloud sync
remain the responsibility of the host game and Steam. The adapter presents
existing Steam metadata; it does not create local achievement or cloud state.

Open **Troubleshooting & Diagnostics** directly from PyroDeck in Quick Access
or its settings sidebar. It reports Library attachment and the current App ID,
host matches, runner/client state, window observations, launch errors and logs.
Library diagnostics also show panel/fiber observations when attachment fails.
It remains available when Pyrolight settings cannot load.

## 6. Profiles and streaming settings

Quick Access shows the active Pyrolight profile and stream state. Open
**Profiles** to select, create, duplicate, rename or delete a profile,
or restore its defaults under **Manage Profiles…**. One manually selected profile governs subsequent
launches. Pyrolight’s standalone GUI uses the same profiles. Docking never
selects another profile automatically.

Video & Display, Audio, Controller & Input, VRR Tuning, Advanced,
and Connection expose Pyrolight’s settings. Edits remain a draft
when Quick Access closes. While streaming, select **Apply & Reconnect** to save
and reconnect explicitly; no setting edit reconnects automatically. Without a
running client, **Save for Next Session** saves without launching anything.
Discarding the draft refreshes preferences from Pyrolight.

If reconnect fails, the draft remains and the error explains that preferences
were saved but not confirmed by a stream. Retry or launch the same game again.
Unsaved drafts are discarded when the plugin unloads or you log out. Network
calibration and system receive-buffer fixes require explicit actions and a
disconnected client; a recommended bitrate is only staged when you choose it.

## 7. Disconnect, reconnect or end the game

- **Disconnect**, Steam’s **Exit Game**, and suspend close the client and
  preserve the remote game under Pyroshine’s retention policy.
- **Resume Stream** on the Library page reconnects to the original host and game.
- **Reconnect** in Session Controls resumes the pinned host/application using
  the active profile. Launching the same library game again also resumes it.
- **End Remote Game** asks for confirmation, then explicitly closes that game
  on its original host. Update Pyroshine for conditional cancellation, which
  refuses to terminate a different application that replaced it.

Switching an active stream asks for confirmation. On the same host, switching
games can end the previous game and lose unsaved progress; a matching Pyroshine
build checks the expected application ID before termination. Switching hosts
disconnects the original client and keeps its game under that host’s retention
policy. Cancellation keeps the current stream.

PyroDeck never suspends, restarts or shuts down the host.

The full settings sidebar uses the same categories as Quick Access. Launcher
options and legacy shortcut maintenance are under **Advanced Tools**; they are
not needed for normal library or Remote Games launches.

## Troubleshooting

| Message | What to do |
| --- | --- |
| Pyrolight was not found | Install the AppImage as in step 1, or set its path in **Hosts & Pairing**. |
| This Pyrolight is too old for PyroDeck | Update Pyrolight. |
| Pyrolight crashed while initializing a display / missing `eglfs` plugin | Install a Pyrolight build with headless catalog support. In **Hosts & Pairing**, select the updated executable if using a custom path, then refresh Remote Games. Updating only the plugin cannot fix an older client. |
| Pyrolight is not paired with this host | Pair as in step 4. |
| The host is not responding / Pyrolight cannot reach the host | Check that the host is on and Pyroshine is running; check the address in **Host Details**. Set the host's MAC address for Wake-on-LAN. |
| This host does not report Steam app IDs | Update Pyroshine on the host. |
| This game is not available on the host | Install the game on the host, or unhide it in Pyroshine's **Library** page. |
| Steam is already running on the host | Quit Steam on the host's desktop and launch again; see Pyroshine's [TIPS](https://github.com/karsyboy/pyroshine/blob/main/docs/TIPS.md#close-a-desktop-steam-before-streaming-steam). |
| Pyrolight asks to quit another app | A different game is running on the host. Confirm to end it, or cancel and keep it. |

**Troubleshooting & Diagnostics → View Log** displays the last 32 KiB of a
selected log with sensitive credential lines redacted. The files are also
available in Desktop Mode:

| Log | File |
| --- | --- |
| Plugin backend | `/tmp/pyrodeck-backend.log` |
| Runner (each launch) | `/tmp/pyrodeck-runner.log` |
| Pyrolight output (each launch) | `/tmp/pyrodeck-runner-pyrolight.log` |
| Frontend | `/tmp/pyrodeck-frontend.log` |

Host/UI settings are stored in `~/.config/pyrodeck/settings.json`; confirmed play history is `recent-games.json` beside it. `known-catalogs.json`
stores bounded, UUID-validated availability for offline waking. Streaming preferences and profiles remain in Pyrolight.

Game Mode acceptance for these changes is **not verified**. See the
[current validation report](docs/VALIDATION.md) for automated results and the
remaining Valheim, controller, overlay and docked-display checks.

## Development

See the [architecture and settings parity matrix](docs/INTEGRATION.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the architecture, the
contract with Pyroshine and Pyrolight, building and tests.

## License

GNU GPLv3, like MoonDeck.
