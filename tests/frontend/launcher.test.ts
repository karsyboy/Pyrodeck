import { beforeEach, describe, expect, it, vi } from "vitest";

// Backend calls (main.py) the launcher makes, answered per test.
const backend: Record<string, (...args: unknown[]) => unknown> = {};
const calls: Array<[string, unknown[]]> = [];
vi.mock("@decky/api", () => ({
  call: vi.fn(async (name: string, ...args: unknown[]) => {
    calls.push([name, args]);
    return await backend[name]?.(...args);
  }),
  toaster: { toast: vi.fn() }
}));

vi.mock("@decky/ui", () => ({ sleep: async (ms: number) => await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20))) }));

// SteamClient is reached through steamutils only; mock it with real launch-env helpers.
const steam = vi.hoisted(() => ({
  shortcuts: new Map<number, { unAppID: number; strShortcutExe: string; strLaunchOptions: string; strDisplayName: string }>(),
  nextId: 1000,
  launched: [] as number[],
  intercept: null as null | ((gameId: string, cancel: () => void) => void),
  onSuspend: null as null | (() => Promise<void>),
  onResume: null as null | (() => Promise<void>),
  terminated: [] as number[]
}));
vi.mock("../../src/lib/steamutils", async () => {
  const env = await vi.importActual<typeof import("../../src/lib/launchenv")>("../../src/lib/launchenv");
  const runPath = "/home/deck/homebrew/plugins/PyroDeck/python/pyrodeckrun.sh";
  return {
    ...env,
    AppStartResult: { TimeoutOrError: 0, Started: 1, Cancelled: 2 },
    ControllerConfigOption: { Disable: 0, Default: 1, Enable: 2 },
    getMoonDeckRunPath: vi.fn(async () => runPath),
    checkExecPathMatch: (execPath: string, exe: string) => exe.includes(execPath),
    getSystemNetworkStore: () => ({ hasNetworkConnection: true }),
    addShortcut: vi.fn(async (name: string, exe: string) => {
      const id = steam.nextId++;
      steam.shortcuts.set(id, { unAppID: id, strShortcutExe: `"${exe}"`, strLaunchOptions: "", strDisplayName: name });
      return id;
    }),
    removeShortcut: vi.fn(async (id: number) => steam.shortcuts.delete(id)),
    getAppDetails: vi.fn(async (id: number) => steam.shortcuts.get(id) ?? null),
    setAppLaunchOptions: vi.fn(async (id: number, options: string) => {
      const shortcut = steam.shortcuts.get(id);
      if (shortcut) shortcut.strLaunchOptions = options;
      return shortcut !== undefined;
    }),
    setAppHiddenState: vi.fn(async () => true),
    setShortcutName: vi.fn(async () => true),
    setAppResolutionOverride: vi.fn(async () => true),
    setOverrideResolutionForInternalDisplay: vi.fn(async () => true),
    getAudioDevices: vi.fn(async () => null),
    getDisplayIdentifiers: vi.fn(async () => null),
    getCurrentDisplayModeString: vi.fn(async () => "1280x800"),
    launchApp: vi.fn(async (id: number) => { steam.launched.push(id); return 1; }),
    terminateApp: vi.fn(async (id: number) => { steam.terminated.push(id); return true; }),
    registerForGameLaunchIntercept: vi.fn((callback) => { steam.intercept = callback; return () => {}; }),
    registerForSuspendNotifications: vi.fn((onSuspend, onResume) => { steam.onSuspend = onSuspend; steam.onResume = onResume; return () => {}; }),
    registerForGameLifetime: vi.fn(() => () => {})
  };
});
(globalThis as Record<string, unknown>).SteamClient = { Apps: { SetThirdPartyControllerConfiguration: vi.fn() } };

const { MoonDeckAppLauncher } = await import("../../src/lib/moondeckapplauncher");
const { AppSyncState } = await import("../../src/lib/appsyncstate");
const { AppType } = await import("../../src/lib/launchenv");

function makeSettings(resumeAfterSuspend = false) {
  const hostSettings = {
    address: "192.168.1.10",
    resolution: { automatic: true, appResolutionOverride: "Default", appResolutionOverrideForInternalDisplay: false, useCustomDimensions: false, useLinkedDisplays: false, selectedDimensionIndex: -1, dimensions: [] },
    audio: { useLinkedAudio: false },
    runnerTimeouts: { servicePing: 5, wakeOnLan: 60, steamLaunch: 5 }
  };
  return {
    settings: { value: { currentHostId: "host-a", hostSettings: { "host-a": hostSettings }, gameSession: { autoApplyAppId: false, resumeAfterSuspend, controllerConfig: null }, pythonExecPath: "" } },
    hostSettings
  };
}

function makeLauncher(resumeAfterSuspend = false) {
  const moonDeckShortcuts = new Map<number, number>();
  const moonDeckAppShortcuts = {
    initializing: false,
    getId: (steamAppId: number) => moonDeckShortcuts.get(steamAppId) ?? null,
    addShortcut: async (steamAppId: number, name: string, exe: string) => {
      const steamutils = await import("../../src/lib/steamutils");
      const id = await steamutils.addShortcut(name, exe);
      if (id !== null) moonDeckShortcuts.set(steamAppId, id);
      return id;
    },
    removeShortcut: vi.fn(),
    updateAppLaunchTimestamp: vi.fn()
  };
  const externalAppShortcuts = { initializing: false, getEntryByGameId: vi.fn(() => null) };
  const launcher = new MoonDeckAppLauncher(new AppSyncState(), makeSettings(resumeAfterSuspend) as never, moonDeckAppShortcuts as never, externalAppShortcuts as never);
  launcher.init([...steam.shortcuts.values()] as never);
  return { launcher, moonDeckShortcuts, externalAppShortcuts };
}

beforeEach(() => {
  steam.shortcuts.clear();
  steam.launched.length = 0;
  steam.terminated.length = 0;
  calls.length = 0;
  for (const key of Object.keys(backend)) delete backend[key];
  backend.is_runner_active = () => false;
});

describe("library launch", () => {
  it("launches through the shared Steam launcher with a pinned host and exact Steam app ID", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);

    const shortcutId = steam.launched[0];
    expect(steam.launched).toEqual([shortcutId]);
    expect(steam.shortcuts.get(shortcutId)!.strLaunchOptions).toBe("PYRODECK_APP_TYPE=0 PYRODECK_STEAM_APP_ID=892970 PYRODECK_HOST_ID=host-a PYRODECK_AUTO_RES=1280x800 PYRODECK_LAUNCHER=1 %command%");
    expect(calls.map(([name]) => name)).not.toContain("kill_runner");
  });

  it("never starts a second stream while one runs", async () => {
    const { launcher } = makeLauncher();
    backend.is_runner_active = () => true;
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    expect(steam.launched).toEqual([]);
  });

  it("cancels repeated launches of a synced app while one is starting", async () => {
    const { launcher, externalAppShortcuts } = makeLauncher();
    let release: () => void = () => {};
    backend.is_runner_active = () => new Promise<boolean>((resolve) => { release = () => resolve(false); });
    externalAppShortcuts.getEntryByGameId.mockReturnValue({ appId: 77, appName: "Desktop", appType: AppType.GameStream } as never);
    steam.shortcuts.set(77, { unAppID: 77, strShortcutExe: "\"/home/deck/homebrew/plugins/PyroDeck/python/pyrodeckrun.sh\"", strLaunchOptions: "PYRODECK_APP_TYPE=1 PYRODECK_APP_NAME=Desktop %command%", strDisplayName: "Desktop" });

    const cancels = [vi.fn(), vi.fn()];
    steam.intercept!("gameid-77", cancels[0]);
    steam.intercept!("gameid-77", cancels[1]);
    expect(cancels[0]).toHaveBeenCalled();
    expect(cancels[1]).toHaveBeenCalled();

    // The first launch is waiting on the runner check; a third press is cancelled too.
    await vi.waitFor(() => expect(calls.map(([name]) => name)).toContain("is_runner_active"));
    const third = vi.fn();
    steam.intercept!("gameid-77", third);
    expect(third).toHaveBeenCalled();

    release();
    await vi.waitFor(() => expect(steam.launched).toEqual([77]));
  });
});

describe("ending the host game", () => {
  it("is a separate utility launch running Pyrolight's quit, with one shortcut reused", async () => {
    const { launcher } = makeLauncher();
    await launcher.endHostGame();
    await launcher.endHostGame();

    const utility = [...steam.shortcuts.values()].filter((shortcut) => shortcut.strLaunchOptions.includes("PYRODECK_APP_TYPE=2"));
    expect(utility).toHaveLength(1);
    expect(utility[0].strLaunchOptions).toContain("PYRODECK_ACTION=quit");
    expect(steam.launched).toEqual([utility[0].unAppID, utility[0].unAppID]);
  });

  it("disconnects a running stream first and waits for the runner to exit", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    let runnerChecks = 0;
    // The runner is still exiting for a few checks after Steam ended the shortcut.
    backend.is_runner_active = () => ++runnerChecks < 4;
    backend.kill_runner = () => { runnerChecks = 4; };

    await launcher.endHostGame();
    const utility = [...steam.shortcuts.values()].find((shortcut) => shortcut.strLaunchOptions.includes("PYRODECK_ACTION=quit"))!;
    expect(steam.terminated).toHaveLength(1);
    expect(steam.launched.at(-1)).toBe(utility.unAppID);
    expect(runnerChecks).toBeGreaterThanOrEqual(4);
  });

  it("finds the utility shortcut again after a restart", async () => {
    steam.shortcuts.set(5, { unAppID: 5, strShortcutExe: "\"/home/deck/homebrew/plugins/PyroDeck/python/pyrodeckrun.sh\"", strLaunchOptions: "PYRODECK_APP_TYPE=2 PYRODECK_ACTION=pair %command%", strDisplayName: "PyroDeck" });
    // MoonDeck's own utility-looking shortcut is not PyroDeck's.
    steam.shortcuts.set(6, { unAppID: 6, strShortcutExe: "\"/home/deck/homebrew/plugins/MoonDeck/python/moondeckrun.sh\"", strLaunchOptions: "PYRODECK_APP_TYPE=2 %command%", strDisplayName: "MoonDeck" });
    const { launcher } = makeLauncher();
    await launcher.launchUtility("pair");
    expect(steam.launched).toEqual([5]);
    expect(steam.shortcuts.size).toBe(2);
  });
});

describe("suspend and resume", () => {
  it("suspends only the local stream and never touches the host", async () => {
    const { launcher } = makeLauncher(true);
    backend.suspend_runner = () => true;
    backend.unsuspend_runner = () => true;
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    calls.length = 0;

    await steam.onSuspend!();
    await steam.onResume!();
    expect(calls.map(([name]) => name).filter((name) => name !== "frontend_log_entry")).toEqual(["suspend_runner", "unsuspend_runner"]);
  });

  it("closes the stream on resume unless resuming is enabled", async () => {
    const { launcher } = makeLauncher(false);
    backend.suspend_runner = () => true;
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    await steam.onSuspend!();
    await steam.onResume!();
    expect(steam.terminated).toEqual([steam.launched[0]]);
    expect(calls.map(([name]) => name)).not.toContain("unsuspend_runner");
  });
});
