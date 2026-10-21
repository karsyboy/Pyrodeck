import { ButtonStyleView } from "../components/buttonstyleview";
import { ChangelogView } from "../components/changelogview";
import { FC } from "react";
import { GameSessionView } from "../components/gamesessionview";
import { GameStreamAppsView } from "../components/gamestreamappsview";
import { HostInfoView } from "../components/hostinfoview";
import { HostSelectionView } from "../components/hostselectionview";
import { MoonDeckAppsView } from "../components/moondeckappsview";
import { MoonlightSettingsView } from "../components/moonlightsettingsview";
import { RunnerSettingsView } from "../components/runnersettingsview";
import { SetupGuideView } from "../components/setupguideview";
import { SidebarNavigation } from "@decky/ui";
import { StatusIndicatorsView } from "../components/statusindicatorsview";
import { WOLSettingsView } from "../components/wolsettingsview";
import { routerHook } from "@decky/api";

const MoonDeckRouter: FC<object> = () => {
  return (
    <SidebarNavigation
      pages={[
        {
          title: "Setup Guide",
          content: <SetupGuideView />,
          route: "/pyrodeck/setup-guide",
          visible: true
        },
        {
          title: "Status Indicators",
          content: <StatusIndicatorsView />,
          route: "/pyrodeck/status-indicators",
          visible: true
        },
        {
          title: "Changelog",
          content: <ChangelogView />,
          route: "/pyrodeck/changelog",
          visible: true
        },
        "separator",
        {
          title: "Host Selection",
          content: <HostSelectionView />,
          route: "/pyrodeck/host-selection",
          visible: true
        },
        {
          title: "Host Info",
          content: <HostInfoView />,
          route: "/pyrodeck/host-info",
          visible: true
        },
        "separator",
        {
          title: "Pyrolight Settings",
          content: <MoonlightSettingsView />,
          route: "/pyrodeck/resolution-settings",
          visible: true
        },
        {
          title: "Runner Settings",
          content: <RunnerSettingsView />,
          route: "/pyrodeck/runner-settings",
          visible: true
        },
        {
          title: "WOL Settings",
          content: <WOLSettingsView />,
          route: "/pyrodeck/wol-settings",
          visible: true
        },
        "separator",
        {
          title: "Library Shortcuts",
          content: <MoonDeckAppsView />,
          route: "/pyrodeck/moondeck-apps",
          visible: true
        },
        {
          title: "Host Apps",
          content: <GameStreamAppsView />,
          route: "/pyrodeck/gamestream-apps",
          visible: true
        },
        "separator",
        {
          title: "Game Session",
          content: <GameSessionView />,
          route: "/pyrodeck/game-session",
          visible: true
        },
        {
          title: "Button Style",
          content: <ButtonStyleView />,
          route: "/pyrodeck/button-style",
          visible: true
        }
      ]}
    />
  );
};

export function MoonDeckRouterHook(): () => void {
  routerHook.addRoute("/pyrodeck", () => <MoonDeckRouter />);
  return () => {
    routerHook.removeRoute("/pyrodeck");
  };
}
