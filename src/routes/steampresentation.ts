import { Router, afterPatch, beforePatch } from "@decky/ui";
import { getDefaultContext } from "../contexts";
import { installSteamPresentation } from "../lib/steampresentation";
import { logger } from "../lib/logger";
import { steamIntegrationStatus } from "../lib/steamintegrationstatus";

export function SteamPresentationHook(): () => void {
  const { moonDeckAppLauncher } = getDefaultContext();
  const globals = window as unknown as {
    appStore?: Record<string, unknown>;
    appDetailsStore?: Record<string, unknown>;
  };
  if (!globals.appStore) {
    steamIntegrationStatus.update({ overlay: "Steam app store unavailable" });
    return () => {};
  }
  try {
    const bridge = installSteamPresentation({
      appStore: globals.appStore,
      details: globals.appDetailsStore,
      router: Router as unknown as Record<string, unknown>,
      systemUI: SteamClient.System.UI as unknown as Record<string, unknown>,
      session: () => {
        const current = moonDeckAppLauncher.moonDeckApp.value;
        return current?.moonDeckAppId &&
          !moonDeckAppLauncher.moonDeckApp.closing ?
            {
              helperAppId: current.moonDeckAppId,
              steamAppId: current.steamAppId,
              gameId: current.launcherGameId
            } :
          null;
      },
      hooks: {
        after: (target, key, handler) => {
          const patch = afterPatch(target, key, handler);
          return () => patch.unpatch();
        },
        before: (target, key, handler) => {
          const patch = beforePatch(target, key, handler);
          return () => patch.unpatch();
        }
      },
      status: (overlay) => steamIntegrationStatus.update({ overlay })
    });
    const subscription = moonDeckAppLauncher.moonDeckApp
      .asObservable()
      .subscribe(() => bridge.refresh());
    return () => {
      subscription.unsubscribe();
      bridge.stop();
    };
  } catch (error) {
    logger.error("Steam overlay adapter could not attach", error);
    steamIntegrationStatus.update({
      overlay: "Adapter could not attach; check frontend log"
    });
    return () => {};
  }
}
