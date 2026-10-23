# PyroDeck development

The current architecture, transactions, settings parity matrix, host policy
and hardware acceptance limits are in [INTEGRATION.md](INTEGRATION.md).

## Build and checks

```sh
pnpm install
pnpm run test
pnpm run typecheck
pnpm run test:unit
pnpm run test:python
pnpm run build
pnpm run build:plugin
```

Frontend tests cover launch identities, the isolated Steam-tree adapter,
Library route ownership and focus-context registration across separate
documents, native button/menu wiring, raw running-app window scans,
native Play/Install preservation, host policy, settings drafts, failed
reconnects, process ownership and suspend orchestration. Python tests use
`tests/python/fakes/fake_pyrolight.py` and loopback GameStream servers. They
require local sockets and process signals; CI runs the suite on Python 3.13.

Performance regressions use deterministic work counts rather than wall-clock
thresholds: unrelated Steam lookup counts/MobX dependencies, ignored DOM churn,
shared polling and pending-request counts, stable snapshots, hidden-view render
counts, retained UI state and deferred catalog refresh during a stream. These
checks do not measure frame time on a Steam Deck.

The Pyrolight side must also pass `streamingpreferences_test.pro` and
`settingsapi_test.pro`; its CI runs both. Pyroshine’s lifecycle suite tests
conditional cancellation and its web tests verify authentication and legacy
GameStream compatibility.

## Packaging and configuration compatibility

The frontend bundle goes in `dist/`. Decky packaging places `defaults/python`
at `python/` beside `main.py`. Deploying over SSH is optional and requires the
project’s `.env` configuration. No deployment or upstream push is part of
local validation.

Schema 45 migrates schema 44 and MoonDeck imports, removing obsolete floating
button styles/offsets while preserving the explicit Library enable/disable
choice, hosts and launch preferences. Compatibility
keys with Moonlight names identify the Pyrolight executable or retain old
per-host launch hints. Current native launches ignore legacy stream overrides;
Pyrolight’s active profile owns them. Old Pyrolight installations can still use
the limited legacy CLI path, but need updating for settings and lifecycle
features. No Pyrolight credential or profile file is edited from Python.

Legacy generated library shortcuts remain available for migration/cleanup.
Normal launches use the reusable `PYRODECK_LAUNCHER=1` shortcut. Only PyroDeck’s
own `pyrodeckrun.sh` shortcuts and PID/start-time records are managed.

## Device acceptance

Run the matrix in [INTEGRATION.md](INTEGRATION.md#validation-and-remaining-device-acceptance)
on a Steam Deck and paired host before calling this integration production
validated. Automated tests are not evidence of hardware streaming, latency,
controller focus or actual Steam UI compatibility.
