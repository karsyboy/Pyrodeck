// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@decky/api", () => ({ ...backend, toaster: { toast: vi.fn() } }));
vi.mock("@decky/ui", () => ({
  DialogButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Field: ({ label, description, children }: any) => <div><span>{label}</span><span>{description}</span>{children}</div>,
  PanelSection: ({ title, children }: any) => <section><h2>{title}</h2>{children}</section>,
  PanelSectionRow: ({ children }: any) => <div>{children}</div>,
  DialogControlsSection: ({ children }: any) => <section>{children}</section>,
  DialogControlsSectionHeader: ({ children }: any) => <h2>{children}</h2>,
  ToggleField: () => null
}));
vi.mock("../../src/contexts", async () => ({ MoonDeckContext: (await import("react")).createContext(null) }));
import { PyrolightInstallPanel } from "../../src/components/quicksettingsview/pyrolightinstallpanel";

const settings = { useMoonlightExec: false, moonlightExecPath: "", pyrolightPrereleases: true } as any;
const release = { tag: "v6.2.8-prerelease", prerelease: true, asset: { name: "pyrolight-v6.2.8-prerelease-linux-x86_64.AppImage" } };
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const answer = (executable: string | null) => backend.call.mockImplementation(async (name: string) =>
  name === "check_pyrolight_release" ? { ok: true, release, updateAvailable: true } :
  name === "install_pyrolight" ? { ok: true } :
  { ok: true, executable, onPath: null, installPath: "/home/deck/Applications/Pyrolight.AppImage", installed: null, progress: { state: "idle" } });
const render = async () => { await act(async () => root.render(<PyrolightInstallPanel settings={settings} />)); await act(async () => {}); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  backend.call.mockReset();
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Quick Access Pyrolight install", () => {
  it("offers the selected channel's release while Pyrolight is missing", async () => {
    answer(null); await render();
    expect(container.textContent).toContain("Pyrolight is not installed");
    expect(container.textContent).toContain("v6.2.8-prerelease (prereleases included)");
    await act(async () => container.querySelector("button")!.click());
    expect(backend.call).toHaveBeenCalledWith("install_pyrolight", true);
  });
  it("stays out of the way once Pyrolight is found", async () => {
    answer("/usr/bin/pyrolight"); await render();
    expect(container.textContent).toBe("");
  });
});
