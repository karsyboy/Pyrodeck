// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
const current = vi.hoisted(() => ({ settings: null as any, host: null as any }));
vi.mock("@decky/api", () => ({ ...backend, toaster: { toast: vi.fn() }, openFilePicker: vi.fn(), FileSelectionType: { FILE: 0 } }));
vi.mock("@decky/ui", () => {
  const Box = ({ label, description, children }: any) => <div><span>{label}</span><span>{description}</span>{children}</div>;
  return {
    ConfirmModal: () => null,
    DialogBody: ({ children }: any) => <div>{children}</div>,
    DialogButton: ({ children, focusable: _focusable, ...props }: any) => <button {...props}>{children}</button>,
    DialogControlsSection: ({ children }: any) => <section>{children}</section>,
    DialogControlsSectionHeader: ({ children }: any) => <h2>{children}</h2>,
    Dropdown: () => null,
    Field: Box,
    Focusable: ({ children }: any) => <div>{children}</div>,
    Menu: () => null,
    MenuItem: () => null,
    ModalRoot: () => null,
    Spinner: () => null,
    TextField: () => null,
    ToggleField: ({ label, description }: any) => <div><span>{label}</span><span>{description}</span></div>,
    showContextMenu: vi.fn(),
    showModal: vi.fn(),
    sleep: vi.fn()
  };
});
vi.mock("../../src/contexts", async () => ({ MoonDeckContext: (await import("react")).createContext({ settingsManager: {} }) }));
vi.mock("../../src/hooks", async (original) => ({
  ...(await original<object>()),
  useCurrentSettings: () => current.settings,
  useCurrentHostSettings: () => current.host,
  useServerStatus: () => ["Online", false]
}));
import { HostSelectionView } from "../../src/components/hostselectionview";
import { RunnerSettingsView } from "../../src/components/runnersettingsview";

const settings = { currentHostId: "host", hostSettings: {}, useMoonlightExec: false, moonlightExecPath: "", pythonExecPath: "", runnerDebugLogs: false, pyrolightPrereleases: false } as any;
const host = { currentHostId: "host", address: "10.0.0.2", hostInfoPort: 47989, hostName: "Host", runnerTimeouts: { servicePing: 5, wakeOnLan: 60, steamLaunch: 5 },
  resolution: { appResolutionOverride: "Native", appResolutionOverrideForInternalDisplay: false } } as any;
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const render = async (node: JSX.Element) => { await act(async () => root.render(node)); await act(async () => {}); };
const headers = () => [...container.querySelectorAll("h2")].map((header) => header.textContent);
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  backend.call.mockReset().mockResolvedValue({ ok: true, executable: null, onPath: null, installPath: "/home/deck/Applications/Pyrolight.AppImage", installed: null, progress: { state: "idle" } });
  current.settings = settings; current.host = host;
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("settings pages", () => {
  it("keeps Hosts & Pairing to the host and its pairing", async () => {
    await render(<HostSelectionView />);
    expect(headers()).toEqual(["Host", "Pairing"]);
    expect(container.textContent).not.toContain("Use a specific Pyrolight executable");
    expect(container.textContent).not.toContain("Include prereleases");
    // A missing Pyrolight points at where it is installed now.
    expect(container.textContent).toContain("Install it from Updates");
  });

  it("offers the Pyrolight executable in Launcher & executables without a host", async () => {
    current.host = null;
    await render(<RunnerSettingsView />);
    expect(headers()).toEqual(["Executables", "Logging", "Host"]);
    expect(container.textContent).toContain("Use a specific Pyrolight executable");
    expect(container.textContent).toContain("HOST IS NOT SELECTED");
    expect(container.textContent).not.toContain("Timeouts");
  });

  it("adds the host's launcher settings once a host is selected", async () => {
    await render(<RunnerSettingsView />);
    expect(headers()).toEqual(["Executables", "Logging", "App Resolution Override", "Timeouts"]);
  });
});
