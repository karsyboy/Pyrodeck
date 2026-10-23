// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  add: vi.fn(), launch: vi.fn(), catalog: vi.fn(), menu: null as any, anchor: null as EventTarget | null, hide: vi.fn(),
  showMenu: vi.fn(),
  shortcuts: [] as any[],
  host: { id: "host-a", name: "PC", status: "paired", validated: true, apps: [] as any[] }
}));
vi.mock("@decky/api", () => ({ call: async () => ({}) }));
vi.mock("@decky/ui", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    DialogButton: ({ children, onOKActionDescription, ...props }: any) => <button {...props}>{children}</button>,
    Focusable: ({ children, onSecondaryButton, onSecondaryActionDescription, "flow-children": flow, ...props }: any) => {
      const ref = useRef<HTMLDivElement>(null);
      useEffect(() => {
        const element = ref.current!;
        if (!onSecondaryButton) return;
        element.addEventListener("vgp_onsecondaryaction", onSecondaryButton);
        return () => element.removeEventListener("vgp_onsecondaryaction", onSecondaryButton);
      }, [onSecondaryButton]);
      return <div ref={ref} {...props}>{children}</div>;
    },
    PanelSection: ({ children }: any) => <section>{children}</section>,
    PanelSectionRow: ({ children }: any) => <div>{children}</div>,
    Field: ({ label, description }: any) => <div>{label}{description}</div>,
    TextField: ({ label, value, onChange }: any) => <input aria-label={label} value={value} onChange={onChange} />,
    DropdownItem: () => null,
    Menu: ({ label, children }: any) => <div role="menu" aria-label={label}>{children}</div>,
    MenuItem: ({ children, disabled, onSelected }: any) => <button role="menuitem" disabled={disabled} onClick={onSelected}>{children}</button>,
    showContextMenu: (content: any, anchor: EventTarget) => {
      fake.menu = content; fake.anchor = anchor; fake.showMenu(content, anchor);
      return { Hide: fake.hide };
    }
  };
});
vi.mock("../../src/contexts", async () => {
  const { createContext } = await import("react");
  return { MoonDeckContext: createContext({ externalAppShortcuts: { addRemoteShortcut: fake.add }, moonDeckAppLauncher: { launchRemote: fake.launch } }) };
});
vi.mock("../../src/hooks/usegamestreamappshortcuts", () => ({ useRemoteAppShortcuts: () => fake.shortcuts }));
vi.mock("../../src/hooks/useappsyncstate", () => ({ useAppSyncState: () => ({ syncing: false }) }));
vi.mock("../../src/hooks/usepyrolight", async () => ({
  PyrolightViewVisibility: (await import("react")).createContext(true),
  usePyrolightSession: () => ({ state: "none" }), useSessionPolling: () => {}
}));
vi.mock("../../src/lib/pyrolightintegration", () => ({
  pyrolightIntegration: { catalog: fake.catalog, refreshSession: vi.fn() },
  steamArtwork: () => undefined, steamSourceId: () => null, appKind: () => "other"
}));
import { RemoteGames } from "../../src/components/remotegames/remotegames";
import { PyrolightViewVisibility } from "../../src/hooks/usepyrolight";
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
let popup: HTMLDivElement; let menuRoot: ReturnType<typeof createRoot>;
const actions = (name = "Steam") => container.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!;
const item = () => popup.querySelector<HTMLButtonElement>("[role=menuitem]")!;
const openActions = async (name = "Steam") => {
  await act(async () => { actions(name).click(); menuRoot.render(fake.menu); });
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); fake.shortcuts = []; fake.host.validated = true;
  fake.menu = null; fake.anchor = null;
  fake.host.apps = [{ id: 42, name: "Steam", sources: [], hdr_supported: false }];
  fake.catalog.mockImplementation(async () => ({ schema: 1, ok: true, defaultHostId: "host-a", hosts: [fake.host] }));
  fake.add.mockResolvedValue(77);
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
  popup = document.body.appendChild(document.createElement("div")); menuRoot = createRoot(popup);
  fake.hide.mockImplementation(() => { fake.menu = null; menuRoot.render(null); });
});
afterEach(async () => { await act(async () => { root.unmount(); menuRoot.unmount(); }); container.remove(); popup.remove(); });

describe("Remote Games action menu", () => {
  it("keeps the library action out of the game row and adds from its anchored menu", async () => {
    await act(async () => root.render(<RemoteGames />));
    expect(container.textContent).not.toContain("Add to Steam Library");
    expect(actions().textContent).toBe("");
    const anchor = actions();
    await openActions();
    expect(fake.anchor).toBe(anchor);
    expect(popup.querySelector("[role=menu]")?.getAttribute("aria-label")).toBe("Steam");
    expect(item().textContent).toBe("Add to Steam Library");
    await act(async () => item().click());
    expect(fake.add).toHaveBeenCalledWith("host-a", fake.host.apps[0]);
    expect(fake.launch).not.toHaveBeenCalled();
    expect(fake.hide).toHaveBeenCalled();
    expect(container.textContent).toContain("Steam added to your Steam Library.");
  });
  it("keeps the native menu open when its popup deactivates Quick Access", async () => {
    const view = (visible: boolean) => <PyrolightViewVisibility.Provider value={visible}><RemoteGames /></PyrolightViewVisibility.Provider>;
    await act(async () => root.render(view(true)));
    // Steam can report Quick Access as inactive while a native popup owns
    // focus. The retained Remote Games view must not dismiss that popup.
    fake.showMenu.mockImplementationOnce(() => root.render(view(false)));
    await openActions();
    expect(fake.hide).not.toHaveBeenCalled();
    expect(item()?.textContent).toBe("Add to Steam Library");
    await act(async () => item().click());
    expect(fake.add).toHaveBeenCalledWith("host-a", fake.host.apps[0]);
    expect(fake.launch).not.toHaveBeenCalled();
    await act(async () => root.render(view(true)));
    expect(container.textContent).toContain("Steam added to your Steam Library.");
  });
  it("shows saved entries in the menu and surfaces failed additions without leaving it open", async () => {
    fake.shortcuts = [{ hostId: "host-a", remoteAppId: 42 }];
    await act(async () => root.render(<RemoteGames />));
    await openActions();
    expect(item().textContent).toBe("In Steam Library");
    expect(item().disabled).toBe(true);
    fake.shortcuts = []; fake.add.mockRejectedValueOnce(Error("Steam could not save the shortcut"));
    await act(async () => root.render(<RemoteGames />));
    await openActions();
    await act(async () => item().click());
    expect(container.textContent).toContain("Steam could not save the shortcut");
    expect(popup.querySelector("[role=menu]")).toBeNull();
    expect(actions().disabled).toBe(false);
  });
  it("opens the same menu from a controller secondary action on the focused game", async () => {
    await act(async () => root.render(<RemoteGames />));
    const row = container.querySelector('[role="group"][aria-label="Steam"]')!;
    await act(async () => {
      row.querySelector("button")!.dispatchEvent(new CustomEvent("vgp_onsecondaryaction", { bubbles: true, cancelable: true, detail: { button: 3, source: 0 } }));
      menuRoot.render(fake.menu);
    });
    expect(fake.anchor).toBe(row);
    expect(item().textContent).toBe("Add to Steam Library");
  });
  it("closes menus when their page disappears and keeps pagination targets correct", async () => {
    fake.host.apps.push(...Array.from({ length: 8 }, (_, i) => ({ id: i + 100, name: `Other ${i}`, sources: [] })));
    await act(async () => root.render(<RemoteGames />));
    expect(container.querySelectorAll('button[aria-label^="Actions for"]')).toHaveLength(8);
    await openActions("Other 0");
    const next = [...container.querySelectorAll("button")].find((button) => button.textContent === "Next")!;
    await act(async () => next.click());
    expect(popup.querySelector("[role=menu]")).toBeNull();
    expect(container.querySelectorAll('button[aria-label^="Actions for"]')).toHaveLength(1);
    await openActions();
    await act(async () => item().click());
    expect(fake.add).toHaveBeenCalledWith("host-a", expect.objectContaining({ id: 42, name: "Steam" }));
    await openActions();
    await act(async () => root.render(null));
    expect(popup.querySelector("[role=menu]")).toBeNull();
  });
});
