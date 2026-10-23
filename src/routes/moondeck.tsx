import { DialogBody, DropdownItem, SidebarNavigation } from "@decky/ui";
import { FC, useState } from "react";
import { Diagnostics } from "../components/diagnostics/diagnostics";
import { GameSessionView } from "../components/gamesessionview";
import { GameStreamAppsView } from "../components/gamestreamappsview";
import { HostInfoView } from "../components/hostinfoview";
import { HostSelectionView } from "../components/hostselectionview";
import { MoonDeckAppsView } from "../components/moondeckappsview";
import { PyrolightSettings } from "../components/pyrolightsettings/settings";
import { RemoteGames } from "../components/remotegames/remotegames";
import { RunnerSettingsView } from "../components/runnersettingsview";
import { SessionControls } from "../components/quicksettingsview/sessioncontrols";
import { SetupGuideView } from "../components/setupguideview";
import { WOLSettingsView } from "../components/wolsettingsview";
import { routerHook } from "@decky/api";
import { settingsCategories } from "../components/pyrolightsettings/categories";

const AdvancedTools: FC = () => {
  const [tool, setTool] = useState("runner");
  return (
    <>
      <DialogBody>
        <DropdownItem
          label="Advanced tool"
          layout="below"
          selectedOption={tool}
          rgOptions={[
            { data: "runner", label: "Launcher options" },
            { data: "session", label: "Session behavior" },
            { data: "cleanup", label: "Legacy shortcut cleanup" },
            { data: "shortcuts", label: "Optional host shortcut sync" }
          ]}
          onChange={(choice) => setTool(choice.data as string)}
        />
      </DialogBody>
      {tool === "runner" ?
          (
            <RunnerSettingsView />
          ) :
        tool === "session" ?
            (
              <GameSessionView />
            ) :
          tool === "cleanup" ?
              (
                <MoonDeckAppsView />
              ) :
              (
                <GameStreamAppsView />
              )}
    </>
  );
};

const MoonDeckRouter: FC<object> = () => (
  <SidebarNavigation
    pages={[
      {
        title: "Remote Games",
        content: (
          <DialogBody>
            <RemoteGames />
          </DialogBody>
        ),
        route: "/pyrodeck/remote-games",
        visible: true
      },
      {
        title: "Hosts & Pairing",
        content: <HostSelectionView />,
        route: "/pyrodeck/host-selection",
        visible: true
      },
      {
        title: "Session",
        content: (
          <DialogBody>
            <SessionControls />
          </DialogBody>
        ),
        route: "/pyrodeck/session",
        visible: true
      },
      "separator",
      ...settingsCategories.map(({ category, title }, index) => ({
        title,
        content: (
          <DialogBody>
            <PyrolightSettings category={category} />
          </DialogBody>
        ),
        // Preserve the old settings bookmark as the entry into profile settings.
        route:
          index === 0 ?
            "/pyrodeck/resolution-settings" :
            `/pyrodeck/settings/${index}`,
        visible: true
      })),
      "separator",
      { title: "Troubleshooting & Diagnostics", content: <DialogBody><Diagnostics /></DialogBody>, route: "/pyrodeck/diagnostics", visible: true },
      {
        title: "Setup & Help",
        content: <SetupGuideView />,
        route: "/pyrodeck/setup-guide",
        visible: true
      },
      {
        title: "Host Details",
        content: <HostInfoView />,
        route: "/pyrodeck/host-info",
        visible: true
      },
      {
        title: "Wake on LAN",
        content: <WOLSettingsView />,
        route: "/pyrodeck/wol-settings",
        visible: true
      },
      {
        title: "Advanced Tools",
        content: <AdvancedTools />,
        route: "/pyrodeck/advanced-tools",
        visible: true
      }
    ]}
  />
);

export function MoonDeckRouterHook(): () => void {
  routerHook.addRoute("/pyrodeck", () => <MoonDeckRouter />);
  return () => {
    routerHook.removeRoute("/pyrodeck");
  };
}
