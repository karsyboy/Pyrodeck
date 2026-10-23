import { LibraryContext, bridgeLibraryNavigation, hasLibraryNavigation, libraryContexts } from "./librarycontext";
import { getLibraryAppData } from "./launchenv";

type Game = NonNullable<ReturnType<typeof getLibraryAppData>>;
export interface SteamFiber {
  tag?: number;
  type?: unknown;
  return?: SteamFiber | null;
  child?: SteamFiber | null;
  sibling?: SteamFiber | null;
  alternate?: SteamFiber | null;
  memoizedProps?: { overview?: unknown; appid?: unknown; appId?: unknown; value?: unknown };
  stateNode?: { current?: SteamFiber };
}

export function currentFiber(fiber: SteamFiber): SteamFiber | null {
  let root = fiber;
  for (let depth = 0; root.return && depth < 100; depth++) root = root.return;
  const current = root.stateNode?.current;
  if (!current || current === root) return fiber;
  // Alternates need not have identical parent paths after reparenting. Locate
  // this host node in the committed tree instead of assuming alternate=live.
  if (fiber.alternate) {
    let alternateRoot = fiber.alternate;
    for (let depth = 0; alternateRoot.return && depth < 100; depth++) alternateRoot = alternateRoot.return;
    if (alternateRoot === current) return fiber.alternate;
  }
  const pending = [current];
  for (let count = 0; pending.length && count < 10000; count++) {
    const node = pending.pop()!;
    if (node === fiber || node === fiber.alternate) return node;
    if (node.sibling) pending.push(node.sibling);
    if (node.child) pending.push(node.child);
  }
  return null;
}

/** Read the mounted page's owning component, including React's alternate tree. */
export function gameFromFiber(
  fiber: SteamFiber | null,
  lookup: (id: number) => unknown
): Game | null {
  let owner = fiber ? currentFiber(fiber) : null;
  for (
    let depth = 0;
    owner && depth < 100;
    owner = owner.return ?? null, depth++
  ) {
    const props = owner.memoizedProps;
    const game = getLibraryAppData(props?.overview);
    if (game) return game;
    const id = props?.appid ?? props?.appId;
    if (typeof id === "number") {
      const fromId = getLibraryAppData(lookup(id));
      if (fromId) return fromId;
    }
  }
  return null;
}

export interface LibraryMount {
  container: HTMLElement;
  game: Game;
  contexts: LibraryContext[];
}
export interface LibraryMountDiagnostic {
  phase: string;
  appId: number | null;
  selectors: number;
  panels: number;
  visiblePanels: number;
  fibers: number;
  visibility: string;
  contexts: number;
  navigation: boolean;
}
interface Options {
  document: Document;
  classes: string[];
  focusClass?: string;
  beforeClass?: string;
  navigationRequired?: boolean;
  fiber: (element: Element) => SteamFiber | null;
  lookup: (id: number) => unknown;
  supported: (game: Game) => boolean;
  change: (mount: LibraryMount | null) => void;
  status?: (phase: string, appId: number | null) => void;
  diagnostic?: (report: LibraryMountDiagnostic) => void;
}

/** An owned slot joins Steam's controls without replacing their action nodes. */
export function observeLibraryMount(options: Options): () => void {
  const { document: doc } = options;
  const win = doc.defaultView;
  if (!win) return () => {};
  let active: LibraryMount | null = null;
  let frame: number | null = null;
  let stopNavigation: (() => void) | null = null;
  let navigationParent: Element | null = null;
  let activePanel: Element | null = null;
  let identityRegion: Element | null = null;
  let insertionTarget: Element | null = null;
  let insertionButton: Element | null = null;
  let knownPanels: Element[] = [];
  const selectors = options.classes
    .filter(Boolean)
    .map((names) => names.split(/\s+/).map((name) => `.${win.CSS?.escape ? win.CSS.escape(name) : name.replace(/[^\w-]/g, "\\$&")}`).join(""));
  const focusSelector = options.focusClass?.split(/\s+/).filter(Boolean)
    .map((name) => `.${win.CSS?.escape ? win.CSS.escape(name) : name.replace(/[^\w-]/g, "\\$&")}`).join("");
  const beforeSelector = options.beforeClass?.split(/\s+/).filter(Boolean)
    .map((name) => `.${win.CSS?.escape ? win.CSS.escape(name) : name.replace(/[^\w-]/g, "\\$&")}`).join("");
  const scan = (): void => {
    frame = null;
    let anchor: HTMLElement | null = null;
    let game: Game | null = null;
    let candidates = 0;
    let panels = 0;
    let fibers = 0;
    let contexts: LibraryContext[] = [];
    let controls: Element | null = null;
    let before: Element | null = null;
    knownPanels = [];
    for (const selector of selectors) {
      for (const node of doc.querySelectorAll<HTMLElement>(selector)) {
        knownPanels.push(node);
        panels++;
        if (!node.isConnected || !node.getClientRects().length) continue;
        candidates++;
        const fiber = options.fiber(node);
        if (fiber) fibers++;
        const candidate = gameFromFiber(fiber, options.lookup);
        if (candidate && options.supported(candidate)) {
          anchor = node;
          game = candidate;
          // Match both the DOM order and native navigation parent of the
          // right-hand controls. Steam Input may have a tooltip wrapper.
          controls = focusSelector ? node.querySelector(focusSelector) : node;
          before = beforeSelector ? controls?.querySelector(beforeSelector) ?? null : controls?.firstElementChild ?? null;
          if (before === active?.container) before = before.nextElementSibling;
          insertionButton = before;
          while (before?.parentElement && before.parentElement !== controls) before = before.parentElement;
          const contextFiber = controls ? options.fiber(controls) : fiber;
          contexts = libraryContexts(contextFiber ? currentFiber(contextFiber) : null);
          break;
        }
      }
      if (anchor) break;
    }
    const navigation = hasLibraryNavigation(contexts);
    activePanel = anchor;
    // Titles/artwork may be siblings of PlaySection. Keep those navigation
    // signals without listening to every animated element elsewhere in Steam.
    identityRegion = anchor?.closest(selectors[selectors.length - 1])?.parentElement ?? anchor;
    insertionTarget = before;
    const phase = game ? (beforeSelector && !before ? "steam_input_unavailable" : options.navigationRequired && !navigation ? "focus_context_unavailable" : "attached") : candidates ? (fibers ? "page_identity_unavailable" : "fiber_unavailable") : selectors.length ? "waiting_for_page" : "selectors_unavailable";
    options.status?.(phase, game?.appId ?? null);
    options.diagnostic?.({ phase, appId: game?.appId ?? null, selectors: selectors.length,
      panels, visiblePanels: candidates, fibers, visibility: doc.visibilityState, contexts: contexts.length, navigation });
    if (!anchor || !game || phase !== "attached") {
      if (active) {
        stopNavigation?.(); stopNavigation = null; navigationParent = null;
        active.container.remove();
        active = null;
        options.change(null);
      }
      return;
    }
    if (
      active &&
      active.game.appId === game.appId &&
      active.game.appName === game.appName
    ) {
      if (active.container.parentElement !== controls || (before !== active.container && active.container.nextElementSibling !== before))
        controls!.insertBefore(active.container, before);
      if (navigationParent !== controls || active.contexts.length !== contexts.length || contexts.some((context, index) =>
        context.provider !== active!.contexts[index].provider || context.value !== active!.contexts[index].value)) {
        stopNavigation?.();
        navigationParent = controls;
        stopNavigation = bridgeLibraryNavigation(active.container, controls!, contexts);
        active = { ...active, contexts };
        options.change(active);
      }
      return;
    }
    stopNavigation?.();
    active?.container.remove();
    const container = doc.createElement("div");
    container.dataset.pyrodeckLibraryAction = "true";
    container.className = "BasicUI";
    container.style.display = "flex";
    container.style.flexShrink = "0";
    controls!.insertBefore(container, before);
    navigationParent = controls;
    stopNavigation = bridgeLibraryNavigation(container, controls!, contexts);
    active = { container, game, contexts };
    options.change(active);
  };
  const schedule = (): void => {
    if (frame === null) frame = win.requestAnimationFrame(scan);
  };
  const isPanel = (node: Node): boolean => node instanceof win.Element && selectors.some((selector) =>
    node.matches(selector) || node.querySelector(selector) !== null);
  const oldStyle = doc.createElement("div").style;
  const visibilityProperties = ["display", "visibility", "content-visibility"];
  const nonFocusClasses = (value: string): string => value.split(/\s+/)
    .filter((name) => name && name !== "gpfocus" && name !== "gpfocuswithin").join(" ");
  const relevant = (record: MutationRecord): boolean => {
    const target = record.target;
    if (active?.container.contains(target)) return false;
    if (record.type === "attributes") {
      const structural = knownPanels.some((panel) => target.contains(panel)) ||
        target === navigationParent || target === insertionTarget || target === insertionButton;
      if (!structural && !(target instanceof win.Element &&
        ((!active && beforeSelector && target.matches(beforeSelector)) ||
          (!activePanel && selectors.some((selector) => target.matches(selector)))))) return false;
      if (target instanceof win.HTMLElement) {
        if (record.attributeName === "style") {
          // Steam animates transforms/backgrounds on Library ancestors while
          // scrolling and streaming. These cannot change slot identity or
          // display visibility; avoid a forced layout/fiber walk each frame.
          oldStyle.cssText = record.oldValue ?? "";
          if (visibilityProperties.every((key) => oldStyle.getPropertyValue(key) === target.style.getPropertyValue(key))) return false;
        }
        if (record.attributeName === "class" &&
          nonFocusClasses(record.oldValue ?? "") === nonFocusClasses(target.className)) return false;
      }
      // Focus rings, spinners and overlay animation change classes constantly.
      // Only panel/ancestor visibility or actual control structure matters.
      if (knownPanels.some((panel) => target.contains(panel))) return true;
      if (target === navigationParent) return true;
      if (record.attributeName !== "class" && (target === insertionTarget || target === insertionButton)) return true;
      if (target instanceof win.Element && beforeSelector &&
        ((!active && target.matches(beforeSelector)) || (target === insertionButton && !target.matches(beforeSelector)))) return true;
      return !activePanel && target instanceof win.Element && selectors.some((selector) => target.matches(selector));
    }
    if (record.type === "characterData") return Boolean(identityRegion?.contains(target));
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (active && nodes.length && nodes.every((node) => node === active!.container)) {
      // Ignore our own successful insertion, but repair removal/reordering by
      // Steam when it restores this page after exiting a game.
      return !active.container.isConnected || active.container.parentElement !== navigationParent ||
        active.container.nextElementSibling !== insertionTarget;
    }
    if (identityRegion?.contains(target)) return true;
    if (activePanel && nodes.some((node) => node.contains(activePanel))) return true;
    return nodes.some(isPanel);
  };
  const observer = new win.MutationObserver((records) => {
    if (records.some(relevant)) schedule();
  });
  win.addEventListener("popstate", schedule);
  win.addEventListener("focus", schedule);
  doc.addEventListener("visibilitychange", schedule);
  observer.observe(doc.body, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class", "style", "hidden"],
    subtree: true
  });
  scan();
  return () => {
    observer.disconnect();
    win.removeEventListener("popstate", schedule);
    win.removeEventListener("focus", schedule);
    doc.removeEventListener("visibilitychange", schedule);
    if (frame !== null) win.cancelAnimationFrame(frame);
    stopNavigation?.();
    active?.container.remove();
    options.change(null);
  };
}
