import { beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@decky/api", () => backend);
import { PyrolightIntegration, appKind, eligibleHosts, preferredHost, steamArtwork } from "../../src/lib/pyrolightintegration";

const prefs = { schema: 1, ok: true, revision: "one", activeProfileId: "default", activeProfileName: "Default", profiles: [{ id: "default", name: "Default" }], values: { fps: 60, enableHdr: false }, registry: [{ key: "fps", type: "integer", category: "Video & Display", scope: "profile", application: "reconnect" }], capabilities: { liveUpdates: false } };
const app = { id: 42, name: "A game", sources: ["steam:620"], hdr_supported: false };
const host = { id: "default", name: "Default PC", status: "paired", apps: [app] };

beforeEach(() => backend.call.mockReset());
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
