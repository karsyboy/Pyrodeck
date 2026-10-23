import { AppType, EnvVars, addAppsToCollection, addShortcut, checkExecPathMatch, getAppDetailsForAppIds, getAppStoreEx, getMoonDeckRunPath, getOrCreateCollection, isMoonDeckShortcut, removeAppsFromCollection, removeShortcut, restartSteamClient, setAppLaunchOptions } from "./steamutils";
import { HostSettings, SettingsManager, UserSettings } from "./settingsmanager";
import { getEnvKeyValueNumber, getEnvKeyValueString, makeEnvKeyValue } from "./envutils";
import { AppDetails } from "@decky/ui/dist/globals/steam-client/App";
import { AppSyncState } from "./appsyncstate";
import { BehaviorSubject } from "rxjs";
import { ReadonlySubject } from "./readonlysubject";
import { call } from "@decky/api";
import { logger } from "./logger";

export interface GameStreamAppInfo {
  appId: number;
  appName: string;
  appType: AppType.GameStream;
}

export interface RemoteAppInfo {
  appId: number;
  appName: string;
  appType: AppType.Remote;
  hostId: string;
  remoteAppId: number;
}

export type ExternalAppInfo = GameStreamAppInfo | RemoteAppInfo;
// Bulk sync and purge apply only to the legacy, name-based shortcuts.
export type ExternalAppType = GameStreamAppInfo["appType"];
export type ManagedApp = ExternalAppInfo & { gameId: string };

interface GameStreamHostData {
  appType: AppType.GameStream;
  appName: string;
  entryId: string;
  entryType: EnvVars.AppName;
}

type HostData = GameStreamHostData;
type GameStreamAppNames = string[] | null;

async function getGameStreamAppNames(address: string, port: number, pyrolightExecPath: string | null, timeout: number): Promise<GameStreamAppNames> {
  try {
    return await call<[string, number, string | null, number], GameStreamAppNames>("get_game_stream_app_names", address, port, pyrolightExecPath, timeout);
  } catch (message) {
    logger.critical("Error while fetching gamestream apps: ", message);
  }

  return null;
}

// Every app the host offers, as Steam shortcuts that stream it by name (for
// apps that are not Steam library games, such as Desktop or Lutris games).
async function getHostData(settings: UserSettings, hostSettings: HostSettings): Promise<HostData[] | null> {
  const gameStreamApps = await getGameStreamAppNames(hostSettings.address, hostSettings.hostInfoPort, settings.useMoonlightExec ? settings.moonlightExecPath : null, 45);
  if (gameStreamApps === null) {
    logger.toast("Failed to get the host's app list from Pyrolight!", { output: "error" });
    return null;
  }

  return gameStreamApps.map((appName) => { return { appType: AppType.GameStream, appName, entryId: appName, entryType: EnvVars.AppName }; });
}

function makeLaunchOptions(data: HostData): string {
  const launchOptions: string[] = [];
  launchOptions.push(`${makeEnvKeyValue(EnvVars.AppType, data.appType)}`);
  launchOptions.push(`${makeEnvKeyValue(data.entryType, data.entryId)}`);
  launchOptions.push("%command%");
  return launchOptions.join(" ");
}

async function updateLaunchOptions(appId: number, data: HostData): Promise<boolean> {
  if (!await setAppLaunchOptions(appId, makeLaunchOptions(data))) {
    logger.error(`Failed to set shortcut launch options for ${data.appName}!`);
    return false;
  }
  return true;
}

async function addExternalShortcut(appName: string, moonDeckExecPath: string): Promise<number | null> {
  const appId = await addShortcut(appName, moonDeckExecPath);
  if (appId == null) {
    logger.error(`Failed to add ${appName} shortcut!`);
    return null;
  }

  return appId;
}

export class ExternalAppShortcuts {
  private unobserveCallback: (() => void) | null = null;
  private unregisterCallback: (() => void) | null = null;
  private doneInitializing = false;
  private readonly appInfoSubject = new BehaviorSubject<Map<number, ExternalAppInfo>>(new Map());
  private readonly managedApps: Map<number, ManagedApp> = new Map();

  readonly appInfo = new ReadonlySubject(this.appInfoSubject);

  private initAppStoreObservable(): void {
    const appStoreEx = getAppStoreEx();
    if (appStoreEx === null) {
      logger.error("appStoreEx is null!");
      return;
    }

    this.unobserveCallback = appStoreEx.observe((change) => {
      if (change.type === "delete") {
        const updatedMap = new Map([...this.appInfoSubject.value]);
        updatedMap.delete(change.name);
        this.managedApps.delete(change.name);
        this.appInfoSubject.next(updatedMap);
      }
    });
  }

  private processAppDetails(appDetails: AppDetails[]): void {
    const appStoreEx = getAppStoreEx();
    if (appStoreEx === null) {
      logger.error("Could not get app store overview for processing app details - appStoreEx is null!");
      return;
    }

    const appInfo: Map<number, ExternalAppInfo> = new Map();
    const addAppInfo = (details: AppDetails, appType: ExternalAppType): void => { appInfo.set(details.unAppID, { appId: details.unAppID, appName: details.strDisplayName, appType }); };
    for (const details of appDetails) {
      if (!isMoonDeckShortcut(details) || !details.strLaunchOptions.includes(`${EnvVars.AppType}=`)) continue;
      const overview = appStoreEx.getAppOverview(details.unAppID);
      if (overview === null) {
        logger.error(`Could not get app store overview for ${details.unAppID} while processing details!`);
        continue;
      }

      if (getEnvKeyValueNumber(details.strLaunchOptions, EnvVars.AppType) === AppType.Remote &&
        details.strLaunchOptions.includes(`${EnvVars.LibraryShortcut}=`) &&
        getEnvKeyValueNumber(details.strLaunchOptions, EnvVars.LibraryShortcut) === 1) {
        const hostId = getEnvKeyValueString(details.strLaunchOptions, EnvVars.HostId);
        const remoteAppId = getEnvKeyValueNumber(details.strLaunchOptions, EnvVars.RemoteAppId);
        if (!hostId || !Number.isInteger(remoteAppId) || remoteAppId === null || remoteAppId <= 0 || remoteAppId >= 0x80000000) continue;
        const info: RemoteAppInfo = { appId: details.unAppID, appName: details.strDisplayName, appType: AppType.Remote, hostId, remoteAppId };
        this.managedApps.set(details.unAppID, { ...info, gameId: overview.gameid });
        appInfo.set(details.unAppID, info);
      } else if (getEnvKeyValueNumber(details.strLaunchOptions, EnvVars.AppType) === AppType.GameStream) {
        const appType = AppType.GameStream;
        this.managedApps.set(details.unAppID, { appId: details.unAppID, appName: details.strDisplayName, appType, gameId: overview.gameid });
        addAppInfo(details, appType);
        continue;
      }
    }

    this.appInfoSubject.next(new Map([...this.appInfoSubject.value, ...appInfo]));
  }

  private async removeApps(appIds: number[]): Promise<boolean> {
    let success = true;
    const updatedMap = new Map([...this.appInfoSubject.value]);

    for (const appId of appIds) {
      this.appSyncState.incrementCount();
      success = await removeShortcut(appId) && success;
      updatedMap.delete(appId);
      this.managedApps.delete(appId);
    }

    this.appInfoSubject.next(updatedMap);
    return success;
  }

  constructor(private readonly appSyncState: AppSyncState, private readonly settingsManager: SettingsManager) {
  }

  init(allDetails: AppDetails[]): void {
    this.initAppStoreObservable();

    this.processAppDetails(allDetails);
    this.doneInitializing = true;
  }

  deinit(): void {
    this.doneInitializing = false;
    this.managedApps.clear();

    if (this.unregisterCallback !== null) {
      this.unregisterCallback();
      this.unregisterCallback = null;
    }

    if (this.unobserveCallback !== null) {
      this.unobserveCallback();
      this.unobserveCallback = null;
    }
  }

  getEntryByGameId(gameId: string): ManagedApp | null {
    for (const [, value] of this.managedApps.entries()) {
      if (value.gameId === gameId) {
        return value;
      }
    }
    return null;
  }

  get initializing(): boolean {
    return !this.doneInitializing;
  }

  /** Save one advertised application, pinned to its host and stable app ID. */
  async addRemoteShortcut(hostId: string, app: { id: number; name: string }): Promise<number> {
    if (this.initializing) throw new Error("Shortcut discovery is still initializing. Retry shortly.");
    if (this.appSyncState.getState().syncing) throw new Error("Shortcut sync or launch is in progress. Retry when it finishes.");
    const settings = this.settingsManager.settings.value;
    if (!settings?.hostSettings[hostId]) throw new Error("This host is no longer configured.");
    if (!Number.isInteger(app.id) || app.id <= 0 || app.id >= 0x80000000 || !app.name.trim()) throw new Error("Invalid host application.");
    for (const info of this.appInfo.value.values()) {
      if (info.appType === AppType.Remote && info.hostId === hostId && info.remoteAppId === app.id) return info.appId;
    }

    this.appSyncState.setState(false, AppType.Remote);
    let added: number | null = null;
    try {
      const execPath = await getMoonDeckRunPath();
      if (!execPath) throw new Error("PyroDeck runner is unavailable.");
      added = await addShortcut(app.name, execPath);
      if (added === null) throw new Error("Steam could not create the shortcut. Restart Steam, then retry.");
      const options = [
        makeEnvKeyValue(EnvVars.AppType, AppType.Remote),
        makeEnvKeyValue(EnvVars.LibraryShortcut, 1),
        makeEnvKeyValue(EnvVars.HostId, hostId),
        makeEnvKeyValue(EnvVars.RemoteAppId, app.id),
        "%command%"
      ].join(" ");
      if (!await setAppLaunchOptions(added, options)) throw new Error("Steam could not save the shortcut's launch options.");
      const details = await getAppDetailsForAppIds([added]);
      this.processAppDetails(details);
      if (!this.managedApps.has(added)) throw new Error("Steam could not read the new shortcut.");
      await this.updateCollection();
      return added;
    } catch (error) {
      if (added !== null) await this.removeApps([added]);
      throw error;
    } finally {
      this.appSyncState.resetState();
    }
  }

  async syncShortcuts(appType: ExternalAppType): Promise<void> {
    if (this.initializing) {
      logger.toast("Plugin is still initializing!", { output: "error" });
      return;
    }

    if (this.appSyncState.getState().syncing) {
      return;
    }

    try {
      this.appSyncState.setState(false, appType);

      const settings = this.settingsManager.settings.value;
      if (settings === null) {
        logger.toast("Settings are not available!", { output: "error" });
        return;
      }

      const hostSettings = this.settingsManager.hostSettings;
      if (hostSettings === null) {
        logger.toast("Host is not selected!", { output: "error" });
        return;
      }

      const execPath = await getMoonDeckRunPath();
      if (execPath === null) {
        logger.toast("Failed to get pyrodeckrun.sh path!", { output: "error" });
        return;
      }

      const hostData = await getHostData(settings, hostSettings);
      if (hostData === null) {
        // Error already logged
        return;
      }

      const currentAppDetails = await getAppDetailsForAppIds(
        Array.from(this.appInfo.value)
          .filter(([, info]) => info.appType === appType)
          .map(([appId]) => appId));

      const existingApps = new Map<string, AppDetails>();
      for (const shortcut of currentAppDetails) {
        const appName = getEnvKeyValueString(shortcut.strLaunchOptions, EnvVars.AppName);
        if (appName !== null) {
          existingApps.set(`${EnvVars.AppName}_${appName}`, shortcut);
          continue;
        }

        // Add app to the map so that it's deleted later
        existingApps.set(`${shortcut.unAppID}`, shortcut);
      }

      const appsToAdd: HostData[] = [];
      const appsToRemove: number[] = [];
      let success = true;

      // Check which apps need to be added or updated
      for (const data of hostData) {
        const details = existingApps.get(`${data.entryType}_${data.entryId}`);
        if (!details) {
          appsToAdd.push(data);
        } else if (!checkExecPathMatch(execPath, details.strShortcutExe)) {
          appsToRemove.push(details.unAppID);
          appsToAdd.push(data);
        }
      }

      // Check which ones are no longer in the list and needs to be removed
      for (const [key, details] of existingApps) {
        if (!hostData.find((data) => `${data.entryType}_${data.entryId}` === key)) {
          appsToRemove.push(details.unAppID);
        }
      }

      this.appSyncState.setMax(appsToAdd.length + appsToRemove.length);

      // Actually generate shortcuts
      const addedAppIds: Set<number> = new Set();
      for (const app of appsToAdd) {
        this.appSyncState.incrementCount();
        const appId = await addExternalShortcut(app.appName, execPath);
        if (appId !== null) {
          addedAppIds.add(appId);
          success = await updateLaunchOptions(appId, app) && success;
        } else {
          success = false;
        }
      }

      // Remove them bastards!
      await this.removeApps(appsToRemove);

      if (appsToAdd.length > 0 || appsToRemove.length > 0) {
        const newDetails = await getAppDetailsForAppIds(Array.from(addedAppIds));
        success = newDetails.length === addedAppIds.size && success;
        this.processAppDetails(newDetails); // Proccess details regardless of success
        await this.updateCollection();

        if (appsToRemove.length > 0) {
          restartSteamClient();
        } else {
          if (success) {
            logger.toast(`${appsToAdd.length}/${hostData.length} app(s) were synced.`, { output: "log" });
          } else {
            logger.toast("Some app(s) failed to sync.", { output: "error" });
          }
        }
      } else {
        await this.updateCollection();
        logger.toast("Apps are in sync.", { output: "log" });
      }
    } catch (error) {
      logger.critical(error);
    } finally {
      this.appSyncState.resetState();
    }
  }

  async purgeShortcuts(appType: ExternalAppType): Promise<void> {
    if (this.initializing) {
      logger.toast("Plugin is still initializing!", { output: "error" });
      return;
    }

    if (this.appSyncState.getState().syncing) {
      return;
    }

    try {
      this.appSyncState.setState(true, appType);

      const appIds = Array.from(this.appInfo.value)
        .filter(([, info]) => info.appType === appType)
        .map(([appId]) => appId);

      this.appSyncState.setMax(appIds.length);

      await this.removeApps(appIds);
      if (appIds.length > 0) {
        await this.updateCollection();
        restartSteamClient();
      }
    } catch (error) {
      logger.critical(error);
    } finally {
      this.appSyncState.resetState();
    }
  }

  async updateCollection(): Promise<void> {
    const collectionTag = "PyroDeck";
    const collection = await getOrCreateCollection(collectionTag, true);
    if (collection !== null || this.managedApps.size > 0) {
      const collectionApps = collection ? Array.from(collection.apps.keys()) : [];
      const someRandomApps = collectionApps.filter((appId) => !this.managedApps.has(appId));

      let leftoverMoonDeckApps: number[] = [];
      if (collection) {
        const possiblyLeftoverApps = Array.from(collection.allApps.values())
          .filter((item) => someRandomApps.includes(item.appid))
          .filter((item) => `${item.appid}` != item.gameid) // Not a normal Steam app
          .map((item) => item.appid);

        leftoverMoonDeckApps = (await getAppDetailsForAppIds(possiblyLeftoverApps))
          .filter((item) => isMoonDeckShortcut(item))
          .map((item) => item.unAppID);
      }

      await addAppsToCollection(collectionTag, Array.from(this.managedApps.keys()));
      await removeAppsFromCollection(collectionTag, leftoverMoonDeckApps);
    }
  }
}
