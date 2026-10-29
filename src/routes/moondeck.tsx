import { DialogBody, SidebarNavigation } from "@decky/ui";
import { AdvancedView } from "../components/advancedview";
import { Diagnostics } from "../components/diagnostics/diagnostics";
import { FC } from "react";
import { HostInfoView } from "../components/hostinfoview";
import { HostSelectionView } from "../components/hostselectionview";
import { PyrolightSettings } from "../components/pyrolightsettings/settings";
import { RemoteGames } from "../components/remotegames/remotegames";
import { SessionControls } from "../components/quicksettingsview/sessioncontrols";
import { SetupGuideView } from "../components/setupguideview";
import { UpdatesView } from "../components/updatesview/updatesview";
import { WOLSettingsView } from "../components/wolsettingsview";
import { routerHook } from "@decky/api";
import { settingsCategories } from "../components/pyrolightsettings/categories";

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
      {
        title: "Hosts & Pairing",
        content: <HostSelectionView />,
        route: "/pyrodeck/host-selection",
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
      {
        title: "Updates",
        content: <UpdatesView />,
        route: "/pyrodeck/updates",
        visible: true
      },
      {
        title: "Advanced Tools",
        content: <AdvancedView />,
        route: "/pyrodeck/advanced-tools",
        visible: true
      },
      { title: "Troubleshooting & Diagnostics", content: <DialogBody><Diagnostics /></DialogBody>, route: "/pyrodeck/diagnostics", visible: true },
      {
        title: "Setup & Help",
        content: <SetupGuideView />,
        route: "/pyrodeck/setup-guide",
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
