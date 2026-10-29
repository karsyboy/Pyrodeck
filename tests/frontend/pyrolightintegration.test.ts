import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@decky/api", () => backend);
import { PyrolightIntegration, appKind, eligibleHosts, preferredHost, steamArtwork, steamSourceId, unansweredHostMessage } from "../../src/lib/pyrolightintegration";

const prefs = { schema: 1, ok: true, revision: "one", activeProfileId: "default", activeProfileName: "Default", profiles: [{ id: "default", name: "Default" }], values: { fps: 60, enableHdr: false }, registry: [{ key: "fps", type: "integer", category: "Video & Display", scope: "profile", application: "reconnect" }], capabilities: { liveUpdates: false } };
const app = { id: 42, name: "A game", sources: ["steam:620"], hdr_supported: false };
const host = { id: "default", name: "Default PC", status: "paired", apps: [app] };

beforeEach(() => backend.call.mockReset());
afterEach(() => vi.useRealTimers());
describe("session polling work", () => {
  it("fetches post-exit status after an older in-flight streaming poll finishes", async () => {
    let finish!: (value: any) => void;
    backend.call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ schema: 1, state: "disconnected", runnerActive: false, updatedAt: 2 });
    const store = new PyrolightIntegration(); const oldPoll = store.refreshSession();
    const exit = store.refreshSession(true);
    finish({ schema: 1, state: "streaming", runnerActive: true, updatedAt: 1 });
    await Promise.all([oldPoll, exit]);
    expect(backend.call).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().session).toMatchObject({ state: "disconnected", runnerActive: false });
  });
  it("recovers when the backend throws before returning a request promise", async () => {
    const store = new PyrolightIntegration();
    backend.call.mockImplementationOnce(() => { throw Error("Decky is restarting"); });
    await store.refreshSession(); expect(store.getSnapshot().error).toContain("Decky is restarting");
    backend.call.mockResolvedValueOnce({ schema: 1, state: "streaming" });
    await store.refreshSession(); expect(store.getSnapshot().session.state).toBe("streaming");
    backend.call.mockImplementationOnce(() => { throw Error("Decky is restarting"); });
    await expect(store.catalog(true)).rejects.toThrow("Decky is restarting");
    backend.call.mockResolvedValueOnce({ schema: 1, ok: true, defaultHostId: "default", hosts: [host] });
    await expect(store.catalog(true)).resolves.toMatchObject({ ok: true });
  });
  it("shares one completion-paced timer and stops after the last view leaves", async () => {
    vi.useFakeTimers(); backend.call.mockResolvedValue({ schema: 1, state: "streaming", updatedAt: 1 });
    const store = new PyrolightIntegration();
    const stops = Array.from({ length: 4 }, () => store.watchSession());
    await vi.advanceTimersByTimeAsync(0); expect(backend.call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(6000); expect(backend.call).toHaveBeenCalledTimes(4);
    stops.slice(0, 3).forEach((stop) => stop());
    await vi.advanceTimersByTimeAsync(2000); expect(backend.call).toHaveBeenCalledTimes(5);
    stops[3](); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6000); expect(backend.call).toHaveBeenCalledTimes(5);
  });
  it("does not queue requests or restart a stopped poll while the backend is slow", async () => {
    vi.useFakeTimers(); let finish!: (value: any) => void;
    backend.call.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const store = new PyrolightIntegration(); const stop = store.watchSession();
    await vi.advanceTimersByTimeAsync(10000); expect(backend.call).toHaveBeenCalledTimes(1);
    stop(); finish({ schema: 1, state: "disconnected" });
    await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces settings refreshes and keeps settings snapshots stable across session updates", async () => {
    backend.call.mockImplementation(async (name: string) => name === "pyrolight_settings" ? structuredClone(prefs) : { schema: 1, state: "streaming", updatedAt: 1 });
    const store = new PyrolightIntegration(); await Promise.all([store.refresh(), store.refresh()]);
    expect(backend.call.mock.calls.map(([name]) => name).sort()).toEqual(["pyrolight_settings", "session_status"]);
    const settings = store.getSettingsSnapshot();
    backend.call.mockResolvedValue({ schema: 1, state: "disconnected", updatedAt: 2 }); await store.refreshSession();
    expect(store.getSettingsSnapshot()).toBe(settings);
    expect(store.getSnapshot().session.state).toBe("disconnected");
    store.stage("fps", 90); expect(store.getSettingsSnapshot()).not.toBe(settings);
  });
  it("coalesces concurrent session requests and does not notify for unchanged observations", async () => {
    let finish!: (value: any) => void;
    backend.call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const store = new PyrolightIntegration(); const changed = vi.fn(); store.subscribe(changed);
    const pending = Array.from({ length: 4 }, () => store.refreshSession());
    expect(backend.call).toHaveBeenCalledTimes(1);
    finish({ schema: 1, state: "streaming", updatedAt: 10, observedAt: 10 }); await Promise.all(pending);
    const snapshot = store.getSnapshot(); changed.mockClear();
    backend.call.mockResolvedValue({ schema: 1, state: "streaming", updatedAt: 10, observedAt: 11 });
    await store.refreshSession();
    expect(store.getSnapshot()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
    // An observation made before the one already shown is stale, whatever its wall-clock time.
    backend.call.mockResolvedValue({ schema: 1, state: "failed", updatedAt: 99, observedAt: 10.5 });
    await store.refreshSession(); expect(store.getSnapshot()).toBe(snapshot);
    backend.call.mockResolvedValue({ schema: 1, state: "disconnected", updatedAt: 12, observedAt: 12 });
    await store.refreshSession(); expect(changed).toHaveBeenCalledOnce();
  });
  it("does not start duplicate forced catalog requests while one is pending", async () => {
    let finish!: (value: any) => void;
    backend.call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const store = new PyrolightIntegration(); const pending = [store.catalog(true), store.catalog(true)];
    expect(backend.call).toHaveBeenCalledTimes(1);
    finish({ schema: 1, ok: true, defaultHostId: "default", hosts: [host] }); await Promise.all(pending);
  });
  it("reuses an expired catalog while streaming but honors explicit refresh and refreshes after disconnect", async () => {
    vi.useFakeTimers();
    const catalog = { schema: 1, ok: true, defaultHostId: "default", hosts: [host] };
    backend.call.mockImplementation(async (name: string) => name === "remote_catalog" ? catalog : { schema: 1, state: "streaming", runnerActive: true });
    const store = new PyrolightIntegration(); await store.catalog(); await store.refreshSession();
    backend.call.mockClear(); await vi.advanceTimersByTimeAsync(60000);
    expect(await store.catalog()).toBe(catalog);
    expect(await store.catalog(false, true)).toBe(catalog);
    expect(backend.call).not.toHaveBeenCalled();
    await store.catalog(true); expect(backend.call).toHaveBeenCalledWith("remote_catalog", true);
    backend.call.mockResolvedValueOnce({ schema: 1, state: "disconnected", runnerActive: false }); await store.refreshSession();
    backend.call.mockClear(); await vi.advanceTimersByTimeAsync(31000);
    await store.catalog(); expect(backend.call).toHaveBeenCalledWith("remote_catalog", false);
  });
});
describe("host and application identity", () => {
  it("uses exact Steam IDs and refuses ambiguous identity claims", () => {
    const catalog = { schema: 1, ok: true as const, defaultHostId: "default", hosts: [host, { ...host, id: "ambiguous", apps: [app, { ...app, id: 43 }] }, { ...host, id: "offline", status: "unreachable" }] };
    expect(eligibleHosts(catalog, 620).map((entry) => entry.id)).toEqual(["default"]);
    expect(eligibleHosts(catalog, 62)).toEqual([]);
  });
  it("does not silently select an alternative even when only one exists", () => {
    expect(preferredHost([host], "default")).toBe("default");
    expect(preferredHost([host], "other")).toBeNull();
  });
  it("keeps non-Steam applications and provides safe artwork identities", () => {
    const shortcut = { ...app, sources: ["steam:17375808096043008000"] };
    expect(steamSourceId(shortcut)).toBeNull();
    expect(steamArtwork(shortcut)).toBeUndefined();
    expect(appKind({ ...app, sources: ["lutris:quake"] })).toBe("lutris");
    expect(appKind({ ...app, sources: [] })).toBe("other");
    expect(steamArtwork(app)).toContain("/620/");
    expect(steamArtwork({ ...app, sources: ["steam:../../x"] })).toBeUndefined();
  });
});
describe("settings drafts", () => {
  async function ready() {
    backend.call.mockImplementation(async (method: string) => method === "pyrolight_settings" ? structuredClone(prefs) : { schema: 1, state: "streaming" });
    const store = new PyrolightIntegration();
    await store.refresh();
    backend.call.mockClear();
    return store;
  }
  it("stages without touching the backend or reconnecting and retains the draft across refresh", async () => {
    const store = await ready();
    store.stage("fps", 90);
    expect(backend.call).not.toHaveBeenCalled();
    await store.refresh();
    expect(store.getSnapshot().pending).toEqual({ fps: 90 });
    expect(store.getSnapshot().preferences?.values.fps).toBe(60);
  });
  it("only applies and reconnects on explicit action", async () => {
    const store = await ready();
    store.stage("fps", 90);
    backend.call.mockImplementation(async (method: string) => method === "apply_pyrolight_settings" ? { ok: true, preferences: { ...prefs, revision: "two", values: { fps: 90 } } } : { state: "streaming" });
    await store.apply(true);
    expect(backend.call).toHaveBeenCalledWith("apply_pyrolight_settings", { schema: 1, operation: "patch", revision: "one", values: { fps: 90 } }, true);
    expect(store.getSnapshot().pending).toEqual({});
  });
  it("retains a failed reconnect draft and tracks persisted revision for retry", async () => {
    const store = await ready();
    store.stage("fps", 90);
    backend.call.mockResolvedValue({ ok: false, preferences: { ...prefs, revision: "two" }, error: { message: "Reconnect failed" } });
    await store.apply(true);
    expect(store.getSnapshot().pending).toEqual({ fps: 90 });
    expect(store.getSnapshot().preferences?.revision).toBe("two");
    expect(store.getSnapshot().error).toContain("Reconnect failed");
  });
  it("rejects stale refresh without rebasing or losing the draft", async () => {
    const store = await ready();
    store.stage("fps", 90);
    backend.call.mockResolvedValue({ ...prefs, revision: "newer" });
    await store.refresh();
    expect(store.getSnapshot().preferences?.revision).toBe("one");
    expect(store.getSnapshot().pending).toEqual({ fps: 90 });
    expect(store.getSnapshot().error).toContain("changed elsewhere");
  });
  it("stages restore defaults without persisting or reconnecting", async () => {
    const store = await ready();
    backend.call.mockResolvedValue({ ...prefs, profileDefaults: { fps: 120 } });
    await store.profile("restore");
    expect(backend.call.mock.calls[0][1].operation).toBe("defaults");
    expect(store.getSnapshot().pending).toEqual({ fps: 120 });
    expect(backend.call).toHaveBeenCalledTimes(1);
  });
  it("blocks profile changes while a draft is pending", async () => {
    const store = await ready();
    store.stage("fps", 90);
    await store.activate("other");
    await store.profile("delete");
    expect(backend.call).not.toHaveBeenCalled();
  });
});

describe("browser Steam source identity", () => {
  it("accepts one exact Steam source, independent of the game title", () => {
    expect(steamSourceId({ ...app, name: "Duplicate title", sources: ["steam:892970"] })).toBe(892970);
    expect(steamSourceId({ ...app, sources: ["steam:620", "steam:620"] })).toBe(620);
  });
  it("refuses ambiguous, malformed and non-Steam source claims", () => {
    for (const sources of [[], ["lutris:valheim"], ["steam:620", "steam:892970"], ["steam:0"], ["steam:2147483648"], ["steam:../../892970"]]) {
      expect(steamSourceId({ ...app, sources })).toBeNull();
    }
  });
});

describe("validated offline identities", () => {
  it("retains only a validated, retained host with an unambiguous identity", () => {
    const offline = { ...host, status: "unreachable", validated: true, cached: true, canWake: true };
    const catalog = { schema: 1, ok: true as const, defaultHostId: "default", hosts: [offline] };
    expect(eligibleHosts(catalog, 620)).toEqual([offline]);
    // A host busy right after a stream, without Wake-on-LAN, keeps its games.
    for (const change of [{ canWake: false }, { status: "failed", canWake: false }]) {
      const retained = { ...offline, ...change };
      expect(eligibleHosts({ ...catalog, hosts: [retained] }, 620)).toEqual([retained]);
    }
    expect(unansweredHostMessage({ ...offline, canWake: false })).toContain("did not answer");
    expect(unansweredHostMessage(offline)).toContain("Wake-on-LAN");
    for (const change of [{ validated: false }, { cached: false }, { status: "not_paired", cached: false }, { apps: [{ ...app, sources: ["steam:620", "steam:892970"] }] }, { apps: [] }]) {
      expect(eligibleHosts({ ...catalog, hosts: [{ ...offline, ...change }] }, 620)).toEqual([]);
    }
  });
  it("refreshes session state even if the preferences API is unavailable", async () => {
    backend.call.mockImplementation(async (name: string) => {
      if (name === "pyrolight_settings") throw new Error("missing preferences");
      return { schema: 1, state: "disconnected", updatedAt: 1 };
    });
    const store = new PyrolightIntegration(); await store.refresh();
    expect(store.getSnapshot().session.state).toBe("disconnected");
  });
});

describe("session observation order", () => {
  it("accepts a newer generation after wall-clock rollback", async () => {
    const store = new PyrolightIntegration();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "streaming", runnerActive: true, generation: "old", updatedAt: 100, observedAt: 10 });
    await store.refreshSession();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "failed", runnerActive: false, generation: "new", updatedAt: 90, observedAt: 11 });
    await store.refreshSession();
    expect(store.getSnapshot().session.state).toBe("failed");
  });
  it("accepts missing state after an earlier session", async () => {
    const store = new PyrolightIntegration();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "streaming", runnerActive: true, generation: "old", updatedAt: 100, observedAt: 10 });
    await store.refreshSession();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "none", runnerActive: false, observedAt: 11 });
    await store.refreshSession();
    expect(store.getSnapshot().session.state).toBe("none");
  });
  it("still accepts observations from a backend without observation times", async () => {
    const store = new PyrolightIntegration();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "streaming", runnerActive: true, generation: "old", updatedAt: 100 });
    await store.refreshSession();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "none", runnerActive: false });
    await store.refreshSession();
    expect(store.getSnapshot().session.state).toBe("none");
  });
  it("never lets an older observation restore an ended stream", async () => {
    const store = new PyrolightIntegration();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "none", runnerActive: false, observedAt: 20 });
    await store.refreshSession();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "streaming", runnerActive: true, generation: "old", updatedAt: 200, observedAt: 19 });
    await store.refreshSession();
    expect(store.getSnapshot().session.state).toBe("none");
  });
  it("does not re-render when only observation times change", async () => {
    const store = new PyrolightIntegration();
    backend.call.mockResolvedValueOnce({ schema: 1, state: "streaming", runnerActive: true, generation: "g", updatedAt: 1, observedAt: 1 });
    await store.refreshSession();
    const snapshot = store.getSnapshot().session;
    backend.call.mockResolvedValueOnce({ schema: 1, state: "streaming", runnerActive: true, generation: "g", updatedAt: 1, observedAt: 2 });
    await store.refreshSession();
    expect(store.getSnapshot().session).toBe(snapshot);
  });
});
