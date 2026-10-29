// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ visible: true, refresh: vi.fn(async () => {}) }));
vi.mock("@decky/api", () => ({ useQuickAccessVisible: () => fake.visible }));
vi.mock("@decky/ui", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    // Steam dispatches bubbling gamepad events from the focused control.
    // Bridge that native contract without replacing it with keyboard input.
    Focusable: ({ children, onCancelButton, onCancelActionDescription }: any) => {
      const ref = useRef<HTMLDivElement>(null);
      useEffect(() => {
        const node = ref.current!;
        if (!onCancelButton) return;
        node.addEventListener("gamepadcancel", onCancelButton);
        return () => node.removeEventListener("gamepadcancel", onCancelButton);
      }, [onCancelButton]);
      return <div ref={ref} data-back-label={onCancelActionDescription}>{children}</div>;
    },
    PanelSection: ({ children }: any) => <section>{children}</section>,
    PanelSectionRow: ({ children }: any) => <div>{children}</div>,
    Field: ({ label, description }: any) => <p>{label} {description}</p>,
    DialogButton: ({ children, ...props }: any) => <button {...props}>{children}</button>
  };
});
vi.mock("../../src/hooks", () => ({
  useServerStatus: () => ["Offline", false],
  useHostInfo: () => null,
  useCurrentHostSettings: () => null,
  useCurrentSettings: () => null
}));
vi.mock("../../src/hooks/usepyrolight", async () => {
  const { createContext } = await import("react");
  return {
    PyrolightViewVisibility: createContext(true),
    usePyrolight: () => ({ preferences: null, session: { state: "none" } }),
    useSessionPolling: () => {}
  };
});
vi.mock("../../src/lib/pyrolightintegration", () => ({ pyrolightIntegration: { refresh: fake.refresh } }));
vi.mock("../../src/components/quicksettingsview/hoststatuspanel", () => ({ HostStatusPanel: () => null }));
vi.mock("../../src/components/quicksettingsview/pyrolightinstallpanel", () => ({ PyrolightInstallPanel: () => null }));
vi.mock("../../src/components/quicksettingsview/pyrodeckupdatepanel", () => ({ PyroDeckUpdatePanel: () => null }));
vi.mock("../../src/components/pyrolightsettings/settings", () => ({
  SettingsFeedback: () => null,
  PyrolightSettings: ({ category }: any) => <button data-subpage>{category} control</button>
}));
vi.mock("../../src/components/remotegames/remotegames", () => ({ RemoteGames: () => <button data-subpage>Remote game</button> }));
vi.mock("../../src/components/quicksettingsview/sessioncontrols", () => ({ SessionControls: () => <button data-subpage>Resume session</button> }));
vi.mock("../../src/components/diagnostics/diagnostics", () => ({ Diagnostics: () => <button data-subpage>Refresh diagnostics</button> }));

import { QuickSettingsView } from "../../src/components/quicksettingsview/quicksettingsview";
import { settingsCategories } from "../../src/components/pyrolightsettings/categories";
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const deckyBack = vi.fn();
const button = (label: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label)!;
const show = async (visible = true) => {
  fake.visible = visible;
  await act(async () => root.render(<QuickSettingsView />));
};
const open = async (label: string) => { await act(async () => button(label).click()); };
const cancel = async (target: Element) => {
  const event = new CustomEvent("gamepadcancel", { bubbles: true, cancelable: true, detail: { button: 2, source: 0 } });
  await act(async () => { target.dispatchEvent(event); });
  return event;
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); fake.visible = true;
  container = document.body.appendChild(document.createElement("div"));
  container.addEventListener("gamepadcancel", deckyBack);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Quick Access controller Back navigation", () => {
  it.each([
    "Browse Remote Games", "Session Controls", "Troubleshooting & Diagnostics",
    ...settingsCategories.map(({ title }) => title + "›")
  ])("returns from %s to PyroDeck before allowing Decky's normal Back", async (label) => {
    await show(); await open(label);
    expect(container.querySelector("[data-back-label]")?.getAttribute("data-back-label")).toBe("Back to PyroDeck");
    const event = await cancel(container.querySelector("[data-subpage]")!);
    expect(event.defaultPrevented).toBe(true);
    expect(deckyBack).not.toHaveBeenCalled();
    expect(button("Browse Remote Games")).toBeDefined();
    const rootEvent = await cancel(button("Browse Remote Games"));
    expect(rootEvent.defaultPrevented).toBe(false);
    expect(deckyBack).toHaveBeenCalledOnce();
  });

  it("lets a child dropdown or dialog consume Back before navigating the subpage", async () => {
    await show(); await open("Profiles›");
    const control = container.querySelector("[data-subpage]")!;
    control.addEventListener("gamepadcancel", (event) => event.stopPropagation(), { once: true });
    await cancel(control);
    expect(container.querySelector("[data-subpage]")).toBe(control);
    expect(deckyBack).not.toHaveBeenCalled();
    await cancel(control);
    expect(button("Browse Remote Games")).toBeDefined();
    expect(deckyBack).not.toHaveBeenCalled();
  });

  it("keeps the on-screen Back button working", async () => {
    await show(); await open("Session Controls");
    await open("‹ Back to PyroDeck");
    expect(button("Browse Remote Games")).toBeDefined();
  });

  it("does not navigate retained hidden subpages, and handles Back after reopening", async () => {
    await show(); await open("Browse Remote Games");
    await show(false);
    const control = container.querySelector("[data-subpage]")!;
    expect((await cancel(control)).defaultPrevented).toBe(false);
    expect(container.querySelector("[data-subpage]")).toBe(control);
    await show(); deckyBack.mockClear();
    await cancel(control);
    expect(button("Browse Remote Games")).toBeDefined();
    expect(deckyBack).not.toHaveBeenCalled();
  });
});
