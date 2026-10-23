// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@decky/api", () => backend);
vi.mock("@decky/ui", () => ({
  PanelSection: ({ children }: any) => <section>{children}</section>,
  PanelSectionRow: ({ children }: any) => <div>{children}</div>,
  Field: ({ label, description }: any) => <p>{label} {description}</p>,
  DialogButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DropdownItem: ({ selectedOption, rgOptions, onChange }: any) => <select value={selectedOption} onChange={(event) => onChange({ data: event.target.value })}>{rgOptions.map((item: any) => <option key={item.data} value={item.data}>{item.label}</option>)}</select>
}));
import { Diagnostics } from "../../src/components/diagnostics/diagnostics";
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const report = { pyrodeckVersion: "0.2.8", session: { state: "none" }, processes: { runnerActive: false, clientPid: null } };
const press = async (label: string) => { await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click()); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  backend.call.mockReset().mockResolvedValue(report);
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("diagnostic recovery and logs", () => {
  it("clears a transient error when diagnostics are retried successfully", async () => {
    backend.call.mockRejectedValueOnce(Error("Backend restarting"));
    await act(async () => root.render(<Diagnostics />)); expect(host.textContent).toContain("Backend restarting");
    await press("Refresh Diagnostics"); expect(host.textContent).not.toContain("Backend restarting");
    expect(host.textContent).toContain("PyroDeck 0.2.8");
  });
  it("discards a late log response after the selected log changes", async () => {
    await act(async () => root.render(<Diagnostics />));
    let finish!: (value: any) => void;
    backend.call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await press("View Log"); expect(host.textContent).toContain("Loading Log…");
    await act(async () => { const select = host.querySelector("select")!; select.value = "frontend"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => finish({ path: "runner.log", text: "stale runner output" }));
    expect(host.textContent).not.toContain("stale runner output");
    backend.call.mockResolvedValueOnce({ path: "frontend.log", text: "current frontend output" });
    await press("View Log"); expect(backend.call).toHaveBeenLastCalledWith("diagnostic_log", "frontend");
    expect(host.textContent).toContain("current frontend output");
  });
});
