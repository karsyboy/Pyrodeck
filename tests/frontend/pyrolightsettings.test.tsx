// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const current = vi.hoisted(() => ({ settings: null as any }));
vi.mock("@decky/api", () => ({ call: vi.fn(), toaster: { toast: vi.fn() } }));
vi.mock("@decky/ui", () => {
  const Box = ({ label, description, children }: any) => <div><span>{label}</span><span>{description}</span>{children}</div>;
  return {
    ConfirmModal: () => null,
    DialogButton: ({ children, focusable: _focusable, ...props }: any) => <button {...props}>{children}</button>,
    DropdownItem: ({ label, description, disabled, rgOptions }: any) => (
      <div data-dropdown={label} data-disabled={String(Boolean(disabled))}>
        <span>{label}</span><span>{description}</span>
        {rgOptions.map((option: any) => <span key={option.data}>{option.label}</span>)}
      </div>
    ),
    Field: Box,
    PanelSection: ({ title, children }: any) => <section><h2>{title}</h2>{children}</section>,
    PanelSectionRow: ({ children }: any) => <div>{children}</div>,
    TextField: () => null,
    ToggleField: ({ label, description, checked }: any) => <div data-toggle={label} data-checked={String(checked)}><span>{label}</span><span>{description}</span></div>,
    showModal: vi.fn()
  };
});
vi.mock("../../src/hooks/usepyrolight", () => ({
  usePyrolight: () => ({ ...current.settings, session: { state: "none" }, error: null, message: null }),
  usePyrolightSettings: () => current.settings
}));
vi.mock("../../src/lib/pyrolightintegration", () => ({
  pyrolightIntegration: { refresh: vi.fn(), stage: vi.fn(), apply: vi.fn(), discard: vi.fn() }
}));
import { PyrolightSettings } from "../../src/components/pyrolightsettings/settings";

// The descriptors Pyrolight's settings registry generates for the microphone.
const registry = [
  { key: "audioQuality", category: "Audio", scope: "profile", application: "reconnect", type: "integer", minimum: 0, maximum: 0,
    choices: [{ value: 0, label: "AQ_HOST_DEFAULT", supported: true }] },
  { key: "enableMicrophone", category: "Audio", scope: "profile", application: "reconnect", type: "boolean", minimum: 0, maximum: 0 },
  { key: "micEchoCancel", category: "Audio", scope: "profile", application: "reconnect", type: "integer", minimum: 0, maximum: 2,
    requires: "enableMicrophone",
    choices: [
      { value: 0, label: "MEC_AUTO", supported: true },
      { value: 1, label: "MEC_ON", supported: true },
      { value: 2, label: "MEC_OFF", supported: true }
    ] }
];
const preferences = (values: Record<string, number | boolean>) => ({
  schema: 1, ok: true, revision: "r", activeProfileId: "default", activeProfileName: "Default",
  profiles: [{ id: "default", name: "Default" }], values, registry,
  capabilities: { pyrowave: false, liveUpdates: false, displayProbe: "" }
});

let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const render = async () => { await act(async () => root.render(<PyrolightSettings category="Audio" />)); await act(async () => {}); };
const echo = () => container.querySelector("[data-dropdown^='Microphone echo cancellation']")!;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Pyrolight microphone settings", () => {
  it("shows the microphone and its echo cancellation on the Audio page", async () => {
    current.settings = { preferences: preferences({ audioQuality: 0, enableMicrophone: false, micEchoCancel: 0 }), pending: {}, busy: false };
    await render();
    const toggle = container.querySelector("[data-toggle^='Send microphone to the host']")!;
    expect(toggle.getAttribute("data-checked")).toBe("false");
    expect(toggle.textContent).toContain("Ctrl+Alt+Shift+U");
    expect(echo().textContent).toContain("Automatic");
    expect(echo().textContent).toContain("On");
    expect(echo().textContent).toContain("Off");
    // Echo cancellation waits for the microphone.
    expect(echo().getAttribute("data-disabled")).toBe("true");
    expect(echo().textContent).toContain("Enable Send microphone to the host first.");
  });

  it("enables echo cancellation once the microphone is on, also as a pending change", async () => {
    current.settings = { preferences: preferences({ audioQuality: 0, enableMicrophone: false, micEchoCancel: 0 }), pending: { enableMicrophone: true }, busy: false };
    await render();
    expect(container.textContent).toContain("Send microphone to the host • pending");
    expect(echo().getAttribute("data-disabled")).toBe("false");
  });
});
