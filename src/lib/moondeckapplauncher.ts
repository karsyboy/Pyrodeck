import { AppStartResult, AppType, ControllerConfigOption, EnvVars, addShortcut, checkExecPathMatch, getAppDetails, getAudioDevices, getCurrentDisplayModeString, getDisplayIdentifiers, getMoonDeckRunPath, getSystemNetworkStore, isMoonDeckShortcut, launchApp, registerForGameLaunchIntercept, registerForGameLifetime, registerForSuspendNotifications, removeShortcut, setAppHiddenState, setAppLaunchOptions, setAppResolutionOverride, setOverrideResolutionForInternalDisplay, setShortcutName } from "./steamutils";
import { ControllerConfigValues, Dimension, HostResolution, HostSettings, SettingsManager } from "./settingsmanager";
import { LaunchContext, UtilityAction, getLaunchOptionsString } from "./launchenv";
import { Subscription, pairwise } from "rxjs";
import { AppDetails } from "@decky/ui/dist/globals/steam-client/App";
import { AppSyncState } from "./appsyncstate";
import { EThirdPartyControllerConfiguration } from "@decky/ui/dist/globals/steam-client/Input";
import { ExternalAppShortcuts } from "./externalappshortcuts";
import { MoonDeckAppProxy } from "./moondeckapp";
import { MoonDeckAppShortcuts } from "./moondeckappshortcuts";
import { Mutex } from "async-mutex";
import { call } from "@decky/api";
import { executeAsync } from "./executeasync";
import { logger } from "./logger";
import { makeEnvKeyValue } from "./envutils";

async function setRunnerReady(): Promise<void> {
  try {
    await call("set_runner_ready");
  } catch (message) {
    logger.critical("Error while setting runner ready state: ", message);
  }
}

function getCustomDimension(display: string | null, hostResolution: Readonly<HostResolution>): string | null {
  const dimensions = hostResolution.dimensions;
  const stringify = (dimension: Dimension): string => { return `${dimension.width}x${dimension.height}`; };

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

export function updateControllerConfig(appId: number, controllerConfig: keyof typeof ControllerConfigValues | null): void {
  if (controllerConfig !== null) {
    logger.log(`Setting controller config to ${controllerConfig} for ${appId}.`);
    const option = ControllerConfigOption[controllerConfig] as unknown as EThirdPartyControllerConfiguration;
    SteamClient.Apps.SetThirdPartyControllerConfiguration(appId, option);
  }
}

export class MoonDeckAppLauncher {
  private unregisterLifetime: (() => void) | null = null;
  private unregisterSuspension: (() => void) | null = null;
  private unregisterInterceptor: (() => void) | null = null;
  private interceptedLaunch = false;
  private subscription: Subscription | null = null;
  // The hidden "PyroDeck" shortcut that runs Pyrolight's pair and quit actions.
  private utilityAppId: number | null = null;
  private readonly utilityMutex = new Mutex();
  readonly moonDeckApp: MoonDeckAppProxy;

  private findUtilityShortcut(allDetails: AppDetails[]): void {
    const marker = makeEnvKeyValue(EnvVars.AppType, AppType.Utility);
    const remoteMarker = makeEnvKeyValue(EnvVars.AppType, AppType.Remote);
    const found = allDetails.find((details) => isMoonDeckShortcut(details) && (details.strLaunchOptions.includes(marker) || details.strLaunchOptions.includes(remoteMarker) || details.strLaunchOptions.includes("PYRODECK_LAUNCHER=1")));
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

  private async prepareUtilityShortcut(execPath: string): Promise<number | null> {
    if (this.utilityAppId !== null && await getAppDetails(this.utilityAppId) === null) {
      // Removed by the user since; make a new one.
      this.utilityAppId = null;
    }

    if (this.utilityAppId === null) {
      const appId = await addShortcut("PyroDeck", execPath);
      if (appId === null) {
        return null;
      }
      // Mark it before anything else so it is found again after a restart.
      if (!await setAppLaunchOptions(appId, `${makeEnvKeyValue(EnvVars.AppType, AppType.Utility)} PYRODECK_LAUNCHER=1 %command%`)) {
        await removeShortcut(appId);
        return null;
      }
      this.utilityAppId = appId;
    }

    if (!await setAppHiddenState(this.utilityAppId, true)) {
      logger.error(`Failed to hide the PyroDeck utility shortcut ${this.utilityAppId}!`);
    }
    return this.utilityAppId;
  }

  private async ensureAppDetails(steamAppId: number, execPath: string, appType: AppType): Promise<AppDetails | null> {
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
      logger.error(`Exec path does not match the expected one for ${appId}! ${details.strShortcutExe} vs ${execPath}`);
      return null;
    }

    return details;
  }

  private initLifetime(): void {
    this.unregisterLifetime = registerForGameLifetime((data) => {
      if (data.bRunning && data.unAppID === this.moonDeckApp.getAppId()) {
        executeAsync(async () => {
          await this.moonDeckApp.applySessionOptions();
        });
        return;
      }

      executeAsync(async () => {
        if (this.moonDeckApp.value === null) {
          // There should be no result in this state, unless the plugin is still loading app details
          // and did not manage to intercept calls OR some error has occured somewhere...
          const result = await this.moonDeckApp.getRunnerResult();
          if (result !== null && result !== "TERMINATED") {
            logger.toast(result, { output: "warn" });
          }
          return;
        }

        if (await this.moonDeckApp.isStillRunning()) {
          // Some other app was terminated
          return;
        }

        const result = await this.moonDeckApp.getRunnerResult();
        if (result !== null && result !== "TERMINATED") {
          logger.toast(result, { output: "warn" });
        }

        await this.moonDeckApp.clearApp();
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
          this.launchApp(entry.appId, entry.appName, entry.appType)
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
    this.findUtilityShortcut(allDetails);
    this.initLifetime();
    this.initSuspension();
    this.initMoonDeckAppTimestampUpdater();
    this.initInterceptor();
  }

  deinit(): void {
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
  async launchUtility(action: UtilityAction, hostId?: string, expectedAppId?: number): Promise<void> {
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

    await this.launchApp(appId, action === "pair" ? "PyroDeck - Pair" : "PyroDeck - End host game", AppType.Utility, action, { hostId, remoteAppId: expectedAppId });
  }

  async launchRemote(hostId: string, remoteAppId: number, remoteAppName: string): Promise<void> {
    const execPath = await getMoonDeckRunPath();
    if (!execPath) throw new Error("PyroDeck runner is unavailable");
    const appId = await this.ensureUtilityShortcut(execPath);
    if (appId === null) throw new Error("Could not prepare the PyroDeck Steam launcher");
    await this.launchApp(appId, remoteAppName, AppType.Remote, undefined, { hostId, remoteAppId, remoteAppName });
  }

  /** Disconnect a running stream (if any), then end the game on the host. */
  async endHostGame(hostId?: string, expectedAppId?: number): Promise<void> {
    if (this.moonDeckApp.value !== null || await this.moonDeckApp.isStillRunning()) {
      await this.moonDeckApp.killApp(true);
      await this.moonDeckApp.clearApp();

      // The backend waits for the owned runner and client to release their
      // process records; host termination cannot overlap a disconnect.
      await call("kill_runner");
      if (await this.moonDeckApp.isStillRunning()) throw new Error("PyroDeck is still disconnecting. Retry End Remote Game.");
    }
    await this.launchUtility("quit", hostId, expectedAppId);
  }

  async launchApp(appId: number, appName: string, appType: AppType, action?: UtilityAction, target: Partial<LaunchContext> = {}): Promise<void> {
    if (this.moonDeckAppShortcuts.initializing || this.externalAppShortcuts.initializing) {
      logger.toast("Plugin is still initializing...");
      return;
    }

    // Now that nothing is initializing anymore, we can tell the runner script to go into the "ready" state
    await setRunnerReady();

    const settings = this.settingsManager.settings.value;
    if (settings === null) {
      logger.toast("Settings are not available!", { output: "error" });
      return;
    }

    const selectedHostId = target.hostId ?? settings.currentHostId;
    const hostSettings = selectedHostId ? settings.hostSettings[selectedHostId] ?? null : null;
    if (hostSettings === null) {
      logger.toast("Host is not selected!");
      return;
    }

    if (await this.moonDeckApp.isStillRunning()) {
      logger.toast("A PyroDeck stream is already running!");
      return;
    }

    const hasNetworkConnection = getSystemNetworkStore()?.hasNetworkConnection ?? false;
    if (!hasNetworkConnection) {
      logger.toast("No network connection!");
      return;
    }

    if (this.appSyncState.getState().syncing) {
      logger.toast("Currently syncing syncing/purging apps!");
      return;
    }

    try {
      this.appSyncState.setState(false, AppType.MoonDeck);
      this.appSyncState.setMax(1);
      this.appSyncState.incrementCount();

      logger.log(`Preparing to launch ${appName}.`);

      const execPath = await getMoonDeckRunPath();
      if (execPath === null) {
        logger.toast("Failed to get pyrodeckrun.sh path!", { output: "error" });
        return;
      }

      const details = await this.ensureAppDetails(appId, execPath, appType);
      if (details === null) {
        logger.toast("Failed to create shortcut (needs restart?)!", { output: "error" });
        return;
      }

      if (!await setShortcutName(details.unAppID, appName)) {
        logger.toast("Failed to update shortcut name (needs restart?)!", { output: "error" });
        return;
      }

      let currentAudioDevice: string | null = null;
      if (hostSettings.audio.useLinkedAudio) {
        const devices = await getAudioDevices();
        if (devices === null) {
          logger.toast("Failed to get audio device info from Steam!", { output: "error" });
        }
        currentAudioDevice = devices?.activeOutputDevice;
      }

      let currentDisplay: string | null = null;
      if (hostSettings.resolution.useLinkedDisplays) {
        const displays = await getDisplayIdentifiers();
        if (displays === null) {
          logger.toast("Failed to get display info from Steam!", { output: "error" });
        }
        currentDisplay = displays?.current ?? null;
      }

      const mode = await getCurrentDisplayModeString();
      if (!await setAppResolutionOverride(details.unAppID, getSelectedAppResolution(mode, currentDisplay, hostSettings))) {
        logger.toast("Failed to set app resolution override (needs restart?)!", { output: "error" });
        return;
      }

      if (!await setOverrideResolutionForInternalDisplay(details.unAppID, hostSettings.resolution.appResolutionOverrideForInternalDisplay)) {
        logger.toast("Failed to set app resolution override for internal display (needs restart?)!", { output: "error" });
        return;
      }

      const launchOptions = getLaunchOptionsString(details.strLaunchOptions, appId, appType, {
        displayMode: mode,
        autoResolution: hostSettings.resolution.automatic,
        currentAudioDevice,
        currentDisplay,
        pythonExecPath: settings.pythonExecPath,
        action,
        ...target,
        reusableLauncher: appType !== AppType.GameStream,
        hostId: selectedHostId ?? undefined
      });
      if (launchOptions === null || !await setAppLaunchOptions(details.unAppID, launchOptions)) {
        logger.toast("Failed to update shortcut launch options (needs restart?)!", { output: "error" });
        return;
      }

      updateControllerConfig(details.unAppID, settings.gameSession.controllerConfig);

      let sessionOptions = this.moonDeckApp.value?.sessionOptions ?? null;
      if (sessionOptions === null) {
        sessionOptions = {
          nameSetToAppId: settings.gameSession.autoApplyAppId
        };
      }

      this.moonDeckApp.setApp(appId, details.unAppID, appName, appType, sessionOptions);
      await this.moonDeckApp.clearRunnerResult();

      const launchResult = await launchApp(details.unAppID, hostSettings.runnerTimeouts.steamLaunch * 1000);
      if (launchResult !== AppStartResult.Started) {
        if (launchResult === AppStartResult.TimeoutOrError) {
          logger.toast("Failed to launch shortcut!", { output: "error" });
          await this.moonDeckApp.killApp();
        }
        await this.moonDeckApp.clearApp();
        return;
      }
    } catch (error) {
      logger.toast("Exception while trying to launch shortcut!", { output: null });
      logger.critical(error);
    } finally {
      this.appSyncState.resetState();
    }
  }
}
