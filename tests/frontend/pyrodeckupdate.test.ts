import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@decky/api", () => ({ ...backend, toaster: { toast: vi.fn() } }));
import { DECKY_INSTALL_ROUTE, DECKY_INSTALL_UPDATE, PyroDeckUpdateStore } from "../../src/lib/pyrodeckupdate";

const release = {
  tag: "v0.3.0-prerelease.2", prerelease: true, sha256: "ab".repeat(32),
  asset: { name: "pyrodeck-v0.3.0-prerelease.2.zip", url: "https://github.com/karsyboy/pyrodeck/releases/download/v0.3.0-prerelease.2/pyrodeck-v0.3.0-prerelease.2.zip" }
};
const decky = { call: vi.fn() };
beforeEach(() => {
  backend.call.mockReset().mockResolvedValue({ ok: true, current: "0.3.0-prerelease.1", release, updateAvailable: true });
  decky.call.mockReset().mockResolvedValue(undefined);
  (globalThis as any).window = globalThis;
  (globalThis as any).DeckyBackend = decky;
});
afterEach(() => { delete (globalThis as any).DeckyBackend; });

describe("PyroDeck self-update", () => {
  it("hands the checked release and its SHA-256 to Decky's confirmed installer", async () => {
    const store = new PyroDeckUpdateStore();
    await store.check(true);
    expect(backend.call).toHaveBeenCalledWith("check_pyrodeck_update", true);
    await store.install();
    expect(decky.call).toHaveBeenCalledWith(DECKY_INSTALL_ROUTE, release.asset.url, "PyroDeck", "0.3.0-prerelease.2", release.sha256, DECKY_INSTALL_UPDATE);
    expect(store.getSnapshot().requested).toBe(true);
  });
  it("never asks Decky to install without a newer release", async () => {
    backend.call.mockResolvedValue({ ok: true, current: "0.3.0-prerelease.2", release, updateAvailable: false });
    const store = new PyroDeckUpdateStore();
    await store.install();
    await store.check(true); await store.install();
    expect(decky.call).not.toHaveBeenCalled();
  });
  it("caches a check per channel and reports a missing installer", async () => {
    const store = new PyroDeckUpdateStore();
    await store.check(false); await store.check(false);
    expect(backend.call).toHaveBeenCalledTimes(1);
    await store.check(true);
    expect(backend.call).toHaveBeenCalledTimes(2);
    delete (globalThis as any).DeckyBackend;
    await store.install();
    expect(store.getSnapshot().error).toContain(release.asset.url);
  });
  it("shows a failed check with the installed version", async () => {
    backend.call.mockResolvedValue({ ok: false, current: "0.3.0-prerelease.1", error: { code: "release", message: "No PyroDeck release was found." } });
    const store = new PyroDeckUpdateStore();
    await store.check(false);
    expect(store.getSnapshot()).toMatchObject({ current: "0.3.0-prerelease.1", updateAvailable: false, error: "No PyroDeck release was found." });
  });
});
