import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@decky/api", () => ({ call: vi.fn(), toaster: { toast: vi.fn() } }));
import { AppStartResult, waitForAppStartNotification } from "../../src/steam-utils/waitForAppStartNotification";

function fixture(failRegistration = false) {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const unregister = vi.fn();
  const register = (name: string) => (callback: (...args: any[]) => void) => {
    if (failRegistration && name === "end") throw Error("API changed");
    handlers[name] = callback;
    return { unregister };
  };
  (globalThis as any).SteamClient = {
    Apps: { RegisterForGameActionStart: register("start"), RegisterForGameActionTaskChange: register("task"), RegisterForGameActionEnd: register("end") },
    GameSessions: { RegisterForAppLifetimeNotifications: register("lifetime") }
  };
  return { handlers, unregister };
}
afterEach(() => vi.useRealTimers());
describe("Steam process launch notifications", () => {
  it("requires the correct helper's running event and cleans every listener", async () => {
    const f = fixture();
    const waiting = waitForAppStartNotification(99, "game-99", 1000);
    f.handlers.lifetime({ unAppID: 620, bRunning: true });
    f.handlers.lifetime({ unAppID: 99, bRunning: true });
    expect(await waiting).toBe(AppStartResult.Started);
    expect(f.unregister).toHaveBeenCalledTimes(4);
  });
  it("cleans up on cancellation before creating a process", async () => {
    const f = fixture();
    const waiting = waitForAppStartNotification(99, "game-99", 1000);
    f.handlers.start(7, "game-99", "LaunchApp"); f.handlers.end(7);
    expect(await waiting).toBe(AppStartResult.Cancelled);
    expect(f.unregister).toHaveBeenCalledTimes(4);
  });
  it("cleans up on timeout, explicit abort, and partial registration failure", async () => {
    vi.useFakeTimers();
    const f = fixture(); const timeout = waitForAppStartNotification(99, "99", 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(await timeout).toBe(AppStartResult.TimeoutOrError);
    expect(f.unregister).toHaveBeenCalledTimes(4);
    const controller = new AbortController();
    const aborted = waitForAppStartNotification(99, "99", 20, controller.signal);
    controller.abort(); expect(await aborted).toBe(AppStartResult.Cancelled);
    const broken = fixture(true);
    expect(await waitForAppStartNotification(99, "99", 20)).toBe(AppStartResult.TimeoutOrError);
    expect(broken.unregister).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
