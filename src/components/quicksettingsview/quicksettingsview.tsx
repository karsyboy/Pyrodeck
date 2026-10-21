import { useCurrentHostSettings, useCurrentSettings, useHostInfo, useMoonDeckAppData, useServerStatus } from "../../hooks";
import { ExternalAppsPanel } from "./externalappspanel";
import { FC } from "react";
import { GameSessionPanel } from "./gamesessionpanel";
import { HostControlPanel } from "./hostcontrolpanel";
import { HostStatusPanel } from "./hoststatuspanel";
import { ResolutionPanel } from "./resolutionpanel";
import { useQuickAccessVisible } from "@decky/api";

export const QuickSettingsView: FC = () => {
  const isVisible = useQuickAccessVisible();
  const [serverStatus, serverRefreshStatus] = useServerStatus(isVisible);
  const hostInfo = useHostInfo();
  const currentHostSettings = useCurrentHostSettings();
  const currentSettings = useCurrentSettings();
  const appData = useMoonDeckAppData();

  return (
    <>
      {appData !== null ?
          <GameSessionPanel appData={appData} /> :
          <>
            <HostStatusPanel currentHostSettings={currentHostSettings} currentSettings={currentSettings} serverStatus={serverStatus} serverRefreshStatus={serverRefreshStatus} hostInfo={hostInfo} />
            <ExternalAppsPanel currentHostSettings={currentHostSettings} />
            <ResolutionPanel currentHostSettings={currentHostSettings} currentSettings={currentSettings} />
          </>}
      {
        currentHostSettings !== null &&
        <HostControlPanel serverStatus={serverStatus} hostInfo={hostInfo} currentHostSettings={currentHostSettings} />
      }
    </>
  );
};
