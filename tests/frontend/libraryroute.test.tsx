// @vitest-environment jsdom
import { act, createContext, useContext, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const decky = vi.hoisted(() => ({ addPatch: vi.fn((_path: string, patch: any) => patch), removePatch: vi.fn(), call: vi.fn(), toaster: { toast: vi.fn() } }));
const navigation = vi.hoisted(() => ({ context: null as any, parent: null as any, registered: new Map<HTMLElement, any>(), create: vi.fn(), stream: vi.fn() }));
vi.mock("@decky/api", () => ({ ...decky, routerHook: decky }));
vi.mock("@decky/ui", () => ({
  appDetailsClasses: { AppDetailsOverviewPanel: "steam-overview" },
  basicAppDetailsSectionStylerClasses: { PlaySection: "steam-play", AppButtons: "steam-app-buttons" },
  playSectionClasses: { ControllerConfigButton: "steam-input" },
  getReactInstance: (node: any) => node[Object.keys(node).find((key) => key.startsWith("__reactFiber$"))!]
}));
vi.mock("../../src/hooks/usecurrentsettings", () => ({ useCurrentSettings: () => ({ enableMoondeckShortcuts: true }) }));
vi.mock("../../src/steam-utils/getAppStoreEx", () => ({ getAppStoreEx: () => null }));
vi.mock("../../src/components/moondecklaunchbutton", () => ({ MoonDeckLaunchButtonAnchor: ({ appId, appName }: any) => {
  // Model the native Focusable contract: a node can register only under the
  // exact context supplied by its owning Steam page, even across a DOM portal.
  const parent = useContext(navigation.context) as any;
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!parent) return;
    const node = parent.Tree.CreateNode(parent);
    const unregister = parent.Tree.RegisterNavigationItem(node, ref.current);
    const activate = (event: Event) => { navigation.stream(appId); event.preventDefault(); event.stopPropagation(); };
    ref.current!.addEventListener("vgp_onok", activate);
    return () => { unregister(); ref.current?.removeEventListener("vgp_onok", activate); };
  }, [parent, appId]);
  return <button ref={ref} data-stream-game={appId}>Stream {appName}</button>;
} }));
import { LibraryAppHook, libraryRoute } from "../../src/routes/libaryapp";
import { steamIntegrationStatus } from "../../src/lib/steamintegrationstatus";
const localPlay = vi.fn();
const steamInput = vi.fn();
const valheim = { appid: 892970, display_name: "Valheim", app_type: 1 };
const portal = { appid: 620, display_name: "Portal 2", app_type: 1 };
navigation.context = createContext(null);
function NativePage({ overview }: { overview: typeof valheim }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    // The real Steam DOM root maps raw input before dispatching logical
    // events on their original target. Inline controls bubble there normally.
    const down = (event: Event) => navigation.parent?.Tree.OnRootButtonDown(event);
    const element = ref.current!; element.addEventListener("vgp_onbuttondown", down);
    return () => element.removeEventListener("vgp_onbuttondown", down);
  }, []);
  return <section ref={ref} className="steam-overview"><div className="steam-play"><button onClick={localPlay}>Play locally</button><span>{overview.display_name}</span><navigation.context.Provider value={navigation.parent}><div className="steam-app-buttons"><div data-native-input-wrapper><button className="steam-input" onClick={steamInput}>Steam Input</button></div><button data-native-gear>Manage</button></div></navigation.context.Provider></div></section>;
}
let iframe: HTMLIFrameElement;
let doc: Document;
let root: ReturnType<typeof createRoot>;
let stop: () => void;
const frame = async () => { await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }); };
const renderPage = async (overview = valheim) => {
  const route = { path: libraryRoute, exact: true, children: <NativePage overview={overview} /> };
  const patched = decky.addPatch.mock.calls.at(-1)![1](route);
  expect(patched.path).toBe(route.path); expect(patched.exact).toBe(true);
  await act(async () => root.render(patched.children)); await frame();
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  navigation.registered.clear();
  navigation.parent = { Tree: {
    CreateNode: navigation.create.mockImplementation((parent) => ({ parent })),
    RegisterNavigationItem: (node: any, element: HTMLElement) => {
      navigation.registered.set(element, node); return () => navigation.registered.delete(element);
    },
    OnRootButtonDown: (event: CustomEvent) => {
      // Steam's root maps raw presses on their ORIGINAL target. Retargeting
      // the raw event to Gear would activate the wrong control.
      const name = event.detail.button === 1 ? "vgp_onok" : event.detail.button === 2 ? "vgp_oncancel" : "vgp_ondirection";
      (event.target as HTMLElement).dispatchEvent(new doc.defaultView!.CustomEvent(name, { bubbles: true, cancelable: true, detail: event.detail }));
      event.stopPropagation();
    }
  } };
  iframe = document.createElement("iframe"); document.body.append(iframe); doc = iframe.contentDocument!;
  vi.spyOn((doc.defaultView as any).HTMLElement.prototype, "getClientRects").mockReturnValue([{ width: 500, height: 100 }] as any);
  root = createRoot(doc.body.appendChild(doc.createElement("main")));
  stop = LibraryAppHook();
});
afterEach(async () => {
  stop(); await act(async () => root.unmount()); iframe.remove(); vi.restoreAllMocks();
});
describe("Decky Library route attachment", () => {
  it("mounts into the route's BrowserWindow instead of the plugin's global document", async () => {
    expect(decky.addPatch).toHaveBeenCalledWith("/library/app/:appid", expect.any(Function));
    await renderPage();
    expect(document.querySelector(".steam-play")).toBeNull();
    expect(doc.querySelector("[data-stream-game]")?.textContent).toBe("Stream Valheim");
    expect(doc.querySelectorAll("[data-pyrodeck-library-action]")).toHaveLength(1);
    expect(steamIntegrationStatus.getSnapshot().libraryPhase).toBe("attached");
    expect(JSON.parse(steamIntegrationStatus.getSnapshot().libraryDetails!).navigation).toBe(true);
    const slot = doc.querySelector("[data-pyrodeck-library-action]")!;
    const input = doc.querySelector("[data-native-input-wrapper]")!;
    expect(slot.parentElement).toBe(doc.querySelector(".steam-app-buttons"));
    expect(slot.nextElementSibling).toBe(input);
    const nativeInputButton = input.querySelector("button");
    await act(async () => (doc.querySelector(".steam-play button") as HTMLButtonElement).click());
    expect(localPlay).toHaveBeenCalledOnce();
    await act(async () => nativeInputButton!.click());
    expect(steamInput).toHaveBeenCalledOnce();
    expect(input.querySelector("button")).toBe(nativeInputButton);
  });
  it("follows Library navigation and removes observers/mounts when the route leaves", async () => {
    await renderPage(); await renderPage(portal);
    expect(doc.querySelector("[data-stream-game]")?.textContent).toBe("Stream Portal 2");
    await act(async () => root.render(<article>Home</article>)); await frame();
    expect(doc.querySelector("[data-pyrodeck-library-action]")).toBeNull();
    expect(navigation.registered.size).toBe(0);
    expect(steamIntegrationStatus.getSnapshot().libraryPhase).toBe("route_registered");
    expect(steamIntegrationStatus.getSnapshot().currentAppId).toBeNull();
    await renderPage();
    expect(doc.querySelectorAll("[data-pyrodeck-library-action]")).toHaveLength(1);
    expect(doc.querySelector("[data-pyrodeck-library-action]")?.nextElementSibling).toBe(doc.querySelector("[data-native-input-wrapper]"));
  });
  it("unregisters the exact route patch and survives plugin re-registration", async () => {
    await renderPage(); const patch = decky.addPatch.mock.calls[0][1]; stop();
    expect(decky.removePatch).toHaveBeenCalledWith(libraryRoute, patch);
    await act(async () => root.render(<NativePage overview={valheim} />));
    stop = LibraryAppHook(); await renderPage();
    expect(doc.querySelectorAll("[data-pyrodeck-library-action]")).toHaveLength(1);
    expect(doc.querySelector(".steam-play button")?.textContent).toBe("Play locally");
  });
  it("reports a missing native panel without retaining the settings-loading label", async () => {
    steamIntegrationStatus.update({ library: "Loading settings" });
    const patched = decky.addPatch.mock.calls.at(-1)![1]({ children: <article>Loading Library</article> });
    await act(async () => root.render(patched.children)); await frame();
    const status = steamIntegrationStatus.getSnapshot();
    expect(status.libraryPhase).toBe("waiting_for_page");
    expect(status.library).toBe("Library route active; waiting for Steam's action panel");
    expect(JSON.parse(status.libraryDetails!)).toMatchObject({ panels: 0, visiblePanels: 0, fibers: 0 });
  });
  it("registers Stream with the native controls' nav parent and accepts controller activation", async () => {
    await renderPage();
    const stream = doc.querySelector<HTMLButtonElement>("[data-stream-game]")!;
    expect(navigation.create).toHaveBeenCalledWith(navigation.parent);
    expect(navigation.registered.get(stream)?.parent).toBe(navigation.parent);
    // Steam dispatches OK to the focused registered node. A DOM-only portal
    // outside the Library contexts would never register this button.
    stream.focus();
    await act(async () => stream.dispatchEvent(new doc.defaultView!.CustomEvent("vgp_onbuttondown", { bubbles: true, cancelable: true, detail: { button: 1, source: 1 } })));
    expect(navigation.stream).toHaveBeenCalledWith(892970);
  });
  it("returns unhandled D-pad and cancel events to the native controls without retargeting A", async () => {
    await renderPage(); const stream = doc.querySelector<HTMLButtonElement>("[data-stream-game]")!;
    const controls = doc.querySelector(".steam-app-buttons")!;
    const nativeDirection = vi.fn((event: Event) => { event.preventDefault(); event.stopPropagation(); });
    const nativeCancel = vi.fn((event: Event) => { event.preventDefault(); event.stopPropagation(); });
    controls.addEventListener("vgp_ondirection", nativeDirection);
    controls.addEventListener("vgp_oncancel", nativeCancel);
    const internal = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
    stream.addEventListener("vgp_ondirection", internal);
    stream.dispatchEvent(new doc.defaultView!.CustomEvent("vgp_onbuttondown", { bubbles: true, detail: { button: 12 } }));
    expect(nativeDirection).not.toHaveBeenCalled();
    stream.removeEventListener("vgp_ondirection", internal);
    stream.dispatchEvent(new doc.defaultView!.CustomEvent("vgp_onbuttondown", { bubbles: true, detail: { button: 11 } }));
    stream.dispatchEvent(new doc.defaultView!.CustomEvent("vgp_onbuttondown", { bubbles: true, detail: { button: 2 } }));
    expect(nativeDirection).toHaveBeenCalledOnce(); expect(nativeCancel).toHaveBeenCalledOnce();
    expect(navigation.stream).not.toHaveBeenCalled();
    await act(async () => root.render(<article>Home</article>));
    stream.dispatchEvent(new doc.defaultView!.CustomEvent("vgp_onbuttondown", { bubbles: true, detail: { button: 1 } }));
    expect(navigation.stream).not.toHaveBeenCalled();
  });
  it("re-registers against replaced native controls without duplicating the action", async () => {
    await renderPage(); const previous = navigation.parent;
    navigation.parent = { Tree: previous.Tree }; await renderPage(portal);
    const stream = doc.querySelector<HTMLButtonElement>("[data-stream-game]")!;
    expect(navigation.registered.get(stream)?.parent).toBe(navigation.parent);
    expect(navigation.registered.size).toBe(1);
    expect(doc.querySelectorAll("[data-pyrodeck-library-action]")).toHaveLength(1);
  });
  it("reports an incompatible native focus tree instead of mounting a mouse-only action", async () => {
    navigation.parent = null; await renderPage();
    expect(doc.querySelector("[data-pyrodeck-library-action]")).toBeNull();
    expect(steamIntegrationStatus.getSnapshot().libraryPhase).toBe("focus_context_unavailable");
    expect(JSON.parse(steamIntegrationStatus.getSnapshot().libraryDetails!).navigation).toBe(false);
  });
});
