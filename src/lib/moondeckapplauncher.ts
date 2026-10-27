import {
  AppStartResult,
  AppType,
  ControllerConfigOption,
  EnvVars,
  addShortcut,
  checkExecPathMatch,
  getAppDetails,
  getAppStoreEx,
  getAudioDevices,
  getCurrentDisplayModeString,
  getDisplayIdentifiers,
  getGameId,
  getMoonDeckRunPath,
  getSystemNetworkStore,
  isMoonDeckShortcut,
  launchApp,
  registerForGameLaunchIntercept,
  registerForGameLifetime,
  registerForStreamExit,
  registerForSuspendNotifications,
  removeShortcut,
  setAppHiddenState,
  setAppLaunchOptions,
  setAppResolutionOverride,
  setOverrideResolutionForInternalDisplay,
  setShortcutName
} from "./steamutils";
import {
  ControllerConfigValues,
  Dimension,
  HostResolution,
  HostSettings,
  SettingsManager
} from "./settingsmanager";
import {
  LaunchContext,
  UtilityAction,
  getLaunchOptionsString
} from "./launchenv";
import { SessionStatus, pyrolightIntegration } from "./pyrolightintegration";
import { Subscription, pairwise } from "rxjs";
import { getEnvKeyValueNumber, makeEnvKeyValue } from "./envutils";
import { AppDetails } from "@decky/ui/dist/globals/steam-client/App";
import { AppSyncState } from "./appsyncstate";
import { EThirdPartyControllerConfiguration } from "@decky/ui/dist/globals/steam-client/Input";
import { ExternalAppShortcuts } from "./externalappshortcuts";
import { MoonDeckAppProxy } from "./moondeckapp";
import { MoonDeckAppShortcuts } from "./moondeckappshortcuts";
import { Mutex } from "async-mutex";
import { call } from "@decky/api";
import { confirmStreamSwitch } from "./confirmswitch";
import { executeAsync } from "./executeasync";
import { logger } from "./logger";
import { steamIntegrationStatus } from "./steamintegrationstatus";

async function setRunnerReady(): Promise<void> {
  try {
    await call("set_runner_ready");
  } catch (message) {
    logger.critical("Error while setting runner ready state: ", message);
    throw new Error("The PyroDeck backend could not prepare the runner");
  }
}

function getCustomDimension(
  display: string | null,
  hostResolution: Readonly<HostResolution>
): string | null {
  const dimensions = hostResolution.dimensions;
  const stringify = (dimension: Dimension): string => {
    return `${dimension.width}x${dimension.height}`;
  };

  if (display !== null) {
    for (const dimension of dimensions) {
      if (dimension.linkedDisplays.includes(display)) {
        return stringify(dimension);
      }
    }
  }
  if (hostResolution.useCustomDimensions) {
    const index = hostResolution.selectedDimensionIndex;
    if (index >= 0 && index < dimensions.length) {
      const dimension = dimensions[index];
      return stringify(dimension);
    }
    logger.error("Dimension index out of range!");
  }
  return null;
}

function getSelectedAppResolution(mode: string | null, display: string | null, hostSettings: Readonly<HostSettings>): string {
  const customDimension = getCustomDimension(display, hostSettings.resolution);
  switch (hostSettings.resolution.appResolutionOverride) {
    case "CustomResolution":
      if (customDimension) {
        return customDimension;
      }
    // fallthrough
    case "DisplayResolution":
      if (mode) {
        return mode;
      }
    // fallthrough
    case "Native":
      return "Native";
    default:
      return "Default";
  }
}

export function updateControllerConfig(
  appId: number,
  controllerConfig: keyof typeof ControllerConfigValues | null
): void {
  if (controllerConfig !== null) {
    logger.log(
      `Setting controller config to ${controllerConfig} for ${appId}.`
    );
    const option = ControllerConfigOption[
      controllerConfig
    ] as unknown as EThirdPartyControllerConfiguration;
    SteamClient.Apps.SetThirdPartyControllerConfiguration(appId, option);
  }
}

export class MoonDeckAppLauncher {
  private unregisterLifetime: (() => void) | null = null;
  private unregisterSuspension: (() => void) | null = null;
  private unregisterInterceptor: (() => void) | null = null;
  private unregisterExit: (() => void) | null = null;
  private interceptedLaunch = false;
  private launchPending = false;
  private lifecycle = 0;
  private launchGeneration = 0;
  private subscription: Subscription | null = null;
  // The hidden "PyroDeck" shortcut that runs Pyrolight's pair and quit actions.
  private utilityAppId: number | null = null;
  private readonly utilityMutex = new Mutex();
  readonly moonDeckApp: MoonDeckAppProxy;

  private findUtilityShortcut(allDetails: AppDetails[]): void {
    const marker = makeEnvKeyValue(EnvVars.AppType, AppType.Utility);
    const remoteMarker = makeEnvKeyValue(EnvVars.AppType, AppType.Remote);
    const found = allDetails.find((details) => {
      const saved = details.strLaunchOptions.includes(`${EnvVars.LibraryShortcut}=`) && getEnvKeyValueNumber(details.strLaunchOptions, EnvVars.LibraryShortcut) === 1;
      return isMoonDeckShortcut(details) && !saved && (details.strLaunchOptions.includes(marker) || details.strLaunchOptions.includes(remoteMarker) || details.strLaunchOptions.includes("PYRODECK_LAUNCHER=1"));
    });
    this.utilityAppId = found?.unAppID ?? null;
  }

  private async ensureUtilityShortcut(execPath: string): Promise<number | null> {
    const release = await this.utilityMutex.acquire();
    try {
      return await this.prepareUtilityShortcut(execPath);
    } finally {
      release();
    }
  }

  private async prepareUtilityShortcut(
    execPath: string
  ): Promise<number | null> {
    if (
      this.utilityAppId !== null &&
      (await getAppDetails(this.utilityAppId)) === null
    ) {
      // Removed by the user since; make a new one.
      this.utilityAppId = null;
    }

    if (this.utilityAppId === null) {
      const appId = await addShortcut("PyroDeck", execPath);
      if (appId === null) {
        return null;
      }
      // Mark it before anything else so it is found again after a restart.
      if (
        !(await setAppLaunchOptions(
          appId,
          `${makeEnvKeyValue(EnvVars.AppType, AppType.Utility)} PYRODECK_LAUNCHER=1 %command%`
        ))
      ) {
        await removeShortcut(appId);
        return null;
      }
      this.utilityAppId = appId;
    }

    if (!(await setAppHiddenState(this.utilityAppId, true))) {
      logger.error(
        `Failed to hide the PyroDeck utility shortcut ${this.utilityAppId}!`
      );
    }
    return this.utilityAppId;
  }

  private async ensureAppDetails(
    steamAppId: number,
    execPath: string,
    appType: AppType
  ): Promise<AppDetails | null> {
    let appId: number | null = null;
    let details: AppDetails | null = null;

    if (appType === AppType.MoonDeck) {
      appId = await this.ensureUtilityShortcut(execPath);
      if (appId === null) return null;
    } else {
      appId = steamAppId;
    }

    details = await getAppDetails(appId);
    if (details === null) {
      logger.error(`Failed to get app details for ${appId}!`);
      return null;
    }

    if (!checkExecPathMatch(execPath, details.strShortcutExe)) {
      logger.error(
        `Exec path does not match the expected one for ${appId}! ${details.strShortcutExe} vs ${execPath}`
      );
      return null;
    }

    return details;
  }

  private initLifetime(): void {
    this.unregisterLifetime = registerForGameLifetime((data) => {
      const current = this.moonDeckApp.value;
      if (!current || data.unAppID !== this.moonDeckApp.getAppId()) return;
      const generation = this.moonDeckApp.generationId;
      executeAsync(async () => {
        if (generation !== this.moonDeckApp.generationId) return;
        if (data.bRunning) {
          await this.moonDeckApp.applySessionOptions();
          return;
        }
        const result = await this.moonDeckApp.getRunnerResult();
        if (generation !== this.moonDeckApp.generationId) return;
        if (result !== null && result !== "TERMINATED") logger.toast(result, { output: "warn" });
        // A notification for a previous helper lifetime must not clear a new launch.
        await this.moonDeckApp.clearApp(generation);
        await pyrolightIntegration.refreshSession();
      });
    });
  }

  private initSuspension(): void {
    // Suspending the Deck disconnects the stream; the host keeps the game
    // (PyroDeck never suspends or shuts down the host). On resume the runner
    // reconnects to it when "resume after suspend" is on.
    this.unregisterSuspension = registerForSuspendNotifications(async () => {
      if (this.moonDeckApp.value !== null) {
        logger.log("Suspending PyroDeck app.");
        await this.moonDeckApp.suspendApp();
      }
    }, async () => {
      const settings = this.settingsManager.settings.value;
      if (settings === null || !settings.gameSession.resumeAfterSuspend) {
        await this.moonDeckApp.killApp();
        await this.moonDeckApp.clearApp();
        return;
      }

      await this.moonDeckApp.unsuspendApp();
    });
  }

  private initMoonDeckAppTimestampUpdater(): void {
    this.subscription = new Subscription();
    this.subscription.add(this.moonDeckApp.asObservable().pipe(pairwise()).subscribe(([prev, next]) => {
      if (prev !== null && next === null) {
        this.moonDeckAppShortcuts.updateAppLaunchTimestamp(prev.steamAppId);
      }
    }));
  }

  private initInterceptor(): void {
    this.unregisterInterceptor = registerForGameLaunchIntercept((gameId, cancel) => {
      const entry = this.externalAppShortcuts.getEntryByGameId(gameId);
      if (entry !== null) {
        if (this.moonDeckApp.value !== null) {
          if (this.moonDeckApp.value.steamAppId !== entry.appId || !this.moonDeckApp.canRedirect()) {
            cancel();
          }
        } else if (this.interceptedLaunch) {
          // To account of user clicking the button insanely fast again...
          cancel();
        } else {
          cancel();
          this.interceptedLaunch = true;
          this.launchApp(entry.appId, entry.appName, entry.appType, undefined, entry.appType === AppType.Remote ?
              {
                hostId: entry.hostId, remoteAppId: entry.remoteAppId, remoteAppName: entry.appName, libraryShortcut: true
              } :
              {})
            .catch((err) => logger.critical(err))
            .finally(() => { this.interceptedLaunch = false; });
        }
      }
    });
  }

  constructor(
    private readonly appSyncState: AppSyncState,
    private readonly settingsManager: SettingsManager,
    private readonly moonDeckAppShortcuts: MoonDeckAppShortcuts,
    private readonly externalAppShortcuts: ExternalAppShortcuts
  ) {
    this.moonDeckApp = new MoonDeckAppProxy();
  }

  init(allDetails: AppDetails[]): void {
    ++this.lifecycle;
    this.findUtilityShortcut(allDetails);
    this.initLifetime();
    this.initSuspension();
    this.initMoonDeckAppTimestampUpdater();
    this.initInterceptor();
    this.discoverShortcuts(allDetails);
    this.unregisterExit = registerForStreamExit((gameId) => {
      const current = this.moonDeckApp.value;
      if (!current?.moonDeckAppId || this.moonDeckApp.closing) return null;
      if (
        gameId !== current.launcherGameId &&
        gameId !== String(current.moonDeckAppId) &&
        gameId !== String(current.steamAppId)
      )
        return null;
      const overview = getAppStoreEx()?.getAppOverview(current.steamAppId) as { local_per_client_data?: { display_status?: number } } | null;
      if (gameId === String(current.steamAppId) && [1, 4, 36].includes(overview?.local_per_client_data?.display_status ?? -1)) return null;
      const generation = this.moonDeckApp.generationId;
      return async () => {
        if (generation !== this.moonDeckApp.generationId) return;
        await this.moonDeckApp.killApp(true);
        // Overlay Exit can finish without a second app-lifetime callback.
        // Finish the owned launch here as well, never clearing a newer launch.
        if (generation === this.moonDeckApp.generationId) {
          if (await this.moonDeckApp.isStillRunning())
            throw new Error("PyroDeck is still disconnecting. Retry Exit Game.");
          await this.moonDeckApp.clearApp(generation);
        }
        await pyrolightIntegration.refreshSession(true);
        logger.log("Steam Exit completed for PyroDeck stream", { steamAppId: current.steamAppId, helperAppId: current.moonDeckAppId });
      };
    });
  }

  discoverShortcuts(allDetails: AppDetails[]): void {
    const lifecycle = this.lifecycle;
    const launchGeneration = this.launchGeneration;
    const canRecover = (): boolean => lifecycle === this.lifecycle && launchGeneration === this.launchGeneration && !this.moonDeckApp.value;
    // Do not replace a helper created while optional discovery was pending.
    if (this.utilityAppId === null) this.findUtilityShortcut(allDetails);
    executeAsync(async () => {
      const status = await call<[], { runnerActive?: boolean; steamAppId?: number; appName?: string }>("session_status");
      if (!canRecover() || !status?.runnerActive || !status.steamAppId || !this.utilityAppId) return;
      const details = allDetails.find((entry) => entry.unAppID === this.utilityAppId);
      if (!details || getEnvKeyValueNumber(details.strLaunchOptions, EnvVars.SteamAppId) !== status.steamAppId) return;
      const name = getAppStoreEx()?.getAppOverview(status.steamAppId)?.display_name ?? status.appName;
      if (!name) return;
      const gameId = await getGameId(details.unAppID);
      if (!canRecover()) return;
      this.moonDeckApp.setApp(status.steamAppId, details.unAppID, name, AppType.MoonDeck, { nameSetToAppId: false }, gameId);
      await this.moonDeckApp.applySessionOptions();
    });
  }

  deinit(): void {
    this.lifecycle++;
    this.unregisterExit?.();
    this.unregisterExit = null;
    void this.moonDeckApp.changeName(false);
    if (this.unregisterInterceptor !== null) {
      this.unregisterInterceptor();
      this.unregisterInterceptor = null;
    }
    if (this.unregisterLifetime !== null) {
      this.unregisterLifetime();
      this.unregisterLifetime = null;
    }
    if (this.unregisterSuspension !== null) {
      this.unregisterSuspension();
      this.unregisterSuspension = null;
    }
    if (this.subscription !== null) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Run Pyrolight's pair or quit action through Steam, which gives its window
   * Game Mode focus and controller input like a game. "quit" ends the game on
   * the host: only ever started by an explicit user action.
   */
  async launchUtility(action: UtilityAction, hostId?: string, remoteAppId?: number): Promise<void> {
    const execPath = await getMoonDeckRunPath();
    if (execPath === null) {
      logger.toast("Failed to get pyrodeckrun.sh path!", { output: "error" });
      return;
    }

    const appId = await this.ensureUtilityShortcut(execPath);
    if (appId === null) {
      logger.toast("Failed to create the PyroDeck shortcut (needs restart?)!", { output: "error" });
      return;
    }

    await this.launchApp(appId, action === "pair" ? "PyroDeck - Pair" : "PyroDeck - End host game", AppType.Utility, action, { hostId, remoteAppId });
  }

  async launchRemote(
    hostId: string,
    remoteAppId: number,
    remoteAppName: string,
    steamAppId?: number | null
  ): Promise<void> {
    const overview = steamAppId ?
        getAppStoreEx()?.getAppOverview(steamAppId) :
      null;
    if (steamAppId && overview && !overview.BIsShortcut()) {
      await this.launchApp(
        steamAppId,
        remoteAppName,
        AppType.MoonDeck,
        undefined,
        { hostId, remoteAppId }
      );
      return;
    }
    const execPath = await getMoonDeckRunPath();
    if (!execPath) throw new Error("PyroDeck runner is unavailable");
    const appId = await this.ensureUtilityShortcut(execPath);
    if (appId === null)
      throw new Error("Could not prepare the PyroDeck Steam launcher");
    await this.launchApp(appId, remoteAppName, AppType.Remote, undefined, {
      hostId,
      remoteAppId,
      remoteAppName
    });
  }

  /** Disconnect our stream, then use Pyrolight's Quit App on the selected host. */
  async endHostGame(hostId?: string, remoteAppId?: number): Promise<void> {
    if (
      this.moonDeckApp.value !== null ||
      (await this.moonDeckApp.isStillRunning())
    ) {
      await this.moonDeckApp.killApp(true);
      await this.moonDeckApp.clearApp();

      // The backend waits for the owned runner and client to release their
      // process records; host termination cannot overlap a disconnect.
      await call("kill_runner");
      if (await this.moonDeckApp.isStillRunning())
        throw new Error(
          "PyroDeck is still disconnecting. Retry End Remote Game."
        );
    }
    await this.launchUtility("quit", hostId, remoteAppId);
  }

  async launchApp(
    appId: number, appName: string, appType: AppType,
    action?: UtilityAction, target: Partial<LaunchContext> = {}
  ): Promise<void> {
    if (this.launchPending) throw new Error("A PyroDeck launch is already in progress");
    this.launchPending = true;
    steamIntegrationStatus.update({ launchStage: "preparing", launchFailure: null });
    try {
      await this.launchOwnedApp(appId, appName, appType, action, target);
    } catch (error) {
      steamIntegrationStatus.update({ launchFailure: String(error) });
      throw error;
    } finally {
      this.launchPending = false;
    }
  }

  private async launchOwnedApp(
    appId: number,
    appName: string,
    appType: AppType,
    action?: UtilityAction,
    target: Partial<LaunchContext> = {}
  ): Promise<void> {
    this.launchGeneration++;
    const lifecycle = this.lifecycle;
    const ensureActive = (): void => { if (lifecycle !== this.lifecycle) throw new Error("Plugin unloaded during launch"); };
    if (
      appType === AppType.GameStream &&
      (this.moonDeckAppShortcuts.initializing || this.externalAppShortcuts.initializing)
    ) {
      throw new Error("Optional shortcut discovery is still initializing. Library streaming remains available.");
    }

    // Now that nothing is initializing anymore, we can tell the runner script to go into the "ready" state
    await setRunnerReady();

    const settings = this.settingsManager.settings.value;
    if (settings === null) {
      throw new Error("Settings are not available!");
    }

    const selectedHostId = target.hostId ?? settings.currentHostId;
    const hostSettings = selectedHostId ?
        (settings.hostSettings[selectedHostId] ?? null) :
      null;
    if (hostSettings === null) {
      throw new Error("Host is not selected!");
    }

    const hasNetworkConnection =
      getSystemNetworkStore()?.hasNetworkConnection ?? false;
    if (!hasNetworkConnection) {
      throw new Error("No network connection!");
    }

    if (this.appSyncState.getState().syncing) {
      throw new Error("Shortcut sync or cleanup is in progress. Retry when it finishes.");
    }

    if (this.moonDeckApp.value !== null || await this.moonDeckApp.isStillRunning()) {
      const active = await call<[], SessionStatus>("session_status");
      const sameHost = active?.hostId === selectedHostId;
      const sameGame = target.remoteAppId ? active?.remoteAppId === target.remoteAppId : active?.steamAppId === appId;
      if ((sameHost && sameGame) || !active?.runnerActive || !active?.hostId || !active.remoteAppId || appType === AppType.Utility) {
        throw new Error("A PyroDeck stream is already running!");
      }
      if (!await confirmStreamSwitch(active.appName ?? "Remote game", active.hostName ?? "Host", sameHost)) return;
      ensureActive();
      if (sameHost) target = { ...target, terminateAppId: active.remoteAppId };
      await this.moonDeckApp.killApp(true);
      await call("kill_runner");
      await this.moonDeckApp.clearApp();
      if (await this.moonDeckApp.isStillRunning()) throw new Error("The previous stream is still disconnecting. Retry.");
    }

    let prepared = false;
    try {
      ensureActive();
      this.appSyncState.setState(false, AppType.MoonDeck);
      this.appSyncState.setMax(1);
      this.appSyncState.incrementCount();

      logger.log(`Preparing to launch ${appName}.`);

      const execPath = await getMoonDeckRunPath();
      if (execPath === null) {
        throw new Error("PyroDeck runner path is unavailable");
      }

      steamIntegrationStatus.update({ launchStage: "steam_helper" });
      const details = await this.ensureAppDetails(appId, execPath, appType);
      if (details === null) {
        throw new Error("Steam could not create or read the PyroDeck helper. Restart Steam, then retry.");
      }

      ensureActive();
      if (!(await setShortcutName(details.unAppID, appName))) {
        throw new Error("Steam could not update the helper title");
      }

      let currentAudioDevice: string | null = null;
      if (hostSettings.audio.useLinkedAudio) {
        const devices = await getAudioDevices();
        if (devices === null) {
          logger.toast("Failed to get audio device info from Steam!", {
            output: "error"
          });
        }
        currentAudioDevice = devices?.activeOutputDevice;
      }

      let currentDisplay: string | null = null;
      if (hostSettings.resolution.useLinkedDisplays) {
        const displays = await getDisplayIdentifiers();
        if (displays === null) {
          logger.warn("Steam display information unavailable; continuing without a linked display.");
        }
        currentDisplay = displays?.current ?? null;
      }

      const mode = await getCurrentDisplayModeString();
      if (
        !(await setAppResolutionOverride(
          details.unAppID,
          getSelectedAppResolution(mode, currentDisplay, hostSettings)
        ))
      ) {
        throw new Error("Steam could not set the helper resolution override");
      }

      if (
        !(await setOverrideResolutionForInternalDisplay(
          details.unAppID,
          hostSettings.resolution.appResolutionOverrideForInternalDisplay
        ))
      ) {
        throw new Error("Steam could not set the helper internal-display resolution override");
      }

      const launchOptions = getLaunchOptionsString(
        details.strLaunchOptions,
        appId,
        appType,
        {
          displayMode: mode,
          autoResolution: hostSettings.resolution.automatic,
          currentAudioDevice,
          currentDisplay,
          pythonExecPath: settings.pythonExecPath,
          action,
          ...target,
          reusableLauncher: appType !== AppType.GameStream && !target.libraryShortcut,
          hostId: selectedHostId ?? undefined
        }
      );
      if (
        launchOptions === null ||
        !(await setAppLaunchOptions(details.unAppID, launchOptions))
      ) {
        throw new Error("Steam could not update the helper launch options");
      }

      updateControllerConfig(
        details.unAppID,
        settings.gameSession.controllerConfig
      );

      let sessionOptions = this.moonDeckApp.value?.sessionOptions ?? null;
      if (sessionOptions === null) {
        sessionOptions = {
          nameSetToAppId: false
        };
      }

      const gameId = await getGameId(details.unAppID);
      ensureActive();
      if (gameId === null) throw new Error("Steam could not resolve the helper game ID");
      this.moonDeckApp.setApp(
        appId,
        details.unAppID,
        appName,
        appType,
        sessionOptions,
        gameId
      );
      prepared = true;
      await this.moonDeckApp.clearRunnerResult();
      ensureActive();
      steamIntegrationStatus.update({ launchStage: "steam_launch" });

      const launchResult = await launchApp(
        details.unAppID,
        hostSettings.runnerTimeouts.steamLaunch * 1000
      );
      if (launchResult === AppStartResult.Started)
        await this.moonDeckApp.applySessionOptions();
      if (launchResult !== AppStartResult.Started) {
        if (launchResult === AppStartResult.TimeoutOrError) {
          logger.toast("Failed to launch shortcut!", { output: "error" });
          await this.moonDeckApp.killApp();
        }
        await this.moonDeckApp.clearApp();
        throw new Error(launchResult === AppStartResult.Cancelled ? "Steam launch cancelled" : "Steam helper launch timed out. Check Troubleshooting & Diagnostics, then retry.");
      }
      steamIntegrationStatus.update({ launchStage: "waiting_for_client" });
    } catch (error) {
      if (prepared) {
        await this.moonDeckApp.killApp(true);
        await this.moonDeckApp.clearApp();
      }
      logger.error("PyroDeck launch failed", error);
      throw error;
    } finally {
      this.appSyncState.resetState();
    }
  }
}
