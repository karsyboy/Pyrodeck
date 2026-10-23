import { FC, useEffect, useState } from "react";
import { Field, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import {
  PyrolightSettings,
  SettingsFeedback
} from "../pyrolightsettings/settings";
import { PyrolightViewVisibility, usePyrolight, useSessionPolling } from "../../hooks/usepyrolight";
import {
  useCurrentHostSettings,
  useCurrentSettings,
  useHostInfo,
  useServerStatus
} from "../../hooks";
import { ActionButton } from "../shared/actionbutton";
import { Diagnostics } from "../diagnostics/diagnostics";
import { HostStatusPanel } from "./hoststatuspanel";
import { RemoteGames } from "../remotegames/remotegames";
import { SessionControls } from "./sessioncontrols";
import { pyrolightIntegration } from "../../lib/pyrolightintegration";
import { settingsCategories } from "../pyrolightsettings/categories";
import { useQuickAccessVisible } from "@decky/api";

export const QuickSettingsView: FC = () => {
  const visible = useQuickAccessVisible();
  return <PyrolightViewVisibility.Provider value={visible}><QuickSettingsContent visible={visible} /></PyrolightViewVisibility.Provider>;
};

const QuickSettingsContent: FC<{ visible: boolean }> = ({ visible }) => {
  const [page, setPage] = useState<string | null>(null);
  const [serverStatus, serverRefreshStatus] = useServerStatus(visible);
  const hostInfo = useHostInfo();
  const currentHostSettings = useCurrentHostSettings();
  const currentSettings = useCurrentSettings();
  const state = usePyrolight(visible && page === null);
  useSessionPolling(visible);
  useEffect(() => {
    if (!visible) return;
    void pyrolightIntegration.refresh();
  }, [visible]);
  // The visibility provider pauses session subscriptions/polling in retained
  // subpages. Local search/profile UI state and the central draft survive QAM.
  if (page)
    return (
      <Focusable
        onCancelActionDescription="Back to PyroDeck"
        onCancelButton={visible ?
            (event) => {
              // Handle bubbling Back only after child controls (dropdowns,
              // dialogs) have had a chance to consume it themselves.
              event.preventDefault();
              event.stopPropagation();
              setPage(null);
            } :
          undefined}
      >
        <PanelSection>
          <PanelSectionRow>
            <ActionButton onClick={() => setPage(null)}>
              ‹ Back to PyroDeck
            </ActionButton>
          </PanelSectionRow>
        </PanelSection>
        {page === "Troubleshooting & Diagnostics" ?
            <Diagnostics /> :
          page === "Session" ?
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
      </Focusable>
    );
  const prefs = state.session.effectivePreferences ?? state.preferences;
  return (
    <>
      <HostStatusPanel
        currentHostSettings={currentHostSettings}
        currentSettings={currentSettings}
        serverStatus={serverStatus}
        serverRefreshStatus={serverRefreshStatus}
        hostInfo={hostInfo}
      />
      <PanelSection title="Play">
        <PanelSectionRow>
          <ActionButton onClick={() => setPage("Remote Games")}>
            Browse Remote Games
          </ActionButton>
        </PanelSectionRow>
        <PanelSectionRow>
          <ActionButton onClick={() => setPage("Session")}>
            Session Controls
          </ActionButton>
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label={state.session.appName ?? "Ready to stream"}
            description={
              state.session.appName ?
                `${state.session.hostName ?? "Host"} · ${state.session.state}${state.session.quality ? ` · Connection ${state.session.quality}` : ""}` :
                "Launch from your Steam Library or browse remote games."
            }
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection><PanelSectionRow><ActionButton onClick={() => setPage("Troubleshooting & Diagnostics")}>Troubleshooting & Diagnostics</ActionButton></PanelSectionRow></PanelSection>
      <SettingsFeedback />
      <PanelSection title="Streaming Settings">
        <PanelSectionRow>
          <Field
            label={`Profile: ${state.preferences?.activeProfileName ?? "Loading…"}`}
            description={
              prefs ?
                `${prefs.values.width} × ${prefs.values.height} · ${prefs.values.fps} FPS · ${Number(prefs.values.bitrateKbps) / 1000} Mbps${state.session.effectivePreferences ? ` · Playing with ${prefs.activeProfileName}` : ""}` :
                "Open settings to check the Pyrolight executable."
            }
          />
        </PanelSectionRow>
        {settingsCategories.map(({ category, title }) => (
          <PanelSectionRow key={category}>
            <ActionButton onClick={() => setPage(category)}>
              <span
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "left"
                }}
              >
                <span>{title}</span>
                <span aria-hidden="true">›</span>
              </span>
            </ActionButton>
          </PanelSectionRow>
        ))}
      </PanelSection>
    </>
  );
};
