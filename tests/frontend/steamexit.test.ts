import { beforeEach, describe, expect, it, vi } from "vitest";
const original = vi.hoisted(() => vi.fn());
const disconnect = vi.hoisted(() => vi.fn(async () => {}));
const log = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/logger", () => ({ logger: { critical: log } }));
vi.mock("@decky/ui", () => {
  const callOriginal = Symbol("original");
  return { callOriginal, replacePatch: (object: Record<string, (...args: unknown[]) => unknown>, key: string, handler: (args: unknown[]) => unknown) => {
    const saved = object[key];
    object[key] = (...args) => { const result = handler(args); return result === callOriginal ? saved(...args) : result; };
    return { unpatch: () => { object[key] = saved; } };
  } };
});
import { registerForStreamExit } from "../../src/steam-utils/registerForStreamExit";

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).SteamClient = { Apps: { TerminateApp: original } };
});
describe("Steam Exit ownership", () => {
  it("disconnects only the matched stream and restores the API on unload", async () => {
    const remove = registerForStreamExit((id) => id === "owned" ? disconnect : null);
    SteamClient.Apps.TerminateApp("other-game", true);
    expect(original).toHaveBeenCalledWith("other-game", true);
    SteamClient.Apps.TerminateApp("owned", false);
    await Promise.resolve();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(original).not.toHaveBeenCalledWith("owned", false);
    remove!();
    expect(SteamClient.Apps.TerminateApp).toBe(original);
  });
  it("reports a failed disconnect without terminating another application", async () => {
    const failure = new Error("owned runner unavailable");
    const remove = registerForStreamExit(() => async () => { throw failure; });
    SteamClient.Apps.TerminateApp("owned", false);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(failure));
    expect(original).not.toHaveBeenCalled();
    remove!();
  });
  it("does not block plugin initialization if this Steam API is unavailable", () => {
    (globalThis as any).SteamClient = { Apps: {} };
    expect(registerForStreamExit(() => disconnect)).toBeNull();
  });
});
