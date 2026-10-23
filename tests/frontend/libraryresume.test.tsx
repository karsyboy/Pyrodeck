// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { BehaviorSubject } from "rxjs";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn(), launch: vi.fn() }));
vi.mock("@decky/api", () => ({ ...backend, toaster: { toast: vi.fn() } }));
vi.mock("@decky/ui", () => ({
  Button: ({ children, noFocusRing, focusable, onOKActionDescription, ...props }: any) => <button {...props}>{children}</button>,
  Focusable: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  playSectionClasses: { MenuButton: "native-menu-button" },
  Menu: () => null, MenuItem: () => null, MenuSeparator: () => null, ConfirmModal: () => null,
  showContextMenu: vi.fn(), showModal: vi.fn()
}));
vi.mock("../../src/contexts", async () => ({ MoonDeckContext: (await import("react")).createContext(null) }));
vi.mock("../../src/hooks", async () => ({
  useCurrentSettings: () => ({ currentHostId: "host-a" }),
  useMoonDeckAppData: (await import("../../src/hooks/usemoondeckappdata")).useMoonDeckAppData
}));
import { MoonDeckContext } from "../../src/contexts";
import { MoonDeckLaunchButtonAnchor } from "../../src/components/moondecklaunchbutton/moondecklaunchbutton";
import { LibraryMount, observeLibraryMount } from "../../src/lib/librarymount";
import { SessionStatus, pyrolightIntegration } from "../../src/lib/pyrolightintegration";

const overview = { appid: 892970, display_name: "Valheim", app_type: 1 };
const localPlay = vi.fn();
const catalog = { schema: 1, ok: true, defaultHostId: "host-a", hosts: [{ id: "host-a", name: "PC", status: "paired", apps: [{ id: 42, sources: ["steam:892970"], name: "Valheim" }] }] };
function NativeLibrary({ overview }: any) {
  return <section className="steam-overview"><button onClick={localPlay}>Play</button><span>{overview.display_name}</span></section>;
}
function Page() {
  const [mount, setMount] = useState<LibraryMount | null>(null);
  useEffect(() => observeLibraryMount({
    document, classes: ["steam-overview"],
    fiber: (node) => (node as any)[Object.keys(node).find((key) => key.startsWith("__reactFiber$"))!],
    lookup: () => overview, supported: () => true, change: setMount
  }), []);
  return <><NativeLibrary overview={overview} />{mount && createPortal(<MoonDeckLaunchButtonAnchor {...mount.game} />, mount.container)}</>;
}
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  backend.call.mockReset(); backend.launch.mockReset().mockResolvedValue(undefined); localPlay.mockReset();
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ width: 500, height: 48 }] as any);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
describe("Library return from a stream", () => {
  it("restores Resume Stream on the same page using live session and launcher subscriptions", async () => {
    const active = new BehaviorSubject<any>({ steamAppId: 892970, moonDeckAppId: 1000 });
    let session: SessionStatus = { schema: 1, generation: "stream", updatedAt: 1, steamAppId: 892970, hostId: "host-a", remoteAppId: 42, runnerActive: true, state: "streaming" };
    backend.call.mockImplementation(async (name: string) => name === "remote_catalog" ? catalog : session);
    const context = { moonDeckAppLauncher: { launchApp: backend.launch, moonDeckApp: { get value() { return active.value; }, asObservable: () => active.asObservable() } } };
    await act(async () => root.render(<MoonDeckContext.Provider value={context as any}><Page /></MoonDeckContext.Provider>));
    const slot = host.querySelector("[data-pyrodeck-library-action]")!;
    const button = slot.querySelector("button")!;
    expect(button.textContent).toBe("Streaming"); expect(button.disabled).toBe(true);
    await act(async () => {
      active.next(null);
      session = { ...session, updatedAt: 2, state: "disconnected", runnerActive: false };
      await pyrolightIntegration.refreshSession();
      slot.remove();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(host.querySelector("[data-pyrodeck-library-action]")).toBe(slot);
    expect(slot.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("Resume Stream"); expect(button.disabled).toBe(false);
    expect(slot.querySelector('[aria-label="Stream options"]')).not.toBeNull();
    await act(async () => button.click());
    expect(backend.launch.mock.calls[0][4]).toEqual({ hostId: "host-a", remoteAppId: 42 });
    await act(async () => (host.querySelector(".steam-overview > button") as HTMLButtonElement).click());
    expect(localPlay).toHaveBeenCalledOnce();
  });
});
