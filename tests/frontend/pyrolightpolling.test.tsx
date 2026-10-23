// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@decky/api", () => backend);
import { PyrolightViewVisibility, usePyrolightSession, useSessionPolling } from "../../src/hooks/usepyrolight";
import { pyrolightIntegration } from "../../src/lib/pyrolightintegration";
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const render = vi.fn();
function Page() {
  render(); const session = usePyrolightSession(); useSessionPolling();
  const [local, setLocal] = useState(0);
  return <button onClick={() => setLocal(local + 1)}>{local}:{session.state}</button>;
}
const show = async (visible: boolean) => { await act(async () => root.render(<PyrolightViewVisibility.Provider value={visible}><Page /></PyrolightViewVisibility.Provider>)); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); render.mockClear(); backend.call.mockReset();
  backend.call.mockResolvedValue({ schema: 1, state: "streaming", updatedAt: 1 });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
describe("hidden Quick Access session views", () => {
  it("pauses polling/subscriptions without losing local UI state, then shows the latest session", async () => {
    await show(true); await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toBe("1:streaming");
    await show(false); const renders = render.mock.calls.length; backend.call.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(backend.call).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    backend.call.mockResolvedValue({ schema: 1, state: "disconnected", updatedAt: 2 });
    await act(async () => { await pyrolightIntegration.refreshSession(); });
    expect(render).toHaveBeenCalledTimes(renders);
    await show(true); expect(host.textContent).toBe("1:disconnected");
    expect(vi.getTimerCount()).toBe(1);
  });
});
