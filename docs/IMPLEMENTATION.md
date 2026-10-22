# SteamOS integration checklist

Dependency order:

1. Pyroshine advertises stable GameStream IDs and authenticated launcher identities (existing contract).
2. Pyrolight exposes its settings registry, validation, profile transactions and stable-ID targeting.
3. PyroDeck consumes those interfaces for settings drafts, catalogs and host-specific launches.
4. Quick Access and library integration use the same orchestration and preferences.
5. Automated checks validate contracts; Steam Deck acceptance validates hardware behavior.

Implementation and validation status is recorded in DEVELOPMENT.md. No upstream synchronization or publishing is part of this change.

Implemented: native settings/profile API and parity registry; stable-ID targets;
structured client lifecycle; separate library action and explicit host policy;
remote game browser; pending settings and explicit reconnect; conditional host
termination; automated regression suites and updated installation documentation.

Remaining acceptance: the real SteamOS/hardware matrix in INTEGRATION.md.
Runtime HDR/VRR/display restrictions are checked at client launch, and detailed
performance counters stay in the Pyrolight overlay. Same-application host
session replacement is not distinguished by conditional app-ID cancellation.
