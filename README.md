# PyroDeck

A [Decky Loader](https://decky.xyz/) plugin that streams the Steam games installed
on your [Pyroshine](https://github.com/karsyboy/pyroshine) host to the Steam Deck
through [Pyrolight](https://github.com/karsyboy/pyrolight): open a game's page in
your Steam library, press the PyroDeck button and play.

PyroDeck is a fork of [MoonDeck](https://github.com/FrogTheFrog/moondeck) by
FrogTheFrog. It keeps MoonDeck's Steam Deck integration and needs no extra
program on the host: no MoonDeck Buddy, no special host app.

![quicksettings](.github/assets/quickmenu.png)

## Requirements

- A Linux PC running Pyroshine 0.18 or newer, with Steam and your games
  installed there. Older Pyroshine versions and other GameStream hosts cannot
  tell PyroDeck which Steam game is which.
- A Steam Deck (SteamOS 3.7 or newer) with [Decky Loader](https://decky.xyz/).
- Pyrolight with `list --json` (the release after 6.2.7) on the Steam Deck.

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
another file, set it under **Pyrolight Settings → Use a specific Pyrolight
executable**.

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

Select the host. **Host Info** shows whether it reports Steam app IDs.

## 4. Pair

On **Host Selection**, under **Pyrolight**:

1. Press **Pair**. Pyrolight opens and shows a four-digit PIN.
2. On the host, approve the request with that PIN in Pyroshine's web
   interface (**Clients**) or with `pyroshine pair`.
3. Pyrolight closes. Press **Check**: the pairing status shows **Paired**.

Pairing is Pyrolight's own. PyroDeck never reads or copies its credentials.

## 5. Launch a game

Open any Steam game that is installed on the host and press the PyroDeck
button on its library page. PyroDeck wakes the host if needed (Wake-on-LAN),
finds that exact game on the host by its Steam app ID and starts Pyrolight
through Steam, so Game Mode focus, Steam Input and the overlay work as for any
game.

Apps that are not in your Steam library (Desktop, Lutris or Heroic games, your
own Pyroshine entries) can be added as Steam shortcuts on the **Host Apps**
page.

## 6. Disconnect or end the game

- **Disconnect** (or Steam's **Exit Game**, or suspending the Deck) closes
  Pyrolight only. The game keeps running on the host; press the PyroDeck
  button again to continue where you left off.
- **End Game on Host** (quick access menu) closes the game on the host. It
  asks first, and is the only PyroDeck action that stops anything there.

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

Settings are stored in `~/.config/pyrodeck/settings.json`.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the architecture, the
contract with Pyroshine and Pyrolight, building and tests.

## License

GNU GPLv3, like MoonDeck.
