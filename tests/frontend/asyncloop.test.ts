import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/logger", () => ({ logger: { critical: vi.fn() } }));
import { asyncLoop } from "../../src/lib/asyncloop";
import { IncrementalLoop } from "../../src/lib/incrementalloop";

afterEach(() => vi.useRealTimers());
describe("host polling teardown", () => {
  it("cancels idle time immediately instead of keeping a closed view's timer alive", async () => {
    vi.useFakeTimers(); const callback = vi.fn();
    const stop = asyncLoop(callback, 5000); await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
    await stop(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000); expect(callback).toHaveBeenCalledOnce();
  });
  it("does not resurrect a stopped poll when its in-flight callback fails", async () => {
    vi.useFakeTimers(); let fail!: (error: Error) => void;
    const callback = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const stop = asyncLoop(callback, 5000); await vi.advanceTimersByTimeAsync(0);
    const stopped = stop(); fail(new Error("Host disconnected")); await stopped;
    await vi.advanceTimersByTimeAsync(10000);
    expect(callback).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("can restart host status polling after logout and login", async () => {
    vi.useFakeTimers(); const callback = vi.fn(); const loop = new IncrementalLoop(callback, 5000);
    await loop.init(); await loop.start(); await vi.advanceTimersByTimeAsync(0);
    await loop.deinit(); expect(vi.getTimerCount()).toBe(0);
    await loop.init(); await loop.start(); await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(2);
    await loop.stop(); expect(vi.getTimerCount()).toBe(0);
  });
});
