import { ButtonItem, ConfirmModal, DropdownItem, Field, PanelSection, PanelSectionRow, TextField, ToggleField, showModal } from "@decky/ui";
import { FC, useEffect, useState } from "react";
import { SettingDescriptor, SettingValue, pyrolightIntegration } from "../../lib/pyrolightintegration";
import { NetworkTools } from "./networktools";
import { NumericTextInput } from "../shared";
import { usePyrolight } from "../../hooks/usepyrolight";

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
  const active = state.session.runnerActive ?? ["streaming", "connecting", "launching", "reconnecting"].includes(state.session.state);
  return (
    <>
      {state.error && (
        <PanelSectionRow>
          <Field label="Action required" description={state.error} />
        </PanelSectionRow>
      )}
      {state.message && (
        <PanelSectionRow>
          <Field description={state.message} />
        </PanelSectionRow>
      )}
      {count > 0 && (
        <PanelSection title={`${count} pending setting${count > 1 ? "s" : ""}`}>
          <PanelSectionRow>
            <Field description="Your draft is kept when Quick Access closes. The running stream keeps its current settings until you explicitly reconnect." />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              disabled={state.busy}
              onClick={() => {
                void pyrolightIntegration.apply(active);
              }}
            >
              {active ? "Apply & Reconnect" : "Save for Next Session"}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              disabled={state.busy}
              onClick={() => {
                void pyrolightIntegration.discard();
              }}
            >
              Discard Draft & Refresh
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
};

const SettingControl: FC<{ descriptor: SettingDescriptor }> = ({
  descriptor
}) => {
  const state = usePyrolight();
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
  const description = `${descriptor.scope === "global" ? "All profiles" : "Active profile"} · Reconnect required${pending ? ` · Saved: ${String(state.preferences.values[descriptor.key])}` : ""}${descriptor.key === "quitAppAfter" ? ". PyroDeck always preserves host games on disconnect." : ""}`;
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
  const state = usePyrolight();
  const [name, setName] = useState("");
  const prefs = state.preferences;
  if (!prefs) return null;
  const disabled = state.busy || Object.keys(state.pending).length > 0;
  return (
    <PanelSection title="Streaming Profiles">
      <PanelSectionRow>
        <DropdownItem
          label="Active Pyrolight profile"
          description="One manually selected profile. Running streams retain their launch settings."
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
        <TextField
          label="Profile name"
          disabled={disabled}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </PanelSectionRow>
      {["create", "duplicate", "rename"].map((operation) => (
        <PanelSectionRow key={operation}>
          <ButtonItem
            disabled={
              disabled ||
              !name.trim() ||
              (operation === "rename" && prefs.activeProfileId === "default")
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
          </ButtonItem>
        </PanelSectionRow>
      ))}
      <PanelSectionRow>
        <ButtonItem
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
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          disabled={disabled}
          onClick={() => {
            void pyrolightIntegration.profile("restore");
          }}
        >
          Restore Profile Defaults
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

export const PyrolightSettings: FC<{ category?: string }> = ({ category }) => {
  const { preferences } = usePyrolight();
  useEffect(() => {
    void pyrolightIntegration.refresh();
  }, []);
  if (!preferences)
    return (
      <>
        <Field
          label="Pyrolight settings"
          description="Reading the Pyrolight settings owner…"
        />
        <SettingsFeedback />
        <ButtonItem
          onClick={() => {
            void pyrolightIntegration.refresh();
          }}
        >
          Retry
        </ButtonItem>
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
