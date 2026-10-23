import { getAllNonSteamAppDetails, logger, registerForLoginStateChange, waitForServicesInitialized } from "./lib";
import { MoonDeckMain } from "./components/icons";
import { QuickSettingsView } from "./components/quicksettingsview/quicksettingsview";
import { RouteManager } from "./routes";
import { TitleView } from "./components/titleview";
import { definePlugin } from "@decky/api";
import { getDefaultContext } from "./contexts";
import { sleep } from "@decky/ui";
import { startPlugin } from "./lib/pluginstartup";

export default definePlugin(() => {
  const { moonDeckAppShortcuts, externalAppShortcuts, settingsManager, connectivityManager, moonDeckAppLauncher } = getDefaultContext(true);
  const routeManager = new RouteManager();

  let generation = 0;
  const initCallback = async (username: string): Promise<void> => {
    const current = ++generation;
    logger.log(`Initializing plugin for ${username}`);
    await startPlugin({
      ready: waitForServicesInitialized,
      cancelled: () => current !== generation,
      startNative: () => {
        settingsManager.init();
        connectivityManager.init();
        moonDeckAppLauncher.init([]);
        routeManager.init();
      },
      discover: getAllNonSteamAppDetails,
      startShortcuts: (details) => {
        externalAppShortcuts.init(details);
        moonDeckAppShortcuts.init(details);
        moonDeckAppLauncher.discoverShortcuts(details);
      },
      retry: async () => {
        logger.warn("Shortcut discovery unavailable; Library streaming remains enabled. Retrying in 5 seconds.");
        await sleep(5000);
      }
    });
  };
  const deinitCallback = (): void => {
    logger.log("Deinitializing plugin");
    generation++;
    routeManager.deinit();
    moonDeckAppLauncher.deinit();
    connectivityManager.deinit();
    settingsManager.deinit();
    moonDeckAppShortcuts.deinit();
    externalAppShortcuts.deinit();
  };
  const unregister = registerForLoginStateChange(
    (username) => { initCallback(username).catch((e) => logger.critical(e)); },
    deinitCallback
  );

  return {
    name: "PyroDeck",
    icon: <MoonDeckMain />,
    content: <QuickSettingsView />,
    onDismount() {
      unregister();
      deinitCallback();
    },
    alwaysRender: true,
    titleView: <TitleView />
  };
});
