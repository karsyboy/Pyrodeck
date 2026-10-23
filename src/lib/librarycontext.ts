import { Provider, ReactNode, createElement } from "react";
import type { SteamFiber } from "./librarymount";

export interface LibraryContext {
  provider: Provider<unknown>;
  value: unknown;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : null;

/** A DOM portal does not inherit the contexts around its destination. */
export function libraryContexts(fiber: SteamFiber | null): LibraryContext[] {
  const contexts: LibraryContext[] = [];
  const seen = new Set<unknown>();
  let owner = fiber;
  for (let depth = 0; owner && depth < 100; owner = owner.return ?? null, depth++) {
    if (owner.tag !== 10 || !owner.memoizedProps || !("value" in owner.memoizedProps)) continue;
    const type = record(owner.type);
    const symbol = type?.$$typeof;
    if (symbol !== Symbol.for("react.provider") && symbol !== Symbol.for("react.context")) continue;
    const context = type?._context ?? type;
    if (seen.has(context)) continue;
    seen.add(context);
    contexts.push({ provider: owner.type as Provider<unknown>, value: owner.memoizedProps.value });
  }
  return contexts;
}

/** Native Focusable registers under this exact node instead of a new nav tree. */
function navigationTree(contexts: LibraryContext[]): Record<string, unknown> | null {
  for (const { value } of contexts) {
    const tree = record(record(value)?.Tree);
    if (typeof tree?.CreateNode === "function" && typeof tree.RegisterNavigationItem === "function" && typeof tree.OnRootButtonDown === "function") return tree;
  }
  return null;
}

export function hasLibraryNavigation(contexts: LibraryContext[]): boolean {
  return navigationTree(contexts) !== null;
}

/** Restore native event ancestry only when a portal is outside that ancestry. */
export function bridgeLibraryNavigation(container: HTMLElement, parent: Element, contexts: LibraryContext[]): () => void {
  // Inline controls already bubble to Steam's root. An extra dispatcher here
  // would process every A/D-pad press twice.
  if (parent.contains(container)) return () => {};
  const tree = navigationTree(contexts);
  const win = container.ownerDocument.defaultView;
  if (!tree || !win) return () => {};
  const rootButtonDown = tree.OnRootButtonDown as (event: Event) => unknown;
  // Steam normally maps raw input to OK/direction events at its DOM nav root.
  // Call that same tree entry point with the original event/target, so A goes
  // to our actual button rather than to a retargeted native Play/Gear control.
  const down = (event: Event): void => { rootButtonDown.call(tree, event); };
  // Internal row navigation consumes its own direction events first. Only
  // unhandled events escape the slot and resume bubbling at the native parent.
  const bubble = (event: Event): void => {
    if (!parent.isConnected || event.defaultPrevented) return;
    const relay = new win.CustomEvent(event.type, {
      bubbles: true, cancelable: true, detail: (event as CustomEvent<unknown>).detail
    });
    parent.dispatchEvent(relay);
    event.stopPropagation();
    if (relay.defaultPrevented) event.preventDefault();
  };
  const events = ["vgp_ondirection", "vgp_oncancel", "vgp_onsecondaryaction", "vgp_onoptions", "vgp_onmenu"];
  container.addEventListener("vgp_onbuttondown", down);
  events.forEach((name) => container.addEventListener(name, bubble));
  return () => {
    container.removeEventListener("vgp_onbuttondown", down);
    events.forEach((name) => container.removeEventListener(name, bubble));
  };
}

export function withLibraryContexts(contexts: LibraryContext[], children: ReactNode): ReactNode {
  // Nearest providers were collected first, so the outer providers wrap last.
  return contexts.reduce((child, { provider, value }) => createElement(provider, { value }, child), children);
}
