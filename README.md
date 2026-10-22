# PyroDeck

A [Decky Loader](https://decky.xyz/) plugin that streams the Steam games installed
on your [Pyroshine](https://github.com/karsyboy/pyroshine) host to the Steam Deck
through [Pyrolight](https://github.com/karsyboy/pyrolight): open a game's page in
your Steam library, select **Stream with Pyrolight** and play. Steam’s local Play and Install buttons stay unchanged.

PyroDeck is a fork of [MoonDeck](https://github.com/FrogTheFrog/moondeck) by
FrogTheFrog. It keeps MoonDeck's Steam Deck integration and needs no extra
program on the host: no MoonDeck Buddy, no special host app.

## Requirements

- A Linux PC running Pyroshine 0.18 or newer, with Steam and your games
  installed there. Older Pyroshine versions and other GameStream hosts cannot
  tell PyroDeck which Steam game is which.
- A Steam Deck (SteamOS 3.7 or newer) with [Decky Loader](https://decky.xyz/).
- A matching Pyrolight build with the schema-1 `settings` API, stable application IDs and integration events. Use the builds containing this integration in all three repositories.

## 1. Install Pyrolight on the Steam Deck

1. Switch to Desktop Mode.
2. Download the `pyrolight-*-linux-x86_64.AppImage` from the
   [Pyrolight releases](https://github.com/karsyboy/pyrolight/releases) into
   `~/Applications` (create the folder if needed).
3. Make it executable: right-click it, **Properties → Permissions → Is
   executable**, or run:

   ```sh
   chmod +x ~/Applications/pyrolight-*-linux-x86_64.AppImage
   ```

PyroDeck finds `pyrolight` on `PATH`, or the newest Pyrolight AppImage in
`~/Applications`, `~/AppImages`, `~/Downloads` or your home folder. To use
another file, set it under **Host Selection → Use a specific Pyrolight executable**.

## 2. Install PyroDeck

Install the `pyrodeck.zip` from the [releases](https://github.com/karsyboy/pyrodeck/releases)
through Decky Loader: **Decky settings → Developer → Install Plugin from ZIP**
(enable Developer mode first). PyroDeck can be installed next to MoonDeck; the
two never use each other's shortcuts, settings or processes. On its first start
PyroDeck copies the hosts and stream preferences of an installed MoonDeck
(MoonDeck's own files are left unchanged).

## 3. Select the host

Open PyroDeck from the quick access menu, press the settings icon and go to
**Host Selection**:

- **Scan local network** finds Pyroshine hosts that announce themselves (mDNS).
- **Add host manually** adds a host by IP address or name when scanning cannot
  find it (VPN, other subnet, firewall).

Select the default host. Pair each additional host separately. **Host Info** shows whether it reports Steam app IDs.

## 4. Pair

On **Host Selection**, under **Pyrolight**:

1. Press **Pair**. Pyrolight opens and shows a four-digit PIN.
2. On the host, approve the request with that PIN in Pyroshine's web
   interface (**Clients**) or with `pyroshine pair`.
3. Pyrolight closes. Press **Check**: the pairing status shows **Paired**.

Pairing is Pyrolight's own. PyroDeck never reads or copies its credentials.

## 5. Stream games

Open a game’s Steam Library page and choose **Stream with Pyrolight**. The
separate action appears when a paired, reachable host advertises that Steam
App ID. Steam’s Play and Install buttons keep their local behavior. The
eligible default host is selected; choose an alternative explicitly when the
default is unavailable. That selection applies to this launch only.

Open **Remote Games** in Quick Access or the settings page to browse every
application advertised by a host: Steam, Heroic, Lutris, desktop entries and
manual applications. Search, filter by source and sort by name or recently
played on this Deck. Select a card to launch. Adding games as Steam shortcuts
is optional; the browser uses one shared hidden Steam launcher.

## 6. Profiles and streaming settings

Quick Access shows the active Pyrolight profile and stream state. Open
**Streaming Profiles** to select, create, duplicate, rename or delete a profile,
or restore its defaults. One manually selected profile governs subsequent
launches. Pyrolight’s standalone GUI uses the same profiles. Docking never
selects another profile automatically.

Video & Display, Audio, Controller & Input, VRR Advanced, Advanced Streaming,
and Connection & Diagnostics expose Pyrolight’s settings. Edits remain a draft
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
- **Reconnect** in Session Controls resumes the pinned host/application using
  the active profile. Launching the same library game again also resumes it.
- **End Remote Game** asks for confirmation, then explicitly closes that game
  on its original host. Update Pyroshine for conditional cancellation, which
  refuses to terminate a different application that replaced it.

PyroDeck never suspends, restarts or shuts down the host.

## Troubleshooting

| Message | What to do |
| --- | --- |
| Pyrolight was not found | Install the AppImage as in step 1, or set its path in **Pyrolight Settings**. |
| This Pyrolight is too old for PyroDeck | Update Pyrolight. |
| Pyrolight is not paired with this host | Pair as in step 4. |
| The host is not responding / Pyrolight cannot reach the host | Check that the host is on and Pyroshine is running; check the address in **Host Info**. Set the host's MAC address for Wake-on-LAN. |
| This host does not report Steam app IDs | Update Pyroshine on the host. |
| This game is not available on the host | Install the game on the host, or unhide it in Pyroshine's **Library** page. |
| Steam is already running on the host | Quit Steam on the host's desktop and launch again; see Pyroshine's [TIPS](https://github.com/karsyboy/pyroshine/blob/main/docs/TIPS.md#close-a-desktop-steam-before-streaming-steam). |
| Pyrolight asks to quit another app | A different game is running on the host. Confirm to end it, or cancel and keep it. |

Logs:

| Log | File |
| --- | --- |
| Plugin backend | `/tmp/pyrodeck-backend.log` |
| Runner (each launch) | `/tmp/pyrodeck-runner.log` |
| Pyrolight output (each launch) | `/tmp/pyrodeck-runner-pyrolight.log` |
| Frontend | `/tmp/pyrodeck-frontend.log` |

Host/UI settings are stored in `~/.config/pyrodeck/settings.json`; confirmed play history is `recent-games.json` beside it. Streaming preferences and profiles remain in Pyrolight.

## Development

See the [architecture and settings parity matrix](docs/INTEGRATION.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the architecture, the
contract with Pyroshine and Pyrolight, building and tests.

## License

GNU GPLv3, like MoonDeck.
