import {
  ConfirmModal,
  DropdownItem,
  Field,
  PanelSection,
  PanelSectionRow,
  TextField,
  ToggleField,
  showModal
} from "@decky/ui";
import { FC, useEffect, useState, useSyncExternalStore } from "react";
import {
  SettingDescriptor,
  SettingValue,
  pyrolightIntegration
} from "../../lib/pyrolightintegration";
import { usePyrolight, usePyrolightSettings } from "../../hooks/usepyrolight";
import { ActionButton } from "../shared/actionbutton";
import { NetworkTools } from "./networktools";
import { NumericTextInput } from "../shared";
import { steamIntegrationStatus } from "../../lib/steamintegrationstatus";

const labels: Record<string, string> = {
  width: "Width (pixels)",
  height: "Height (pixels)",
  fps: "Frame rate (FPS)",
  bitrateKbps: "Bitrate (Kbps)",
  autoAdjustBitrate: "Automatic bitrate",
  unlockBitrate: "Override bitrate limit",
  enableVsync: "V-Sync",
  framePacing: "Frame pacing",
  videoCodecConfig: "Video codec",
  enableHdr: "HDR",
  enableYUV444: "YUV 4:4:4",
  windowMode: "Display mode",
  enableVrr: "VRR",
  vrrLatencyMode: "VRR latency preset",
  vrrBufferPerMille: "VRR buffer (thousandths of a frame)",
  vrrTargetHundredths: "On-time target (hundredths of percent)",
  vrrHistorySeconds: "Timing history (seconds)",
  vrrToleranceUs: "Timing tolerance (microseconds)",
  smoothVrrFrameTiming: "Reduce VRR judder",
  audioConfig: "Speaker configuration",
  audioQuality: "Audio quality",
  playAudioOnHost: "Play audio on host",
  muteOnFocusLoss: "Mute on focus loss",
  multiController: "Multiple controllers",
  absoluteMouseMode: "Absolute mouse",
  absoluteTouchMode: "Absolute touchscreen",
  gamepadMouse: "Gamepad mouse",
  swapMouseButtons: "Swap mouse buttons",
  backgroundGamepad: "Background controller input",
  reverseScrollDirection: "Reverse scrolling",
  swapFaceButtons: "Nintendo button layout",
  captureSysKeysMode: "Capture keyboard shortcuts",
  videoDecoderSelection: "Video decoder",
  rendererSelection: "Renderer (macOS)",
  packetSize: "Packet size (0 = automatic)",
  gameOptimizations: "Optimize games",
  quitAppAfter: "End host app after standalone sessions",
  showPerformanceOverlay: "Performance overlay",
  enableMdns: "Network discovery",
  detectNetworkBlocking: "Connection checks",
  connectionWarnings: "Connection warnings",
  configurationWarnings: "Configuration warnings",
  richPresence: "Discord presence",
  uiDisplayMode: "Standalone window mode",
  language: "Standalone language",
  keepAwake: "Keep display awake"
};
const choiceLabels: Record<string, string> = {
  AC_STEREO: "Stereo",
  AC_51_SURROUND: "5.1 surround",
  AC_71_SURROUND: "7.1 surround",
  VCC_AUTO: "Automatic",
  VCC_FORCE_H264: "H.264",
  VCC_FORCE_HEVC: "HEVC",
  VCC_FORCE_AV1: "AV1",
  VCC_FORCE_PYROWAVE: "PyroWave",
  WM_FULLSCREEN: "Fullscreen",
  WM_FULLSCREEN_DESKTOP: "Borderless",
  WM_WINDOWED: "Windowed",
  VDS_AUTO: "Automatic",
  VDS_FORCE_HARDWARE: "Hardware",
  VDS_FORCE_SOFTWARE: "Software"
};
function choiceLabel(value: string): string {
  return (
    choiceLabels[value] ??
    value
      .replace(/^[A-Z]+_/, "")
      .toLowerCase()
      .replace(/_/g, " ")
  );
}

export const SettingsFeedback: FC = () => {
  const state = usePyrolight();
  const count = Object.keys(state.pending).length;
  const active =
    state.session.runnerActive ??
    ["streaming", "connecting", "launching", "reconnecting"].includes(
      state.session.state
    );
  return (
    <>
      {(state.error || state.message) && (
        <PanelSection title={state.error ? "Action required" : "Settings"}>
          {state.error && (
            <PanelSectionRow>
              <Field label={state.error} />
            </PanelSectionRow>
          )}
          {state.message && (
            <PanelSectionRow>
              <Field description={state.message} />
            </PanelSectionRow>
          )}
        </PanelSection>
      )}
      {count > 0 && (
        <PanelSection title={`${count} pending setting${count > 1 ? "s" : ""}`}>
          <PanelSectionRow>
            <Field description="Draft saved in this menu. Apply when you are ready to reconnect; the host game stays open." />
          </PanelSectionRow>
          <PanelSectionRow>
            <ActionButton
              disabled={state.busy}
              onClick={() => {
                void pyrolightIntegration.apply(active);
              }}
            >
              {active ? "Apply & Reconnect" : "Save for Next Session"}
            </ActionButton>
          </PanelSectionRow>
          <PanelSectionRow>
            <ActionButton
              disabled={state.busy}
              onClick={() => {
                void pyrolightIntegration.discard();
              }}
            >
              Discard Changes
            </ActionButton>
          </PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
};

const SettingControl: FC<{ descriptor: SettingDescriptor }> = ({
  descriptor
}) => {
  const state = usePyrolightSettings();
  if (!state.preferences || descriptor.supported === false) return null;
  const values = { ...state.preferences.values, ...state.pending };
  const value = values[descriptor.key];
  const disabled =
    state.busy ||
    Boolean(descriptor.requires && !values[descriptor.requires]) ||
    Boolean(descriptor.disabledWhen && values[descriptor.disabledWhen]);
  const pending = Object.prototype.hasOwnProperty.call(
    state.pending,
    descriptor.key
  );
  const label = `${labels[descriptor.key] ?? descriptor.key}${pending ? " • pending" : ""}`;
  const help: Record<string, string> = {
    bitrateKbps: "1000 Kbps = 1 Mbps. Turn off Automatic bitrate to edit.",
    autoAdjustBitrate:
      "Let Pyrolight choose bitrate for this resolution and frame rate.",
    enableVrr:
      "Requires V-Sync and a compatible display. Advanced timing is in VRR Tuning.",
    enableYUV444: "Sharper text; requires host and decoder support.",
    quitAppAfter:
      "Applies to standalone Pyrolight. PyroDeck keeps host games open on disconnect.",
    packetSize:
      "0 uses the transport default. Change only for network troubleshooting."
  };
  const reason =
    descriptor.requires && !values[descriptor.requires] ?
      `Enable ${labels[descriptor.requires] ?? descriptor.requires} first.` :
      descriptor.disabledWhen && values[descriptor.disabledWhen] ?
        `Turn off ${labels[descriptor.disabledWhen] ?? descriptor.disabledWhen} to edit.` :
        "";
  const description = [
    reason || help[descriptor.key],
    descriptor.scope === "global" ? "Shared by all profiles." : "",
    pending ? `Saved: ${String(state.preferences.values[descriptor.key])}` : ""
  ]
    .filter(Boolean)
    .join(" ");
  const setValue = (newValue: SettingValue): void =>
    pyrolightIntegration.stage(descriptor.key, newValue);
  return (
    <PanelSectionRow>
      {descriptor.type === "boolean" ?
          (
            <ToggleField
              label={label}
              description={description}
              checked={Boolean(value)}
              disabled={disabled}
              onChange={setValue}
            />
          ) :
        descriptor.choices ?
            (
              <DropdownItem
                layout="below"
                label={label}
                description={description}
                disabled={disabled}
                selectedOption={value as number}
                rgOptions={descriptor.choices
                  .filter((choice) => choice.supported)
                  .map((choice) => ({
                    data: choice.value,
                    label: choiceLabel(choice.label)
                  }))}
                onChange={(choice) => setValue(choice.data as number)}
              />
            ) :
            (
              <Field label={label} description={description} childrenLayout="below">
                <NumericTextInput
                  value={value as number}
                  disabled={disabled}
                  min={descriptor.minimum}
                  max={descriptor.maximum}
                  setValue={setValue}
                />
              </Field>
            )}
    </PanelSectionRow>
  );
};

export const StreamingProfiles: FC = () => {
  const state = usePyrolightSettings();
  const [name, setName] = useState("");
  const [managing, setManaging] = useState(false);
  const prefs = state.preferences;
  if (!prefs) return null;
  const disabled = state.busy || Object.keys(state.pending).length > 0;
  return (
    <PanelSection title="Streaming Profiles">
      <PanelSectionRow>
        <DropdownItem
          label="Active profile"
          layout="below"
          description="Used for your next launch. A running stream keeps its current profile."
          disabled={disabled}
          rgOptions={prefs.profiles.map((profile) => ({
            data: profile.id,
            label: profile.name
          }))}
          selectedOption={prefs.activeProfileId}
          onChange={(choice) => {
            void pyrolightIntegration.activate(choice.data as string);
          }}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton onClick={() => setManaging(!managing)}>
          {managing ? "Close Profile Tools" : "Manage Profiles…"}
        </ActionButton>
      </PanelSectionRow>
      {managing && (
        <>
          <PanelSectionRow>
            <TextField
              label="New profile name"
              disabled={disabled}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </PanelSectionRow>
          {["create", "duplicate", "rename"].map((operation) => (
            <PanelSectionRow key={operation}>
              <ActionButton
                disabled={
                  disabled ||
                  !name.trim() ||
                  (operation === "rename" &&
                    prefs.activeProfileId === "default")
                }
                onClick={() => {
                  void pyrolightIntegration.profile(operation, name);
                }}
              >
                {operation === "create" ?
                  "Create Profile" :
                  operation === "duplicate" ?
                    "Duplicate Active Profile" :
                    "Rename Active Profile"}
              </ActionButton>
            </PanelSectionRow>
          ))}
          <PanelSectionRow>
            <ActionButton
              disabled={disabled || prefs.activeProfileId === "default"}
              onClick={() =>
                showModal(
                  <ConfirmModal
                    strTitle="Delete streaming profile?"
                    strDescription={`Delete ${prefs.activeProfileName}? Pyrolight will select Default.`}
                    onOK={() => {
                      void pyrolightIntegration.profile("delete");
                    }}
                  />
                )}
            >
              Delete Active Profile
            </ActionButton>
          </PanelSectionRow>
          <PanelSectionRow>
            <ActionButton
              disabled={disabled}
              onClick={() => {
                void pyrolightIntegration.profile("restore");
              }}
            >
              Restore Profile Defaults
            </ActionButton>
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
};

export const PyrolightSettings: FC<{ category?: string }> = ({ category }) => {
  const { preferences } = usePyrolightSettings();
  const integration = useSyncExternalStore(steamIntegrationStatus.subscribe, steamIntegrationStatus.getSnapshot);
  useEffect(() => {
    void pyrolightIntegration.refresh();
  }, []);
  if (!preferences)
    return (
      <>
        <PanelSection title="Pyrolight Settings">
          <PanelSectionRow>
            <Field
              label="Settings unavailable"
              description="Check the Pyrolight executable in Hosts & Pairing, then retry."
            />
          </PanelSectionRow>
        </PanelSection>
        <SettingsFeedback />
        <PanelSection>
          <PanelSectionRow>
            <ActionButton
              onClick={() => {
                void pyrolightIntegration.refresh();
              }}
            >
              Retry
            </ActionButton>
          </PanelSectionRow>
        </PanelSection>
      </>
    );
  const categories = [
    ...new Set(preferences.registry.map((descriptor) => descriptor.category))
  ];
  return (
    <>
      <SettingsFeedback />
      {(!category || category === "Streaming Profiles") && (
        <StreamingProfiles />
      )}
      {categories
        .filter((value) => !category || value === category)
        .map((value) => (
          <PanelSection title={value} key={value}>
            <PanelSectionRow>
              <Field description="Changes stay in your draft until you save or apply them." />
            </PanelSectionRow>
            {preferences.registry
              .filter((descriptor) => descriptor.category === value)
              .map((descriptor) => (
                <SettingControl key={descriptor.key} descriptor={descriptor} />
              ))}
          </PanelSection>
        ))}
      {category === "Connection & Diagnostics" && <NetworkTools />}
      {category === "Connection & Diagnostics" && (
        <PanelSection title="Diagnostics">
          <PanelSectionRow><Field label="Steam Library integration" description={integration.library} /></PanelSectionRow>
          <PanelSectionRow><Field label="Steam overlay integration" description={integration.overlay} /></PanelSectionRow>
          <PanelSectionRow>
            <Field
              label="PyroWave decoder"
              description={
                preferences.capabilities.pyrowave ?
                  "Available" :
                  "Unavailable in this Pyrolight build or device"
              }
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <Field
              label="Display capabilities"
              description="HDR, VRR, resolution and decoder compatibility are checked by Pyrolight on the streaming display at launch."
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <Field
              label="Performance"
              description="Enable the performance overlay for actual codec, decoder and frame timing. Remote performance metrics are not exposed by this API."
            />
          </PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
};
