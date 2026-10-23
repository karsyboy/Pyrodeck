import { FC, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  LibraryMount,
  SteamFiber,
  observeLibraryMount
} from "../lib/librarymount";
import {
  appDetailsClasses,
  basicAppDetailsSectionStylerClasses,
  getReactInstance,
  playSectionClasses
} from "@decky/ui";
import { MoonDeckContext } from "../contexts";
import { MoonDeckLaunchButtonAnchor } from "../components/moondecklaunchbutton";
import { createPortal } from "react-dom";
import { getAppStoreEx } from "../steam-utils/getAppStoreEx";
import { isAppTypeSupported } from "../lib/launchenv";
import { logger } from "../lib/logger";
import { routerHook } from "@decky/api";
import { skip } from "rxjs";
import { steamIntegrationStatus } from "../lib/steamintegrationstatus";
import { useCurrentSettings } from "../hooks/usecurrentsettings";
import { withLibraryContexts } from "../lib/librarycontext";

const mountMessages: Record<string, string> = {
  waiting_for_page: "Library route active; waiting for Steam's action panel",
  selectors_unavailable: "Steam's Library panel classes are unavailable",
  fiber_unavailable: "Library panel found; React owner is unavailable",
  page_identity_unavailable: "Library panel found; game identity is unavailable",
  focus_context_unavailable: "Library panel found; controller navigation context is unavailable",
  steam_input_unavailable: "Library panel found; Steam Input button is unavailable"
};

const LibraryActionPortal: FC = () => {
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const settings = useCurrentSettings();
  // Decky can render Steam's routes into a separate BrowserWindow. The
  // plugin's global document need not own the actual Library controls.
  const [ownerDocument, setOwnerDocument] = useState<Document | null>(null);
  const probe = useCallback((node: HTMLSpanElement | null) => {
    if (node) setOwnerDocument(node.ownerDocument);
  }, []);
  const [mount, setMount] = useState<LibraryMount | null>(null);
  useEffect(() => {
    if (!settings?.enableMoondeckShortcuts) {
      setMount(null);
      steamIntegrationStatus.update({
        libraryPhase: settings ? "disabled" : "loading_settings", currentAppId: null, eligibleHostIds: [],
        library: settings ?
          "Library streaming is disabled in Advanced Tools" :
          "Loading settings"
      });
      return;
    }
    if (!ownerDocument) return;
    logger.log("Library route mounted; observing its owning document");
    let previousReport = "";
    const stop = observeLibraryMount({
      document: ownerDocument,
      classes: [
        basicAppDetailsSectionStylerClasses?.PlaySection,
        appDetailsClasses?.AppDetailsOverviewPanel
      ],
      focusClass: basicAppDetailsSectionStylerClasses?.AppButtons,
      beforeClass: playSectionClasses?.ControllerConfigButton,
      navigationRequired: true,
      subscribe: (refresh) => {
        const subscription = moonDeckAppLauncher.moonDeckApp.asObservable().pipe(skip(1)).subscribe(refresh);
        return () => subscription.unsubscribe();
      },
      diagnostic: (report) => {
        const signature = JSON.stringify(report);
        if (signature === previousReport) return;
        previousReport = signature;
        steamIntegrationStatus.update({ libraryDetails: signature });
        logger.log("Library mount diagnostic:", signature);
      },
      fiber: (element) => getReactInstance(element) as SteamFiber | null,
      status: (libraryPhase, currentAppId) => steamIntegrationStatus.update({
        libraryPhase, currentAppId,
        ...(libraryPhase !== "attached" ? { library: mountMessages[libraryPhase] ?? libraryPhase } : {}),
        ...(steamIntegrationStatus.getSnapshot().currentAppId !== currentAppId ? { eligibleHostIds: [] } : {})
      }),
      lookup: (id) => getAppStoreEx()?.getAppOverview(id),
      supported: (game) => isAppTypeSupported(game.appType),
      change: (value) => {
        setMount(value);
        if (value) {
          steamIntegrationStatus.update({ library: `Attached to ${value.game.appName}` });
          logger.log(
            `Library streaming action attached: ${value.game.appName} (${value.game.appId})`
          );
        }
      }
    });
    return () => {
      stop();
      if (steamIntegrationStatus.getSnapshot().libraryPhase !== "unregistered")
        steamIntegrationStatus.update({
          libraryPhase: "route_registered", library: "Open a game's Library page",
          libraryDetails: undefined, currentAppId: null, eligibleHostIds: []
        });
    };
  }, [settings?.enableMoondeckShortcuts, ownerDocument, moonDeckAppLauncher]);
  return (
    <>
      <span ref={probe} hidden data-pyrodeck-library-probe="true" />
      {mount ?
          createPortal(
            withLibraryContexts(mount.contexts, <MoonDeckLaunchButtonAnchor key={mount.game.appId} {...mount.game} />),
            mount.container
          ) :
        null}
    </>
  );
};

export const libraryRoute = "/library/app/:appid";

export function LibraryAppHook(): () => void {
  if (typeof routerHook.addPatch !== "function") {
    steamIntegrationStatus.update({ libraryPhase: "api_unavailable", library: "Decky route API is unavailable" });
    logger.error("Library route API is unavailable");
    return () => {};
  }
  // Wrap the supported route children directly. No Steam renderFunc/Fiber
  // component patch is required, and the action has the route's lifetime.
  const patch = routerHook.addPatch(libraryRoute, (route: { children?: ReactNode }) => ({
    ...route,
    children: (
      <>
        {route.children}
        <LibraryActionPortal />
      </>
    )
  }));
  logger.log(`Library route adapter registered: ${libraryRoute}`);
  steamIntegrationStatus.update({
    libraryPhase: "route_registered", library: "Open a game's Library page",
    libraryDetails: undefined, currentAppId: null, eligibleHostIds: []
  });
  return () => {
    routerHook.removePatch(libraryRoute, patch);
    logger.log("Library route adapter unregistered");
    steamIntegrationStatus.update({
      libraryPhase: "unregistered", library: "Library integration stopped",
      libraryDetails: undefined, currentAppId: null, eligibleHostIds: []
    });
  };
}
