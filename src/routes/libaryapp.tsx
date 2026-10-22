import { FC, useEffect, useState } from "react";
import {
  LibraryMount,
  SteamFiber,
  observeLibraryMount
} from "../lib/librarymount";
import {
  appDetailsClasses,
  basicAppDetailsSectionStylerClasses,
  getReactInstance
} from "@decky/ui";
import { MoonDeckLaunchButtonAnchor } from "../components/moondecklaunchbutton";
import { createPortal } from "react-dom";
import { getAppStoreEx } from "../steam-utils/getAppStoreEx";
import { isAppTypeSupported } from "../lib/launchenv";
import { logger } from "../lib/logger";
import { routerHook } from "@decky/api";
import { steamIntegrationStatus } from "../lib/steamintegrationstatus";
import { useCurrentSettings } from "../hooks/usecurrentsettings";

const LibraryActionPortal: FC = () => {
  const settings = useCurrentSettings();
  const [mount, setMount] = useState<LibraryMount | null>(null);
  useEffect(() => {
    if (!settings?.enableMoondeckShortcuts) {
      steamIntegrationStatus.update({
        library: settings ?
          "Library streaming is disabled in Advanced Tools" :
          "Loading settings"
      });
      return;
    }
    return observeLibraryMount({
      document,
      classes: [
        appDetailsClasses.AppDetailsOverviewPanel,
        basicAppDetailsSectionStylerClasses.PlaySection
      ],
      fiber: (element) => getReactInstance(element) as SteamFiber | null,
      lookup: (id) => getAppStoreEx()?.getAppOverview(id),
      supported: (game) => isAppTypeSupported(game.appType),
      change: (value) => {
        setMount(value);
        steamIntegrationStatus.update({
          library: value ?
            `Attached to ${value.game.appName}` :
            "Waiting for a Library page"
        });
        if (value)
          logger.log(
            `Library streaming action attached: ${value.game.appName} (${value.game.appId})`
          );
      }
    });
  }, [settings?.enableMoondeckShortcuts]);
  return mount ?
      createPortal(
        <MoonDeckLaunchButtonAnchor {...mount.game} />,
        mount.container
      ) :
    null;
};

export function LibraryAppHook(): () => void {
  routerHook.addGlobalComponent("PyroDeckLibraryAction", LibraryActionPortal);
  return () => {
    routerHook.removeGlobalComponent("PyroDeckLibraryAction");
  };
}
