// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const data = vi.hoisted(() => ({ defaultHost: "host-a", session: { schema: 1, state: "none" } as any, active: null as any, launch: vi.fn(), end: vi.fn(), menu: null as any, modal: null as any, hide: vi.fn() }));
vi.mock("@decky/api", () => ({ call: vi.fn(), toaster: { toast: vi.fn() } }));
vi.mock("@decky/ui", () => ({
  Button: ({ children, noFocusRing, focusable, onOKActionDescription, ...props }: any) => <button data-focus-ring={!noFocusRing} data-navigable={focusable} data-ok-label={onOKActionDescription} {...props}>{children}</button>,
  Focusable: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  playSectionClasses: { MenuButton: "native-steam-menu-button" },
  Menu: () => null,
  MenuItem: () => null,
  MenuSeparator: () => null,
  ConfirmModal: () => null,
  showContextMenu: vi.fn((menu: any) => { data.menu = menu; return { Hide: data.hide }; }),
  showModal: vi.fn((modal: any, parent: Window) => {
    // Steam keys its modal manager by Window and reads parent.document.title.
    if (!parent?.document || parent.window !== parent) throw Error("A Steam modal requires its owning window");
    data.modal = modal;
  })
}));
vi.mock("../../src/contexts", async () => ({ MoonDeckContext: (await import("react")).createContext({ moonDeckAppLauncher: { launchApp: data.launch, endHostGame: data.end } }) }));
vi.mock("../../src/hooks", () => ({ useCurrentSettings: () => ({ currentHostId: data.defaultHost }), useMoonDeckAppData: () => data.active }));
vi.mock("../../src/hooks/usepyrolight", () => ({ usePyrolightSession: () => data.session, useSessionPolling: vi.fn() }));
import { MoonDeckLaunchButtonAnchor } from "../../src/components/moondecklaunchbutton/moondecklaunchbutton";
import { pyrolightIntegration } from "../../src/lib/pyrolightintegration";
import { showContextMenu, showModal } from "@decky/ui";
const app = { id: 42, name: "Valheim", sources: ["steam:892970"], hdr_supported: false };
const hostA = { id: "host-a", name: "PC A", status: "paired", apps: [app] };
const hostB = { ...hostA, id: "host-b", name: "PC B" };
const catalog = { schema: 1, ok: true as const, defaultHostId: "host-a", hosts: [hostA, hostB] };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = async (appId = 892970) => { await act(async () => root.render(<MoonDeckLaunchButtonAnchor appId={appId} appName={appId === 892970 ? "Valheim" : "Portal"} appType={1} />)); };
const press = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find((value) => value.textContent === text)!;
  expect(button).toBeDefined(); await act(async () => button.click());
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  data.session = { schema: 1, state: "none" }; data.active = null; data.defaultHost = "host-a";
  data.menu = null; data.modal = null; data.hide.mockReset(); vi.mocked(showContextMenu).mockClear(); vi.mocked(showModal).mockClear();
  data.launch.mockReset().mockResolvedValue(undefined); data.end.mockReset().mockResolvedValue(undefined);
  vi.spyOn(pyrolightIntegration, "catalog").mockResolvedValue(catalog);
  vi.spyOn(pyrolightIntegration, "refreshSession").mockResolvedValue();
  const snapshot = pyrolightIntegration.getSnapshot();
  vi.spyOn(pyrolightIntegration, "getSnapshot").mockImplementation(() => ({ ...snapshot, session: data.session }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("native Library stream controls", () => {
  const retained = () => { data.session = { schema: 1, state: "disconnected", runnerActive: false, generation: "retained", steamAppId: 892970, hostId: "host-a", remoteAppId: 42 }; };
  const openOptions = async () => {
    const arrow = container.querySelector('[aria-label="Stream options"]') as HTMLButtonElement;
    expect(arrow).not.toBeNull(); expect(arrow.disabled).toBe(false);
    await act(async () => arrow.click()); return arrow;
  };
  const chooseEnd = async () => { await act(async () => data.menu.props.children.find((item: any) => item.key === "end-session").props.onSelected()); };
  it("opens the confirmation in the Library's window when it differs from the plugin window", async () => {
    await act(async () => root.unmount()); container.remove();
    const iframe = document.body.appendChild(document.createElement("iframe"));
    container = iframe.contentDocument!.body.appendChild(iframe.contentDocument!.createElement("div"));
    root = createRoot(container);
    try {
      retained(); await render(); await openOptions(); await chooseEnd();
      expect(showModal).toHaveBeenCalledWith(data.modal, iframe.contentWindow);
      expect(data.end).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount()); iframe.remove();
      container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
    }
  });
  it("offers End Remote Game for one host, requires confirmation, and refreshes the ended session", async () => {
    retained(); vi.mocked(pyrolightIntegration.catalog).mockResolvedValue({ ...catalog, hosts: [hostA] });
    await render(); expect(container.querySelector("button")?.textContent).toBe("Resume Stream");
    const arrow = await openOptions(); await chooseEnd();
    expect(showModal).toHaveBeenCalledWith(data.modal, arrow.ownerDocument.defaultView); expect(data.end).not.toHaveBeenCalled();
    data.end.mockImplementationOnce(async () => { data.session = { ...data.session, state: "ended" }; });
    await act(async () => data.modal.props.onConfirm());
    expect(data.end).toHaveBeenCalledWith("host-a", 42); expect(data.launch).not.toHaveBeenCalled();
    expect(pyrolightIntegration.refreshSession).toHaveBeenCalled();
    await render();
    expect(container.querySelector("button")?.textContent).toBe("Stream");
    expect(container.querySelector('[aria-label="Stream options"]')).toBeNull();
  });
  it("ends the retained original host/game even after selecting another streaming host", async () => {
    retained(); await render(); await openOptions();
    await act(async () => data.menu.props.children[1].props.onSelected());
    expect(container.querySelector("button")?.textContent).toBe("Stream");
    await openOptions(); await chooseEnd(); await act(async () => data.modal.props.onConfirm());
    expect(data.end).toHaveBeenCalledWith("host-a", 42); expect(data.defaultHost).toBe("host-a");
  });
  it("does not end a replacement session through an older confirmation", async () => {
    retained(); await render(); await openOptions(); await chooseEnd();
    data.session = { ...data.session, generation: "newer", remoteAppId: 99 };
    await act(async () => data.modal.props.onConfirm());
    expect(data.end).not.toHaveBeenCalled(); expect(container.textContent).toContain("session changed");
  });
  it("keeps ending single-flight and displays an end failure without losing retry access", async () => {
    retained(); await render(); await openOptions(); await chooseEnd();
    let fail!: (error: Error) => void;
    data.end.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { fail = reject; }));
    await act(async () => { data.modal.props.onConfirm(); data.modal.props.onConfirm(); });
    expect(data.end).toHaveBeenCalledOnce(); expect(container.querySelector("button")?.textContent).toBe("Ending game…");
    expect(container.querySelector("button")?.disabled).toBe(true);
    await act(async () => fail(Error("Host offline")));
    expect(container.textContent).toContain("Could not end remote game");
    expect(container.querySelector('[aria-label="Stream options"]')).not.toBeNull();
  });
  it("omits the end action without a retained remote application identity", async () => {
    retained(); delete data.session.remoteAppId; await render();
    expect(container.querySelector('[aria-label="Stream options"]')).toBeNull();
    await act(async () => (container.querySelector('[aria-label="Choose streaming host"]') as HTMLButtonElement).click());
    expect(data.menu.props.children.some((item: any) => item.key === "end-session")).toBe(false);
    expect(data.end).not.toHaveBeenCalled();
  });
  it("defers periodic catalog subprocesses during a stream and resumes after disconnect", async () => {
    vi.useFakeTimers(); data.session = { schema: 1, state: "streaming", runnerActive: true };
    await render(); await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(pyrolightIntegration.catalog).toHaveBeenCalledTimes(1);
    data.session = { schema: 1, state: "disconnected", runnerActive: false }; await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(pyrolightIntegration.catalog).toHaveBeenLastCalledWith(true, false);
    expect(pyrolightIntegration.catalog).toHaveBeenCalledTimes(2);
  });
  it("requests cached availability when navigating to a new game during an active launch", async () => {
    data.active = { steamAppId: 892970 };
    await render(); await render(620);
    expect(pyrolightIntegration.catalog).toHaveBeenLastCalledWith(false, true);
  });
  it("launches the default with one action and an alternative without changing settings", async () => {
    await render(); expect(data.menu).toBeNull();
    await press("Stream"); expect(data.launch.mock.calls[0][4]).toEqual({ hostId: "host-a", remoteAppId: 42 });
    const chooser = container.querySelector('[aria-label="Choose streaming host"]') as HTMLButtonElement;
    await act(async () => chooser.click());
    expect(showContextMenu).toHaveBeenCalledWith(data.menu, chooser, expect.objectContaining({ bPreferPopTop: true }));
    expect(data.menu.props.label).toBe("Stream from");
    expect(data.menu.props.children[0].props.selected).toBe(true);
    await act(async () => data.menu.props.children[1].props.onSelected());
    await press("Stream"); expect(data.launch.mock.calls[1][4]).toEqual({ hostId: "host-b", remoteAppId: 42 });
    expect(data.defaultHost).toBe("host-a");
  });
  it("hides empty, ambiguous and unavailable games", async () => {
    for (const apps of [[], [{ ...app, sources: ["steam:620"] }], [app, { ...app, id: 43 }], [{ ...app, sources: ["steam:620", "steam:892970"] }]]) {
      vi.mocked(pyrolightIntegration.catalog).mockResolvedValue({ ...catalog, hosts: [{ ...hostA, apps }] });
      await render(620); await render(); expect(container.querySelector("button")).toBeNull();
    }
  });
  it("offers a previously validated offline game for waking", async () => {
    vi.mocked(pyrolightIntegration.catalog).mockResolvedValue({ ...catalog, hosts: [{ ...hostA, status: "unreachable", cached: true, validated: true, canWake: true }] });
    await render(); expect(container.textContent).toContain("Wake-on-LAN"); await press("Stream"); expect(data.launch).toHaveBeenCalledOnce();
  });
  it("resumes on the original host even when the configured default changes", async () => {
    data.defaultHost = "host-b";
    data.session = { state: "disconnected", steamAppId: 892970, hostId: "host-a", remoteAppId: 42 };
    await render(); await press("Resume Stream"); expect(data.launch.mock.calls[0][4].hostId).toBe("host-a");
  });
  it("disables duplicate launches for active sessions and reports waking progress", async () => {
    data.session = { state: "waking", steamAppId: 892970, hostId: "host-a", runnerActive: true };
    await render(); const action = container.querySelector("button")!;
    expect(action.textContent).toBe("Waking host…"); expect(action.disabled).toBe(true);
    await press("Waking host…"); expect(data.launch).not.toHaveBeenCalled();
  });
  it("reports launch failures and enables explicit retry", async () => {
    data.launch.mockRejectedValueOnce(Error("helper unavailable"));
    await render(); await press("Stream"); expect(container.textContent).toContain("helper unavailable");
    await press("Retry Stream"); expect(data.launch).toHaveBeenCalledTimes(2);
  });
  it("discards a late catalog from the previous game and cleans all polling timers", async () => {
    let finish!: (value: typeof catalog) => void;
    vi.mocked(pyrolightIntegration.catalog).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await render(); await render(620);
    await act(async () => finish(catalog)); expect(container.querySelector("button")).toBeNull();
  });
  it("uses Steam's Library button classes, focus ring and native activation contract", async () => {
    await render(); const button = container.querySelector("button")!;
    expect(button.className).toContain("native-steam-menu-button");
    expect(button.dataset.focusRing).toBe("true");
    expect(button.dataset.navigable).toBe("true");
    expect(button.dataset.okLabel).toBe("Stream");
    expect(container.querySelector('[role="group"]')?.getAttribute("flow-children")).toBe("row");
    expect(container.querySelector(".pyrodeck-stream-actions-floating")).toBeNull();
  });
  it("keeps the host menu navigable when the configured default is unavailable", async () => {
    data.defaultHost = "missing"; await render();
    expect(container.querySelector("button")?.disabled).toBe(true);
    const chooser = container.querySelector('[aria-label="Choose streaming host"]') as HTMLButtonElement;
    expect(chooser.disabled).toBe(false); await act(async () => chooser.click());
    await act(async () => data.menu.props.children[0].props.onSelected());
    await press("Stream"); expect(data.launch.mock.calls[0][4].hostId).toBe("host-a");
  });
  it("closes an open native host menu when leaving the game page", async () => {
    await render(); await act(async () => (container.querySelector('[aria-label="Choose streaming host"]') as HTMLButtonElement).click());
    await render(620); expect(data.hide).toHaveBeenCalledOnce();
  });
});
