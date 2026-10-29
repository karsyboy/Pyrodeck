# PyroDeck

<p align="center">
  <a href="https://github.com/karsyboy/pyrodeck/actions/workflows/build.yaml"><img src="https://github.com/karsyboy/pyrodeck/actions/workflows/build.yaml/badge.svg" alt="Build status"></a>
</p>

PyroDeck is a [Decky Loader](https://decky.xyz/) plugin for the Steam Deck
based on [MoonDeck](https://github.com/FrogTheFrog/moondeck). It streams games
from a [Pyroshine](https://github.com/karsyboy/pyroshine) host through
[Pyrolight](https://github.com/karsyboy/pyrolight): open a game in your Steam
library, select **Stream**, and play. No extra program is needed on the host.

- A **Stream** button on Steam library pages for games installed on the host.
  Steam's own Play and Install buttons keep working as before.
- **Remote Games**: browse, search and launch every application the host
  offers, including Heroic, Lutris and non-Steam games.
- Add any remote application to your Steam library as a shortcut.
- Pyrolight's streaming profiles and settings, editable from Quick Access.
- Disconnect, resume and end remote games without leaving Gaming Mode.
- Wake-on-LAN for hosts that are asleep.
- Diagnostics and logs viewable on the Deck.

PyroDeck is in active development. Testing on Steam Deck hardware in Gaming
Mode is still in progress; see the [validation report](docs/VALIDATION.md).

## Requirements

- A Linux host running Pyroshine 0.18 or later, with Steam and your games
  installed there. Older Pyroshine releases and other hosts cannot tell PyroDeck
  which game is which.
- A Steam Deck with SteamOS 3.7 or later and
  [Decky Loader](https://decky.xyz/).
- Pyrolight 6.2.8 or later on the Steam Deck. Older releases lack the
  integration PyroDeck needs.

## Installation

### 1. Install Pyrolight

PyroDeck can install Pyrolight for you once PyroDeck itself is installed
([step 2](#2-install-pyrodeck)): while no Pyrolight is found, Quick Access shows
**Install Pyrolight**. The same action is under **Hosts & Pairing → Pyrolight
App**, which also shows **Update** when a newer release is out. Turn on
**Include prereleases** there to install and update to prereleases as well.

PyroDeck downloads the latest `pyrolight-*-linux-x86_64.AppImage` from the
[Pyrolight releases](https://github.com/karsyboy/pyrolight/releases), checks it
against the release's SHA-256 checksum and installs it as
`~/Applications/Pyrolight.AppImage`. It never changes a Pyrolight installed by
a package manager or a file you selected yourself.

To install it by hand instead:

1. Switch the Steam Deck to Desktop Mode.
2. Download the `pyrolight-*-linux-x86_64.AppImage` from the
   [Pyrolight releases](https://github.com/karsyboy/pyrolight/releases) into
   `~/Applications` (create the folder if needed).
3. Make it executable: right-click it and select **Properties → Permissions →
   Is executable**, or run:

   ```sh
   chmod +x ~/Applications/pyrolight-*-linux-x86_64.AppImage
   ```

PyroDeck finds `pyrolight` on `PATH`, or the newest Pyrolight AppImage in
`~/Applications`, `~/AppImages`, `~/Downloads` or your home folder. To use a
different file, set it in **Hosts & Pairing → Use a specific Pyrolight
executable**.

### 2. Install PyroDeck

Download `pyrodeck-*.zip` from the
[releases page](https://github.com/karsyboy/pyrodeck/releases). In Decky
Loader, enable **Developer mode**, then select **Decky settings → Developer →
Install Plugin from ZIP**.

- PyroDeck can be installed next to MoonDeck; they never share shortcuts,
  settings or processes.
- On first start, PyroDeck copies the hosts and stream preferences of an
  installed MoonDeck. MoonDeck's own files are left unchanged.

### Updates

PyroDeck updates itself: Quick Access shows **Update PyroDeck** when a newer
release is out, and **Updates** in PyroDeck's settings shows the installed and
latest versions. Decky Loader asks you to confirm, checks the release ZIP's
SHA-256 checksum, replaces PyroDeck and reloads it. Turn on **Include
prereleases** there to update to prereleases as well. The same page installs
and updates Pyrolight.

## Quick start

### 1. Add the host

Open PyroDeck from the Quick Access menu, select the settings icon, and open
**Hosts & Pairing**:

- **Scan local network** finds Pyroshine hosts on your network.
- **Add host manually** adds a host by IP address or name when scanning cannot
  find it (VPN, another subnet, or a firewall).

Select your default host. **Host Details** shows whether the host reports Steam
app IDs.

### 2. Pair

On **Hosts & Pairing**, under **Pyrolight**:

1. Select **Pair**. Pyrolight opens and shows a four-digit PIN.
2. On the host, enter that PIN in Pyroshine's web interface under **Clients**,
   or run `pyroshine pair`. See Pyroshine's
   [pairing guide](https://github.com/karsyboy/pyroshine#4-pair).
3. Pyrolight closes. Select **Check**; the status shows **Paired**.

Pair each additional host separately. Pairing belongs to Pyrolight; PyroDeck
never reads or copies its credentials.

### 3. Play

Quit Steam on the host's local desktop first. Open a game's page in your Steam
library and select **Stream**, left of the Steam Input button. With a
controller, move along the action row to **Stream** and press **A**.

The button appears when a paired host offers that game. The default host is
used when it has the game; select **▾** to choose another host for this launch.

## Remote Games

Open **Remote Games** from Quick Access to browse every application a host
offers: Steam, Heroic, Lutris, desktop entries and manual applications. Search,
filter by source, or sort by name or recently played, then select a card to
launch.

To keep an application in your Steam library, open its **⋯** menu (or press
**X** on its card) and select **Add to Steam Library**. The shortcut appears in
the **PyroDeck** collection and always streams from the host you chose when you
added it. For example, add the host's **Steam** entry to open Big Picture on the
host directly. Remove it with Steam's **Remove non-Steam game**.

Non-Steam games added to the host's Steam library also appear here. If a new one
is missing, refresh **Remote Games**; if needed, exit Steam on the host and
select **Rescan** in Pyroshine's web interface.

## Profiles and settings

Quick Access shows the active Pyrolight profile and stream state. Open
**Profiles** to select, create, duplicate, rename or delete a profile. The
selected profile applies to every launch, and Pyrolight on its own uses the same
profiles.

The settings pages (Video & Display, Audio, Controller & Input, VRR Tuning,
Advanced and Connection) edit Pyrolight's settings. Changes stay as a draft
until you save them:

- While streaming, select **Apply & Reconnect** to save and reconnect.
- Otherwise, select **Save for Next Session**.

Settings never reconnect a stream on their own. Unsaved drafts are discarded
when you log out.

## Disconnect, resume and end games

- **Disconnect**, Steam's **Exit Game**, and suspending the Deck close the
  stream but leave the game running on the host.
- **Resume Stream** on the game's library page, or **Reconnect** in Session
  Controls, returns to the same game on the same host.
- **End Remote Game** (in the **▾** menu or Session Controls) asks for
  confirmation, then closes the game on the host.

Starting a different game asks for confirmation first; on the same host this can
end the running game and lose unsaved progress. PyroDeck never suspends,
restarts or shuts down the host.

## Troubleshooting

| Message | What to do |
| --- | --- |
| Pyrolight was not found | Select **Install Pyrolight** in Quick Access, install it as in [Install Pyrolight](#1-install-pyrolight), or set its path in **Hosts & Pairing**. |
| Installing Pyrolight failed | Check the Deck's internet connection and retry. A failed or interrupted download keeps the installed AppImage. Disconnect the stream before updating. |
| This Pyrolight is too old for PyroDeck | Update Pyrolight. |
| Pyrolight crashed while initializing a display / missing `eglfs` plugin | Update Pyrolight. If you set a custom path in **Hosts & Pairing**, select the new file, then refresh **Remote Games**. |
| Pyrolight is not paired with this host | [Pair](#2-pair) again. |
| The host is not responding / Pyrolight cannot reach the host | Check that the host is on and Pyroshine is running, and check the address in **Host Details**. Set the host's MAC address to use Wake-on-LAN. |
| This host does not report Steam app IDs | Update Pyroshine on the host. |
| This game is not available on the host | Install the game on the host, or unhide it on Pyroshine's **Library** page. |
| Steam is already running on the host | Quit Steam on the host's desktop and launch again. See [Pyroshine's Steam tip](https://github.com/karsyboy/pyroshine/blob/main/docs/TIPS.md#close-a-desktop-steam-before-streaming-steam). |
| Pyrolight asks to quit another app | A different game is running on the host. Confirm to end it, or cancel to keep it. |

**Troubleshooting & Diagnostics** (in Quick Access or the settings sidebar)
shows host matches, launch state and errors. **View Log** shows recent log
lines with credentials removed. In Desktop Mode, the full logs are in
PyroDeck's private runtime directory, `/run/user/1000/pyrodeck/` for the
`deck` user (`/tmp/pyrodeck-<user ID>/` on systems without `/run/user`):

| Log | File |
| --- | --- |
| Plugin backend | `backend.log` |
| Launches | `runner.log` |
| Pyrolight output | `runner-pyrolight.log` |
| Frontend | `frontend.log` |

The same directory holds PyroDeck's process records and session status. Only
your user can open it; PyroDeck refuses to use it, or any file in it, that is a
link or belongs to someone else.

PyroDeck's own settings are in `~/.config/pyrodeck/`. Streaming settings and
profiles are stored by Pyrolight.

When [reporting a bug](https://github.com/karsyboy/pyrodeck/issues), include the
PyroDeck, Pyrolight and Pyroshine versions, the SteamOS version, the message you
saw, and the logs above.

## Documentation

- [Validation status](docs/VALIDATION.md)
- [Architecture and settings parity](docs/INTEGRATION.md)
- [Building, testing, and packaging](docs/DEVELOPMENT.md)
- [Pyrolight client integration](https://github.com/karsyboy/pyrolight/blob/master/docs/CLIENT_INTEGRATION.md)

## License and credits

PyroDeck is an independent community fork of
[MoonDeck](https://github.com/FrogTheFrog/moondeck) by FrogTheFrog. It keeps
MoonDeck's Steam Deck integration and replaces MoonDeck Buddy with
[Pyroshine](https://github.com/karsyboy/pyroshine) and
[Pyrolight](https://github.com/karsyboy/pyrolight).

Licensed under the [GNU General Public License v3](LICENSE), like MoonDeck.
