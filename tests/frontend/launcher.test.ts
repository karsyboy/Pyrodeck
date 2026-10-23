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
  terminated: [] as number[],
  names: [] as Array<[number, string]>,
  exitResolver: null as null | ((id: string) => (() => Promise<void>) | null),
  lifetime: null as null | ((data: { unAppID: number; bRunning: boolean }) => void),
  overviews: new Map<number, { BIsShortcut(): boolean; display_name?: string; local_per_client_data?: { display_status: number } }>()
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
    getAppStoreEx: () => ({ getAppOverview: (id: number) => steam.overviews.get(id) ?? null }),
    getGameId: async (id: number) => `gameid-${id}`,
    getAppDetails: vi.fn(async (id: number) => steam.shortcuts.get(id) ?? null),
    setAppLaunchOptions: vi.fn(async (id: number, options: string) => {
      const shortcut = steam.shortcuts.get(id);
      if (shortcut) shortcut.strLaunchOptions = options;
      return shortcut !== undefined;
    }),
    setAppHiddenState: vi.fn(async () => true),
    setShortcutName: vi.fn(async (id: number, name: string) => { steam.names.push([id, name]); return true; }),
    setAppResolutionOverride: vi.fn(async () => true),
    setOverrideResolutionForInternalDisplay: vi.fn(async () => true),
    getAudioDevices: vi.fn(async () => null),
    getDisplayIdentifiers: vi.fn(async () => null),
    getCurrentDisplayModeString: vi.fn(async () => "1280x800"),
    launchApp: vi.fn(async (id: number) => { steam.launched.push(id); return 1; }),
    terminateApp: vi.fn(async (id: number) => { steam.terminated.push(id); return true; }),
    registerForGameLaunchIntercept: vi.fn((callback) => { steam.intercept = callback; return () => {}; }),
    registerForSuspendNotifications: vi.fn((onSuspend, onResume) => { steam.onSuspend = onSuspend; steam.onResume = onResume; return () => {}; }),
    registerForStreamExit: (resolver: typeof steam.exitResolver) => { steam.exitResolver = resolver; return () => { steam.exitResolver = null; }; },
    registerForGameLifetime: vi.fn((callback) => { steam.lifetime = callback; return () => {}; })
  };
});
(globalThis as Record<string, unknown>).SteamClient = { Apps: { SetThirdPartyControllerConfiguration: vi.fn() } };

const switchConfirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../src/lib/confirmswitch", () => ({ confirmStreamSwitch: switchConfirm }));
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
    settings: { value: { currentHostId: "host-a", hostSettings: { "host-a": hostSettings, "host-b": { ...hostSettings, address: "192.168.1.11" } }, gameSession: { autoApplyAppId: false, resumeAfterSuspend, controllerConfig: null }, pythonExecPath: "" } },
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
  steam.names.length = 0;
  steam.overviews.clear();
  steam.overviews.set(892970, { BIsShortcut: () => false, display_name: "Valheim" });
  for (const key of Object.keys(backend)) delete backend[key];
  backend.is_runner_active = () => false;
});

describe("library launch", () => {
  it("launches saved remote entries with their pinned host and preserves them when creating a utility helper", async () => {
    steam.shortcuts.set(77, { unAppID: 77, strShortcutExe: "/home/deck/homebrew/plugins/PyroDeck/python/pyrodeckrun.sh", strLaunchOptions: "PYRODECK_APP_TYPE=3 PYRODECK_LIBRARY_SHORTCUT=1 PYRODECK_HOST_ID=host-b PYRODECK_REMOTE_APP_ID=42 %command%", strDisplayName: "Steam" });
    const { launcher, externalAppShortcuts } = makeLauncher();
    externalAppShortcuts.getEntryByGameId.mockReturnValue({ appId: 77, appName: "Steam", appType: AppType.Remote, hostId: "host-b", remoteAppId: 42 } as never);
    steam.intercept!("gameid-77", vi.fn());
    await vi.waitFor(() => expect(steam.launched).toEqual([77]));
    const options = steam.shortcuts.get(77)!.strLaunchOptions;
    expect(options).toContain("PYRODECK_REMOTE_APP_ID=42");
    expect(options).toContain("PYRODECK_HOST_ID=host-b");
    expect(options).toContain("PYRODECK_LIBRARY_SHORTCUT=1");
    expect(options).not.toContain("PYRODECK_LAUNCHER");
    await launcher.moonDeckApp.clearApp();
    await launcher.launchUtility("pair", "host-a");
    expect(steam.launched.at(-1)).not.toBe(77);
    expect(steam.shortcuts.get(77)!.strLaunchOptions).toBe(options);
  });
  it("launches through the shared Steam launcher with a pinned host and exact Steam app ID", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);

    const shortcutId = steam.launched[0];
    expect(steam.launched).toEqual([shortcutId]);
    expect(steam.shortcuts.get(shortcutId)!.strLaunchOptions).toBe("PYRODECK_APP_TYPE=0 PYRODECK_STEAM_APP_ID=892970 PYRODECK_HOST_ID=host-a PYRODECK_AUTO_RES=1280x800 PYRODECK_LAUNCHER=1 %command%");
    expect(calls.map(([name]) => name)).not.toContain("kill_runner");
  });

  it("keeps the exact remote app ID and native Steam identity for browser launches", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchRemote("host-a", 42, "Valheim", 892970);
    const id = steam.launched[0];
    expect(steam.shortcuts.get(id)!.strLaunchOptions).toContain("PYRODECK_STEAM_APP_ID=892970 PYRODECK_REMOTE_APP_ID=42");
    expect(launcher.moonDeckApp.value?.steamAppId).toBe(892970);
    expect(steam.names.at(-1)).toEqual([id, "Valheim"]);
    expect(steam.names.some(([, name]) => /^\d+$/.test(name))).toBe(false);
  });

  it("uses remote identity for apps absent from the Steam Library", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchRemote("host-a", 42, "A non-Steam game", null);
    const id = steam.launched[0];
    expect(steam.shortcuts.get(id)!.strLaunchOptions).toContain("PYRODECK_APP_TYPE=3 PYRODECK_REMOTE_APP_ID=42");
    expect(launcher.moonDeckApp.value?.moonDeckAppId).toBeNull();
    expect(steam.names).toEqual([[id, "A non-Steam game"]]);
  });

  it("does not associate a host Steam ID with another non-Steam shortcut", async () => {
    steam.overviews.set(892970, { BIsShortcut: () => true });
    const { launcher } = makeLauncher();
    await launcher.launchRemote("host-a", 42, "Valheim", 892970);
    expect(steam.shortcuts.get(steam.launched[0])!.strLaunchOptions).toContain("PYRODECK_APP_TYPE=3");
  });

  it("restores the helper name before Steam Exit and passes unrelated games through", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    const id = steam.launched[0];
    expect(steam.exitResolver!("620")).toBeNull();
    expect(steam.exitResolver!(`gameid-${id}`)).toBeTypeOf("function");
    const disconnect = steam.exitResolver!("892970");
    await disconnect!();
    expect(steam.terminated).toEqual([id]);
    expect(steam.names.at(-1)).toEqual([id, "Valheim"]);
    // Steam's overlay path need not deliver another lifetime notification.
    expect(launcher.moonDeckApp.value).toBeNull();
    // A late running notification cannot reapply the numeric name during exit.
    steam.lifetime!({ unAppID: id, bRunning: true });
    await Promise.resolve();
    expect(steam.names.at(-1)).toEqual([id, "Valheim"]);
    launcher.deinit();
    expect(steam.exitResolver).toBeNull();
  });

  it("never starts a second stream while one runs", async () => {
    const { launcher } = makeLauncher();
    backend.is_runner_active = () => true;
    await expect(launcher.launchApp(892970, "Valheim", AppType.MoonDeck)).rejects.toThrow("already running");
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


describe("running session recovery", () => {
  function existingShortcut(steamAppId = 892970) {
    steam.shortcuts.set(5, { unAppID: 5, strShortcutExe: '"/home/deck/homebrew/plugins/PyroDeck/python/pyrodeckrun.sh"', strLaunchOptions: `PYRODECK_APP_TYPE=0 PYRODECK_STEAM_APP_ID=${steamAppId} PYRODECK_LAUNCHER=1 %command%`, strDisplayName: "892970" });
  }
  it("repairs the numeric title after a plugin reload using the owned runner identity", async () => {
    existingShortcut(); backend.session_status = () => ({ runnerActive: true, steamAppId: 892970, appName: null });
    const { launcher } = makeLauncher();
    await vi.waitFor(() => expect(steam.names).toContainEqual([5, "Valheim"]));
    expect(launcher.moonDeckApp.value?.launcherGameId).toBe("gameid-5");
    expect(steam.launched).toEqual([]);
    launcher.deinit();
  });
  it("does not adopt an unmatched or ended runner", async () => {
    existingShortcut(620); backend.session_status = () => ({ runnerActive: true, steamAppId: 892970, appName: "Valheim" });
    const { launcher } = makeLauncher();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launcher.moonDeckApp.value).toBeNull(); expect(steam.names).toEqual([]);
    launcher.deinit();
  });
  it("does not restore a session after the plugin unloads", async () => {
    existingShortcut(); let finish!: (value: unknown) => void;
    backend.session_status = () => new Promise((resolve) => { finish = resolve; });
    const { launcher } = makeLauncher();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function")); launcher.deinit();
    finish({ runnerActive: true, steamAppId: 892970, appName: "Valheim" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launcher.moonDeckApp.value).toBeNull(); expect(steam.names).toEqual([]);
  });
  it("passes local Steam Exit through when the same game is running locally", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    steam.overviews.set(892970, { BIsShortcut: () => false, local_per_client_data: { display_status: 4 } });
    expect(steam.exitResolver!("892970")).toBeNull();
    expect(steam.exitResolver!(`gameid-${steam.launched[0]}`)).toBeTypeOf("function");
    expect(steam.terminated).toEqual([]); launcher.deinit();
  });
});

describe("launch recovery and races", () => {
  it("clears an exited helper even when its presentation updates while the runner result is pending", async () => {
    const { launcher } = makeLauncher(); await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    let finish!: (value: null) => void;
    backend.get_runner_result = () => new Promise((resolve) => { finish = resolve; });
    steam.lifetime!({ unAppID: steam.launched[0], bRunning: false });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    // Same launch, new immutable subject snapshot (for example, Exit's name restoration).
    launcher.moonDeckApp.canRedirect();
    finish(null); await vi.waitFor(() => expect(launcher.moonDeckApp.value).toBeNull());
    launcher.deinit();
  });
  it("does not clear a newer launch when an old helper exit finishes late", async () => {
    const { launcher } = makeLauncher(); await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    let finish!: (value: null) => void;
    backend.get_runner_result = () => new Promise((resolve) => { finish = resolve; });
    steam.lifetime!({ unAppID: steam.launched[0], bRunning: false });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    launcher.moonDeckApp.setApp(620, steam.launched[0], "Portal", AppType.MoonDeck, { nameSetToAppId: false });
    const newer = launcher.moonDeckApp.value; finish(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launcher.moonDeckApp.value).toBe(newer); launcher.deinit();
  });
  it("rejects concurrent Library presses before any runner PID exists", async () => {
    const { launcher } = makeLauncher();
    let release!: () => void;
    backend.is_runner_active = () => new Promise((resolve) => { release = () => resolve(false); });
    const first = launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(launcher.launchApp(620, "Portal", AppType.MoonDeck)).rejects.toThrow("in progress");
    release(); await first; expect(steam.launched).toHaveLength(1); launcher.deinit();
  });
  it("surfaces helper creation failure and permits retry", async () => {
    const utils = await import("../../src/lib/steamutils");
    vi.mocked(utils.addShortcut).mockResolvedValueOnce(null);
    const { launcher } = makeLauncher();
    await expect(launcher.launchApp(892970, "Valheim", AppType.MoonDeck)).rejects.toThrow("Steam could not create");
    expect(steam.launched).toEqual([]);
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck); expect(steam.launched).toHaveLength(1); launcher.deinit();
  });
  it("cleans a failed Steam launch and can retry", async () => {
    const utils = await import("../../src/lib/steamutils");
    vi.mocked(utils.launchApp).mockResolvedValueOnce(0);
    const { launcher } = makeLauncher();
    await expect(launcher.launchApp(892970, "Valheim", AppType.MoonDeck)).rejects.toThrow("timed out");
    expect(launcher.moonDeckApp.value).toBeNull();
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck); expect(steam.launched).toHaveLength(1); launcher.deinit();
  });
  it("asks before switching and carries conditional termination only for the same host", async () => {
    const { launcher } = makeLauncher();
    await launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    let running = true;
    backend.is_runner_active = () => running;
    backend.session_status = () => ({ hostId: "host-a", remoteAppId: 42, appName: "Valheim", runnerActive: true });
    backend.kill_runner = () => { running = false; };
    await launcher.launchApp(620, "Portal", AppType.MoonDeck, undefined, { hostId: "host-a", remoteAppId: 43 });
    expect(switchConfirm).toHaveBeenCalledWith("Valheim", "Host", true);
    expect(steam.shortcuts.get(steam.launched.at(-1)!)!.strLaunchOptions).toContain("PYRODECK_TERMINATE_APP_ID=42");
    launcher.deinit();
  });
  it("keeps the existing session when switch confirmation is declined", async () => {
    const { launcher } = makeLauncher();
    backend.is_runner_active = () => true;
    backend.session_status = () => ({ hostId: "host-a", remoteAppId: 42, appName: "Valheim", runnerActive: true });
    switchConfirm.mockResolvedValueOnce(false);
    await launcher.launchApp(620, "Portal", AppType.MoonDeck, undefined, { hostId: "host-a", remoteAppId: 43 });
    expect(steam.launched).toEqual([]); expect(calls.map(([name]) => name)).not.toContain("kill_runner"); launcher.deinit();
  });
  it("aborts a pending launch after plugin unload", async () => {
    const { launcher } = makeLauncher();
    let finish!: () => void;
    backend.is_runner_active = () => new Promise((resolve) => { finish = () => resolve(false); });
    const launch = launcher.launchApp(892970, "Valheim", AppType.MoonDeck);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function")); launcher.deinit(); finish();
    await expect(launch).rejects.toThrow("unloaded"); expect(steam.launched).toEqual([]);
  });
});
