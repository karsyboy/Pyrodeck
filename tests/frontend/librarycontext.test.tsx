// @vitest-environment jsdom
import { act, createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { hasLibraryNavigation, libraryContexts, withLibraryContexts } from "../../src/lib/librarycontext";

describe("native Library context bridge", () => {
  it("keeps the nearest provider for each context and preserves nested window/ring values", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const parent = createContext("outside"); const ownerWindow = createContext("wrong-window");
    const contexts = libraryContexts({ return: {
      tag: 10, type: parent.Provider, memoizedProps: { value: "native-controls" }, return: {
        tag: 10, type: ownerWindow.Provider, memoizedProps: { value: "library-window" }, return: {
          tag: 10, type: parent.Provider, memoizedProps: { value: "page-root" }
        }
      }
    } });
    expect(contexts).toHaveLength(2);
    function Consumer() { return <span>{useContext(parent)} / {useContext(ownerWindow)}</span>; }
    const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host);
    try {
      await act(async () => root.render(withLibraryContexts(contexts, <Consumer />)));
      expect(host.textContent).toBe("native-controls / library-window");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("recognizes React 18 provider fibers as well as React 19 context fibers", () => {
    const context = {}; const provider = { $$typeof: Symbol.for("react.provider"), _context: context };
    expect(libraryContexts({ tag: 10, type: provider, memoizedProps: { value: "native" } })).toEqual([{ provider, value: "native" }]);
    expect(libraryContexts({ tag: 10, type: {}, memoizedProps: { value: "invalid" } })).toEqual([]);
  });
  it("validates the native navigation registration contract", () => {
    const provider = createContext(null).Provider;
    expect(hasLibraryNavigation([{ provider, value: { Tree: { CreateNode() {}, RegisterNavigationItem() {}, OnRootButtonDown() {} } } }])).toBe(true);
    expect(hasLibraryNavigation([{ provider, value: { Tree: {} } }])).toBe(false);
    expect(hasLibraryNavigation([])).toBe(false);
  });
});
