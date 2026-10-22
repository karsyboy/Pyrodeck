import { getLibraryAppData } from "./launchenv";

type Game = NonNullable<ReturnType<typeof getLibraryAppData>>;
export interface SteamFiber {
  return?: SteamFiber | null;
  alternate?: SteamFiber | null;
  memoizedProps?: { overview?: unknown; appid?: unknown };
  stateNode?: { current?: SteamFiber };
}

function currentFiber(fiber: SteamFiber): SteamFiber {
  let root = fiber;
  for (let depth = 0; root.return && depth < 100; depth++) root = root.return;
  return root.stateNode?.current &&
    root.stateNode.current !== root &&
    fiber.alternate ?
    fiber.alternate :
    fiber;
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
    if (typeof props?.appid === "number") {
      const fromId = getLibraryAppData(lookup(props.appid));
      if (fromId) return fromId;
    }
  }
  return null;
}

export interface LibraryMount {
  container: HTMLElement;
  game: Game;
}
interface Options {
  document: Document;
  classes: string[];
  fiber: (element: Element) => SteamFiber | null;
  lookup: (id: number) => unknown;
  supported: (game: Game) => boolean;
  change: (mount: LibraryMount | null) => void;
}

/** An owned sibling/React portal leaves Steam's native action tree intact. */
export function observeLibraryMount(options: Options): () => void {
  const { document: doc } = options;
  const win = doc.defaultView;
  if (!win) return () => {};
  let active: LibraryMount | null = null;
  let frame: number | null = null;
  const selectors = options.classes
    .filter(Boolean)
    .map(
      (name) =>
        `.${win.CSS?.escape ? win.CSS.escape(name) : name.replace(/[^\w-]/g, "\\$&")}`
    );
  const scan = (): void => {
    frame = null;
    let anchor: HTMLElement | null = null;
    let game: Game | null = null;
    for (const selector of selectors) {
      for (const node of doc.querySelectorAll<HTMLElement>(selector)) {
        if (!node.isConnected || !node.getClientRects().length) continue;
        const candidate = gameFromFiber(options.fiber(node), options.lookup);
        if (candidate && options.supported(candidate)) {
          anchor = node;
          game = candidate;
          break;
        }
      }
      if (anchor) break;
    }
    if (!anchor || !game) {
      if (active) {
        active.container.remove();
        active = null;
        options.change(null);
      }
      return;
    }
    if (
      active?.container.previousElementSibling === anchor &&
      active.game.appId === game.appId &&
      active.container.isConnected
    )
      return;
    active?.container.remove();
    const container = doc.createElement("div");
    container.dataset.pyrodeckLibraryAction = "true";
    container.style.width = "100%";
    anchor.after(container);
    active = { container, game };
    options.change(active);
  };
  const observer = new win.MutationObserver(() => {
    if (frame === null) frame = win.requestAnimationFrame(scan);
  });
  observer.observe(doc.body, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
    subtree: true
  });
  scan();
  return () => {
    observer.disconnect();
    if (frame !== null) win.cancelAnimationFrame(frame);
    active?.container.remove();
    options.change(null);
  };
}
