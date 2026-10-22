import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterPatch, beforePatch } from "@decky/ui/dist/utils/patcher";
import {
  installSteamPresentation,
  PresentationHooks,
  StreamIdentity,
} from "../../src/lib/steampresentation";

const hooks: PresentationHooks = {
  after(target, key, handler) {
    const patch = afterPatch(target, key, handler);
    return () => patch.unpatch();
  },
  before(target, key, handler) {
    const patch = beforePatch(target, key, handler);
    return () => patch.unpatch();
  },
};
beforeEach(() => vi.spyOn(console, "debug").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const native = {
    appid: 892970,
    display_name: "Valheim",
    app_type: 1,
    gameid: "892970",
    local_per_client_data: { display_status: 11 },
    BIsShortcut: () => false,
    GetGameID: () => "892970",
  };
  const helper = {
    appid: 3000000000,
    display_name: "Valheim",
    app_type: 1073741824,
    gameid: "12884901888000000000",
    local_per_client_data: { display_status: 4 },
    BIsShortcut: () => true,
    GetGameID: () => "12884901888000000000",
  };
  const other = { ...native, appid: 620, display_name: "Portal 2" };
  const map = new Map([
    [native.appid, native],
    [helper.appid, helper],
    [other.appid, other],
  ]);
  const store = {
    GetAppOverviewByAppID: (id: number) => map.get(id) ?? null,
    GetAppOverviewByGameID: (id: string) =>
      [...map.values()].find((app) => app.gameid === id),
    GetIconURLForApp: vi.fn((app) => `steam-art/${app.appid}`),
  };
  const nativeDetails = {
    unAppID: 892970,
    achievements: { nTotal: 85 },
    description: "Steam's real game details",
  };
  const helperDetails = {
    unAppID: helper.appid,
    achievements: { nTotal: 0 },
    strShortcutExe: "pyrodeckrun.sh",
  };
  const unRegister = vi.fn();
  const details = {
    GetAppDetails: (id: number) =>
      id === native.appid ? nativeDetails : helperDetails,
    GetAppData: (id: number) =>
      id === native.appid
        ? { details: nativeDetails }
        : { details: helperDetails },
    RegisterForAppData: vi.fn(() => ({ unregister: unRegister })),
  };
  const windows = {
    GetAppWindowIDs: vi.fn((id: number) => [id, 7]),
    GetAppFocusedWindowID: vi.fn((id: number) => id),
    SetFocusedAppWindowID: vi.fn(),
    BHasAppWindow: vi.fn(() => true),
    GetOverlayInstances: vi.fn(() => []),
  };
  const router = { WindowStore: windows, SetRunningApp: vi.fn() };
  const systemUI = { GetGameWindowsInfo: vi.fn(), CloseGameWindow: vi.fn() };
  let session: StreamIdentity | null = {
    helperAppId: helper.appid,
    steamAppId: native.appid,
    gameId: helper.gameid,
  };
  const executionCalls = {
    resume: router.SetRunningApp,
    focus: windows.SetFocusedAppWindowID,
    info: systemUI.GetGameWindowsInfo,
  };
  const bridge = installSteamPresentation({
    appStore: store,
    details,
    router,
    systemUI,
    session: () => session,
    hooks,
    status: vi.fn(),
  });
  return {
    executionCalls,
    native,
    helper,
    other,
    map,
    store,
    details,
    nativeDetails,
    helperDetails,
    windows,
    router,
    systemUI,
    unRegister,
    bridge,
    end: () => {
      session = null;
      bridge.refresh();
    },
  };
}

describe("running Steam game presentation", () => {
  it("uses real game metadata but retains the actual helper's execution IDs and running state", () => {
    const f = fixture();
    const view = f.store.GetAppOverviewByAppID(f.helper.appid)!;
    expect(view.display_name).toBe("Valheim");
    expect(view.appid).toBe(892970);
    expect(view.BIsShortcut()).toBe(false);
    expect(view.gameid).toBe(f.helper.gameid);
    expect(view.GetGameID()).toBe(f.helper.gameid);
    expect(view.local_per_client_data).toBe(f.helper.local_per_client_data);
    expect((view as any).shortcut_override_appid).toBe(f.helper.appid);
    expect(f.store.GetAppOverviewByAppID(f.helper.appid)).toBe(view);
    expect(f.map.get(f.helper.appid)).toBe(f.helper);
    expect(f.helper.appid).toBe(3000000000);
    f.bridge.stop();
  });
  it("keeps the official game overview and local Play state untouched", () => {
    const f = fixture();
    expect(f.store.GetAppOverviewByAppID(892970)).toBe(f.native);
    expect(f.native.local_per_client_data.display_status).toBe(11);
    expect(f.store.GetAppOverviewByAppID(620)).toBe(f.other);
    expect(f.details.GetAppDetails(f.helper.appid)).toBe(f.nativeDetails);
    expect(f.store.GetIconURLForApp(f.helper)).toBe("steam-art/892970");
    f.bridge.stop();
  });
  it("routes Resume and window controls to the helper, while other games pass through", () => {
    const f = fixture();
    f.router.SetRunningApp(892970);
    f.windows.SetFocusedAppWindowID(892970, 7);
    f.systemUI.GetGameWindowsInfo(892970, [7]);
    expect(f.executionCalls.resume).toHaveBeenCalledWith(f.helper.appid);
    expect(f.executionCalls.focus).toHaveBeenCalledWith(f.helper.appid, 7);
    expect(f.executionCalls.info).toHaveBeenCalledWith(f.helper.appid, [7]);
    f.router.SetRunningApp(620);
    expect(f.executionCalls.resume).toHaveBeenLastCalledWith(620);
    f.bridge.stop();
  });
  it("does not redirect a local copy of the same game after local Play starts it", () => {
    const f = fixture();
    f.native.local_per_client_data.display_status = 4;
    expect(f.store.GetAppOverviewByAppID(f.helper.appid)).toBe(f.helper);
    f.router.SetRunningApp(892970);
    expect(f.executionCalls.resume).toHaveBeenCalledWith(892970);
    f.bridge.stop();
  });
  it("removes projections and metadata registrations at disconnect and unload", () => {
    const f = fixture();
    f.bridge.refresh();
    f.end();
    expect(f.unRegister).toHaveBeenCalledOnce();
    expect(f.store.GetAppOverviewByAppID(f.helper.appid)).toBe(f.helper);
    f.bridge.stop();
    expect(f.details.GetAppDetails(f.helper.appid)).toBe(f.helperDetails);
    f.router.SetRunningApp(892970);
    expect(f.executionCalls.resume).toHaveBeenCalledWith(892970);
  });
  it("reads frozen native overviews without changing their identity or fields", () => {
    const f = fixture();
    Object.freeze(f.native);
    Object.freeze(f.helper);
    const view = f.store.GetAppOverviewByAppID(f.helper.appid)!;
    expect({ ...view }.appid).toBe(892970);
    expect(view.BIsShortcut()).toBe(false);
    expect(f.store.GetAppOverviewByGameID(f.helper.gameid)).toBe(view);
    expect(f.store.GetAppOverviewByGameID("892970")).toBe(f.native);
    f.bridge.stop();
  });
  it("rolls back earlier patches if a Steam method cannot be patched", () => {
    const lookup = vi.fn();
    const store = { GetAppOverviewByAppID: lookup };
    const details = Object.freeze({ GetAppDetails: () => null });
    expect(() =>
      installSteamPresentation({
        appStore: store,
        details,
        session: () => null,
        hooks,
        status: vi.fn(),
      }),
    ).toThrow();
    expect(store.GetAppOverviewByAppID).toBe(lookup);
  });
});
