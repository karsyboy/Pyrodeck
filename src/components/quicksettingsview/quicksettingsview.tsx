import { ButtonItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FC, useEffect, useState } from "react";
import {
  PyrolightSettings,
  SettingsFeedback
} from "../pyrolightsettings/settings";
import {
  useCurrentHostSettings,
  useCurrentSettings,
  useHostInfo,
  useServerStatus
} from "../../hooks";
import { HostStatusPanel } from "./hoststatuspanel";
import { RemoteGames } from "../remotegames/remotegames";
import { SessionControls } from "./sessioncontrols";
import { pyrolightIntegration } from "../../lib/pyrolightintegration";
import { usePyrolight } from "../../hooks/usepyrolight";
import { useQuickAccessVisible } from "@decky/api";

const pages = [
  "Streaming Profiles",
  "Video & Display",
  "Audio",
  "Controller & Input",
  "Advanced Streaming",
  "VRR Advanced",
  "Connection & Diagnostics",
  "Session Controls",
  "Remote Games"
];
export const QuickSettingsView: FC = () => {
  const visible = useQuickAccessVisible();
  const [page, setPage] = useState<string | null>(null);
  const [serverStatus, serverRefreshStatus] = useServerStatus(visible);
  const hostInfo = useHostInfo();
  const currentHostSettings = useCurrentHostSettings();
  const currentSettings = useCurrentSettings();
  const state = usePyrolight();
  useEffect(() => {
    if (!visible) return;
    void pyrolightIntegration.refresh();
    const timer = setInterval(() => {
      void pyrolightIntegration.refreshSession();
    }, 2000);
    return () => clearInterval(timer);
  }, [visible]);
  const prefs = state.session.effectivePreferences ?? state.preferences;
  if (page)
    return (
      <>
        <PanelSection>
          <PanelSectionRow>
            <ButtonItem onClick={() => setPage(null)}>‹ PyroDeck</ButtonItem>
          </PanelSectionRow>
        </PanelSection>
        {page === "Session Controls" ?
            (
              <>
                <SettingsFeedback />
                <SessionControls />
              </>
            ) :
          page === "Remote Games" ?
              (
                <RemoteGames />
              ) :
              (
                <PyrolightSettings category={page} />
              )}
      </>
    );
  return (
    <>
      <HostStatusPanel
        currentHostSettings={currentHostSettings}
        currentSettings={currentSettings}
        serverStatus={serverStatus}
        serverRefreshStatus={serverRefreshStatus}
        hostInfo={hostInfo}
      />
      <PanelSection title="Streaming">
        <PanelSectionRow>
          <Field
            label={
              state.session.hostName ??
              currentHostSettings?.hostName ??
              "Select a host"
            }
            description={`${state.session.appName ?? "No active game"} · ${state.session.state}${state.session.quality ? ` · Connection: ${state.session.quality}` : ""}`}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label={`Profile: ${state.preferences?.activeProfileName ?? "Loading…"}`}
            description={
              prefs ?
                `${prefs.values.width} × ${prefs.values.height} · ${prefs.values.fps} FPS · ${prefs.values.bitrateKbps} Kbps requested${state.session.effectivePreferences ? ` · Stream profile: ${state.session.effectivePreferences.activeProfileName}` : ""}` :
                "Install a current Pyrolight build to read streaming preferences."
            }
          />
        </PanelSectionRow>
        {state.session.diagnostics && <PanelSectionRow><Field label={`Codec: ${state.session.diagnostics.codec}`} description={`${state.session.diagnostics.width} × ${state.session.diagnostics.height} · ${state.session.diagnostics.negotiatedFps} FPS negotiated · ${state.session.diagnostics.bitrateKbps} Kbps · ${state.session.displayBackend ?? state.session.diagnostics.displayDriver}`} /></PanelSectionRow>}
      </PanelSection>
      <SettingsFeedback />
      <PanelSection title="Quick Access">
        {pages.map((name) => (
          <PanelSectionRow key={name}>
            <ButtonItem onClick={() => setPage(name)}>{name}</ButtonItem>
          </PanelSectionRow>
        ))}
      </PanelSection>
    </>
  );
};
