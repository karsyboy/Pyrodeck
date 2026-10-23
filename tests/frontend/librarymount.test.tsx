// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@decky/api", () => ({ call: vi.fn(), toaster: { toast: vi.fn() } }));
import { LibraryMount, gameFromFiber, observeLibraryMount } from "../../src/lib/librarymount";

const valheim = { appid: 892970, display_name: "Valheim", app_type: 1 };
const portal = { appid: 620, display_name: "Portal 2", app_type: 1 };
const localPlay = vi.fn();
const stream = vi.fn();
const lookup = (id: number) =>
  [valheim, portal].find((app) => app.appid === id);
const fiber = (node: Element) =>
  (node as any)[
    Object.keys(node).find((key) => key.startsWith("__reactFiber$"))!
  ];
const frame = async () => {
  await act(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
};

function NativeLibrary({ overview }: { overview: typeof valheim }) {
  return (
    <main>
      <section className="steam-overview">
        <button onClick={localPlay}>Play locally</button>
        <span>{overview.display_name}</span>
      </section>
    </main>
  );
}
function GlobalPortal() {
  const [mount, setMount] = useState<LibraryMount | null>(null);
  useEffect(
    () =>
      observeLibraryMount({
        document,
        classes: ["steam-overview"],
        fiber,
        lookup,
        supported: (game) => game.appType === 1,
        change: setMount,
      }),
    [],
  );
  return mount
    ? createPortal(
        <button data-stream-game={mount.game.appId} onClick={stream}>
          Stream {mount.game.appName}
        </button>,
        mount.container,
      )
    : null;
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return (this.closest("[hidden]")
        ? []
        : [{ width: 500, height: 80 }]) as unknown as DOMRectList;
    },
  );
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Library action in a real React DOM tree", () => {
  it("mounts through the actual owning fiber without a route renderFunc, and preserves local Play", async () => {
    await act(async () =>
      root.render(
        <>
          <NativeLibrary overview={valheim} />
          <GlobalPortal />
        </>,
      ),
    );
    await frame();
    const panel = document.querySelector(".steam-overview")!;
    const button = panel.querySelector("button:not([data-stream-game])")!;
    const nativeHTML = panel.innerHTML;
    const mount = document.querySelector("[data-pyrodeck-library-action]")!;
    expect(mount.parentElement).toBe(panel);
    expect(mount.className).toContain("BasicUI");
    expect(mount.textContent).toBe("Stream Valheim");
    await act(async () => {
      button.click();
      (mount.querySelector("button") as HTMLButtonElement).click();
    });
    expect(localPlay).toHaveBeenCalledOnce();
    expect(stream).toHaveBeenCalledOnce();
    expect(panel.innerHTML).toBe(nativeHTML);
    expect(panel.querySelector("button:not([data-stream-game])")).toBe(button);
    document.body.append(document.createElement("aside"));
    await frame();
    expect(
      document.querySelectorAll("[data-pyrodeck-library-action]"),
    ).toHaveLength(1);
  });
  it("follows a reused DOM panel after React switches the active game", async () => {
    await act(async () =>
      root.render(
        <>
          <NativeLibrary overview={valheim} />
          <GlobalPortal />
        </>,
      ),
    );
    await frame();
    const panel = document.querySelector(".steam-overview");
    await act(async () =>
      root.render(
        <>
          <NativeLibrary overview={portal} />
          <GlobalPortal />
        </>,
      ),
    );
    await frame();
    expect(document.querySelector(".steam-overview")).toBe(panel);
    expect(
      document.querySelector("[data-pyrodeck-library-action]")?.textContent,
    ).toBe("Stream Portal 2");
    expect(
      document
        .querySelector("[data-stream-game]")
        ?.getAttribute("data-stream-game"),
    ).toBe("620");
  });
  it("removes only its own mount when the Library page disappears", async () => {
    await act(async () =>
      root.render(
        <>
          <NativeLibrary overview={valheim} />
          <GlobalPortal />
        </>,
      ),
    );
    await frame();
    await act(async () =>
      root.render(
        <>
          <article>Home</article>
          <GlobalPortal />
        </>,
      ),
    );
    await frame();
    expect(document.querySelector("[data-pyrodeck-library-action]")).toBeNull();
    expect(document.querySelector("article")?.textContent).toBe("Home");
  });
  it("cleans up the observer and portal on plugin unload", async () => {
    await act(async () =>
      root.render(
        <>
          <NativeLibrary overview={valheim} />
          <GlobalPortal />
        </>,
      ),
    );
    await frame();
    await act(async () => root.render(<NativeLibrary overview={valheim} />));
    await frame();
    expect(document.querySelector("[data-pyrodeck-library-action]")).toBeNull();
    expect(document.querySelector(".steam-overview button")?.textContent).toBe(
      "Play locally",
    );
  });
});


describe("compatibility adapter", () => {
  it("uses compound selectors, reports changed Steam structures, and cleans reloads", async () => {
    const node = document.createElement("section"); node.className = "native play"; document.body.append(node);
    const change = vi.fn(); const status = vi.fn();
    const options = { document, classes: ["native play"], fiber: () => ({ memoizedProps: { overview: valheim } }), lookup,
      supported: () => true, change, status };
    const stop = observeLibraryMount(options); await frame();
    expect(document.querySelectorAll("[data-pyrodeck-library-action]")).toHaveLength(1);
    expect(status).toHaveBeenLastCalledWith("attached", 892970);
    stop(); const reload = observeLibraryMount(options); await frame();
    expect(document.querySelectorAll("[data-pyrodeck-library-action]")).toHaveLength(1);
    node.className = "changed"; await frame();
    expect(status).toHaveBeenLastCalledWith("waiting_for_page", null);
    expect(document.querySelectorAll("[data-pyrodeck-library-action]")).toHaveLength(0);
    reload(); node.remove();
  });
  it("refuses stale detached fibers and accepts current appId properties", () => {
    const current: any = { child: { memoizedProps: { appId: 620 } } };
    const old: any = { stateNode: { current } };
    const detached: any = { return: old, memoizedProps: { overview: valheim } };
    expect(gameFromFiber(detached, lookup)).toBeNull();
    expect(gameFromFiber(current.child, lookup)?.appId).toBe(620);
  });
});
