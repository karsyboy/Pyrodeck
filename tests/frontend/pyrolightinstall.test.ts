import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@decky/api", () => ({ ...backend, toaster: { toast: vi.fn() } }));
vi.mock("@decky/ui", () => ({}));
vi.mock("../../src/contexts", () => ({ MoonDeckContext: null }));
vi.mock("../../src/hooks/usepyrolightinstall", () => ({ usePyrolightInstall: vi.fn() }));
import { InstallState, InstallStatus, PyrolightInstallStore, installMode, progressText } from "../../src/lib/pyrolightinstall";
import { installAction } from "../../src/components/updatesview/pyrolightinstallsection";

const managed = { path: "/home/deck/Applications/Pyrolight.AppImage", tag: "v6.2.7", prerelease: false, installedAt: 1 };
const status = (values: Partial<InstallStatus> = {}): InstallStatus => ({
  executable: null, onPath: null, installPath: managed.path, installed: null, progress: { state: "idle" }, ...values
});
const state = (values: Partial<InstallState> = {}): InstallState => ({
  status: status(), release: { tag: "v6.2.8", prerelease: false, asset: { name: "pyrolight-v6.2.8-linux-x86_64.AppImage" } },
  releaseChannel: false, updateAvailable: false, checking: false, error: null, ...values
});

describe("Pyrolight installation modes", () => {
  it("only manages a missing Pyrolight or its own AppImage, never a package or a selected file", () => {
    expect(installMode(status(), false)).toBe("missing");
    expect(installMode(status({ executable: managed.path, installed: managed }), false)).toBe("managed");
    expect(installMode(status({ executable: "/usr/bin/pyrolight", onPath: "/usr/bin/pyrolight", installed: managed }), false)).toBe("package");
    expect(installMode(status({ executable: "/home/deck/Downloads/Pyrolight-6.2.6.AppImage" }), false)).toBe("appimage");
    expect(installMode(status({ executable: "/opt/pyrolight" }), true)).toBe("selected");
    expect(installAction(state(), "package")).toBeNull();
    expect(installAction(state(), "selected")).toBeNull();
  });
  it("offers Install, Update or nothing to do", () => {
    expect(installAction(state(), "missing")).toEqual({ label: "Install", enabled: true });
    expect(installAction(state({ updateAvailable: true }), "managed")).toEqual({ label: "Update", enabled: true });
    expect(installAction(state(), "managed")).toEqual({ label: "Up to date", enabled: false });
    expect(installAction(state({ release: null }), "appimage")?.enabled).toBe(false);
    expect(installAction(state({ status: status({ progress: { state: "downloading" } }) }), "missing")).toEqual({ label: "Installing…", enabled: false });
  });
  it("describes download progress", () => {
    expect(progressText({ state: "downloading", tag: "v6.2.8", received: 10485760, total: 57170424 })).toBe("Downloading v6.2.8: 10 of 55 MB");
    expect(progressText({ state: "failed", error: "checksum" })).toBe("checksum");
  });
});

describe("Pyrolight install store", () => {
  beforeEach(() => { vi.useFakeTimers(); backend.call.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("checks GitHub once per channel within the cache period", async () => {
    backend.call.mockResolvedValue({ ok: true, release: state().release, updateAvailable: true });
    const store = new PyrolightInstallStore();
    await store.check(false); await store.check(false);
    expect(backend.call).toHaveBeenCalledTimes(1);
    await store.check(true);
    expect(backend.call).toHaveBeenLastCalledWith("check_pyrolight_release", true);
    await store.check(true, true);
    expect(backend.call).toHaveBeenCalledTimes(3);
  });

  it("follows a background install and re-checks the release when it finishes", async () => {
    const progress = [{ state: "downloading", received: 1, total: 2 }, { state: "installed", tag: "v6.2.8" }];
    backend.call.mockImplementation(async (name: string) => {
      if (name === "install_pyrolight") return { ok: true };
      if (name === "check_pyrolight_release") return { ok: true, release: state().release, updateAvailable: false };
      const next = progress.length > 1 ? progress.shift()! : progress[0];
      return { ok: true, ...status({ progress: next as InstallStatus["progress"], executable: next.state === "installed" ? managed.path : null }) };
    });
    const store = new PyrolightInstallStore();
    await store.check(false);
    await store.install(false);
    expect(store.getSnapshot().status?.progress.state).toBe("downloading");
    await vi.advanceTimersByTimeAsync(500);
    expect(store.getSnapshot().status?.executable).toBe(managed.path);
    expect(backend.call.mock.calls.filter(([name]) => name === "check_pyrolight_release")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.call.mock.calls.filter(([name]) => name === "pyrolight_install_status")).toHaveLength(2);
  });

  it("shows a refused install without polling", async () => {
    backend.call.mockResolvedValue({ ok: false, error: { code: "active_stream", message: "Disconnect the stream first" } });
    const store = new PyrolightInstallStore();
    await store.install(false);
    expect(store.getSnapshot().error).toContain("Disconnect");
    expect(backend.call).toHaveBeenCalledTimes(1);
  });
});
