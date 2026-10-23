import { beforeEach, describe, expect, it, vi } from "vitest";

const steam = vi.hoisted(() => ({
  details: new Map<number, any>(),
  nextId: 1000,
  deleted: null as null | ((change: { type: string; name: number }) => void)
}));
vi.mock("@decky/api", () => ({ call: vi.fn(), toaster: { toast: vi.fn() } }));
vi.mock("../../src/lib/steamutils", async () => ({
  ...await vi.importActual<typeof import("../../src/lib/launchenv")>("../../src/lib/launchenv"),
  getAppStoreEx: () => ({ observe: (callback: typeof steam.deleted) => { steam.deleted = callback; return () => {}; }, getAppOverview: (id: number) => steam.details.has(id) ? { gameid: `game-${id}` } : null }),
  getMoonDeckRunPath: async () => "/plugin/python/pyrodeckrun.sh",
  addShortcut: vi.fn(async (name: string, exe: string) => {
    const id = steam.nextId++;
    steam.details.set(id, { unAppID: id, strDisplayName: name, strShortcutExe: exe, strLaunchOptions: "" });
    return id;
  }),
  setAppLaunchOptions: vi.fn(async (id: number, options: string) => { steam.details.get(id).strLaunchOptions = options; return true; }),
  getAppDetailsForAppIds: async (ids: number[]) => ids.flatMap((id) => steam.details.get(id) ?? []),
  removeShortcut: vi.fn(async (id: number) => steam.details.delete(id)),
  getOrCreateCollection: async () => ({ apps: new Map(), allApps: new Map() }),
  addAppsToCollection: vi.fn(async () => true),
  removeAppsFromCollection: vi.fn(async () => true),
  restartSteamClient: vi.fn()
}));
const { ExternalAppShortcuts } = await import("../../src/lib/externalappshortcuts");
const { AppSyncState } = await import("../../src/lib/appsyncstate");
const { AppType, EnvVars } = await import("../../src/lib/launchenv");
const { getEnvKeyValueString } = await import("../../src/lib/envutils");
const utils = await import("../../src/lib/steamutils");
function manager(init = true) {
  const state = new AppSyncState();
  const settings = { settings: { value: { currentHostId: "host-b", hostSettings: { "host-a": {}, "host-b": {} } } } };
  const shortcuts = new ExternalAppShortcuts(state, settings as never);
  if (init) shortcuts.init([...steam.details.values()]);
  return { shortcuts, state };
}
beforeEach(() => { steam.details.clear(); vi.clearAllMocks(); });

describe("individual remote Steam shortcuts", () => {
  it("saves the advertised Steam entry, pinned by host and stable ID, in the collection", async () => {
    const { shortcuts, state } = manager();
    const id = await shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" });
    const details = steam.details.get(id);
    expect(details.strDisplayName).toBe("Steam");
    expect(getEnvKeyValueString(details.strLaunchOptions, EnvVars.HostId)).toBe("host-a");
    expect(getEnvKeyValueString(details.strLaunchOptions, EnvVars.RemoteAppId)).toBe("42");
    expect(getEnvKeyValueString(details.strLaunchOptions, EnvVars.LibraryShortcut)).toBe("1");
    expect(details.strLaunchOptions).not.toContain("PYRODECK_LAUNCHER");
    expect(shortcuts.getEntryByGameId(`game-${id}`)).toMatchObject({ appId: id, appType: AppType.Remote, hostId: "host-a", remoteAppId: 42 });
    expect(utils.addAppsToCollection).toHaveBeenCalledWith("PyroDeck", [id]);
    expect(state.getState().syncing).toBe(false);
  });
  it("deduplicates by host and ID across renames and reloads, not by display name", async () => {
    const first = manager().shortcuts;
    const id = await first.addRemoteShortcut("host-a", { id: 42, name: "Steam" });
    first.deinit();
    const { shortcuts } = manager();
    expect(await shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Renamed Steam" })).toBe(id);
    expect(await shortcuts.addRemoteShortcut("host-b", { id: 42, name: "Steam" })).not.toBe(id);
    expect(await shortcuts.addRemoteShortcut("host-a", { id: 43, name: "Steam" })).not.toBe(id);
    expect(steam.details.size).toBe(3);
  });
  it("allows re-adding a shortcut removed from Steam", async () => {
    const { shortcuts } = manager();
    const id = await shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" });
    steam.details.delete(id); steam.deleted!({ type: "delete", name: id });
    expect(await shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" })).not.toBe(id);
  });
  it("leaves individually saved shortcuts intact during legacy bulk cleanup", async () => {
    const { shortcuts } = manager();
    const id = await shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" });
    steam.details.set(99, { unAppID: 99, strDisplayName: "Desktop", strShortcutExe: "/plugin/python/pyrodeckrun.sh", strLaunchOptions: "PYRODECK_APP_TYPE=1 PYRODECK_APP_NAME=Desktop %command%" });
    shortcuts.deinit(); shortcuts.init([...steam.details.values()]);
    await shortcuts.purgeShortcuts(AppType.GameStream);
    expect(steam.details.has(99)).toBe(false);
    expect(steam.details.has(id)).toBe(true);
    expect(shortcuts.appInfo.value.get(id)).toMatchObject({ hostId: "host-a", remoteAppId: 42 });
  });
  it("cleans up failed creation and releases the shared operation state", async () => {
    const { shortcuts, state } = manager();
    vi.mocked(utils.setAppLaunchOptions).mockResolvedValueOnce(false);
    await expect(shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" })).rejects.toThrow("launch options");
    expect(steam.details.size).toBe(0);
    expect(shortcuts.appInfo.value.size).toBe(0);
    expect(state.getState().syncing).toBe(false);
  });
  it("rejects concurrent adds, invalid targets, and use before discovery", async () => {
    await expect(manager(false).shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" })).rejects.toThrow("initializing");
    const { shortcuts } = manager();
    for (const id of [0, -1, 1.5, 0x80000000]) await expect(shortcuts.addRemoteShortcut("host-a", { id, name: "Game" })).rejects.toThrow("Invalid");
    await expect(shortcuts.addRemoteShortcut("missing", { id: 42, name: "Steam" })).rejects.toThrow("configured");
    const pending = shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" });
    await expect(shortcuts.addRemoteShortcut("host-a", { id: 42, name: "Steam" })).rejects.toThrow("progress");
    await pending;
    expect(steam.details.size).toBe(1);
  });
  it("does not adopt the shared helper or another plugin's shortcuts", () => {
    const options = "PYRODECK_APP_TYPE=3 PYRODECK_HOST_ID=host-a PYRODECK_REMOTE_APP_ID=42";
    steam.details.set(5, { unAppID: 5, strDisplayName: "Helper", strShortcutExe: "/plugin/pyrodeckrun.sh", strLaunchOptions: options + " PYRODECK_LAUNCHER=1" });
    steam.details.set(6, { unAppID: 6, strDisplayName: "Other", strShortcutExe: "/other/moondeckrun.sh", strLaunchOptions: options + " PYRODECK_LIBRARY_SHORTCUT=1" });
    expect(manager().shortcuts.appInfo.value.size).toBe(0);
  });
});
