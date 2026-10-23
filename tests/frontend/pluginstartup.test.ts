import { describe, expect, it, vi } from "vitest";
import { startPlugin } from "../../src/lib/pluginstartup";

describe("startup independence", () => {
  it("registers native integration before discovery completes or retries", async () => {
    const events: string[] = [];
    let cancel = false;
    await startPlugin({
      ready: async () => true, cancelled: () => cancel,
      startNative: () => { events.push("native"); },
      discover: async () => { events.push("discovery"); return null; },
      startShortcuts: vi.fn(), retry: async () => { cancel = true; }
    });
    expect(events).toEqual(["native", "discovery"]);
  });
  it("ignores discovery resolved after unload and initializes shortcuts once", async () => {
    let cancel = false;
    const shortcuts = vi.fn();
    await startPlugin({ ready: async () => true, cancelled: () => cancel,
      startNative: vi.fn(), discover: async () => { cancel = true; return []; },
      startShortcuts: shortcuts, retry: vi.fn() });
    expect(shortcuts).not.toHaveBeenCalled();
    cancel = false;
    await startPlugin({ ready: async () => true, cancelled: () => cancel,
      startNative: vi.fn(), discover: async () => [], startShortcuts: shortcuts, retry: vi.fn() });
    expect(shortcuts).toHaveBeenCalledOnce();
  });
});
