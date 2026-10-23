import { getEnvKeyValueString, makeEnvKeyValue } from "./envutils";
import { logger } from "./logger";

// Launch options of PyroDeck's shortcuts, read by the runner
// (defaults/python/lib/runner/envparser.py). The prefix keeps them apart from
// the original MoonDeck plugin's shortcuts.
export enum EnvVars {
  AppType = "PYRODECK_APP_TYPE",
  AutoResolution = "PYRODECK_AUTO_RES",
  LinkedAudio = "PYRODECK_LINKED_AUDIO",
  LinkedDisplay = "PYRODECK_LINKED_DISPLAY",
  SteamAppId = "PYRODECK_STEAM_APP_ID",
  AppName = "PYRODECK_APP_NAME",
  Action = "PYRODECK_ACTION",
  HostId = "PYRODECK_HOST_ID",
  RemoteAppId = "PYRODECK_REMOTE_APP_ID",
  LibraryShortcut = "PYRODECK_LIBRARY_SHORTCUT",
  Python = "PYRODECK_PYTHON"
}

// Values match the runner's RunnerType.
export enum AppType {
  // A Steam library game, streamed by its Steam app ID.
  MoonDeck,
  // A host app synced into Steam, streamed by name.
  GameStream,
  // Pyrolight pair/quit through the hidden "PyroDeck" shortcut.
  Utility,
  Remote
}

export type UtilityAction = "pair" | "quit";

// Only shortcuts that run PyroDeck's own runner are PyroDeck's. The original
// MoonDeck plugin's shortcuts (moondeckrun.sh) are never adopted or removed.
export const runnerScriptName = "pyrodeckrun.sh";
export function isMoonDeckShortcut(details: { strShortcutExe: string }): boolean {
  return details.strShortcutExe.includes(runnerScriptName);
}

export interface LaunchContext {
  displayMode: string | null;
  autoResolution: boolean;
  currentAudioDevice: string | null;
  currentDisplay: string | null;
  pythonExecPath: string;
  action?: UtilityAction;
  hostId?: string;
  remoteAppId?: number;
  remoteAppName?: string;
  reusableLauncher?: boolean;
  libraryShortcut?: boolean;
  terminateAppId?: number;
}

/**
 * The launch options PyroDeck sets on a shortcut right before Steam launches
 * it. For a library game the Steam app ID is the one of the library entry
 * the user pressed the button on; for synced host apps the name stored in
 * the shortcut is kept.
 */
export function getLaunchOptionsString(currentValue: string, appId: number, appType: AppType, context: LaunchContext): string | null {
  const launchOptions: string[] = [];
  launchOptions.push(makeEnvKeyValue(EnvVars.AppType, appType));

  if (appType === AppType.MoonDeck) {
    if (!Number.isInteger(appId) || appId <= 0) {
      logger.error(`Invalid Steam app id ${appId}!`);
      return null;
    }
    launchOptions.push(makeEnvKeyValue(EnvVars.SteamAppId, appId));
    if (context.remoteAppId !== undefined) {
      if (!Number.isInteger(context.remoteAppId) || context.remoteAppId <= 0) return null;
      launchOptions.push(makeEnvKeyValue(EnvVars.RemoteAppId, context.remoteAppId));
    }
  } else if (appType === AppType.GameStream) {
    const appNameFromOptions = getEnvKeyValueString(currentValue, EnvVars.AppName);
    if (appNameFromOptions === null) {
      logger.error(`Failed to get app name from launch options for ${appId}!`);
      return null;
    }

    launchOptions.push(makeEnvKeyValue(EnvVars.AppName, appNameFromOptions));
  } else if (appType === AppType.Remote) {
    if (!context.remoteAppId || !Number.isInteger(context.remoteAppId) || !context.remoteAppName) return null;
    launchOptions.push(makeEnvKeyValue(EnvVars.RemoteAppId, context.remoteAppId));
  } else {
    if (context.action === undefined) {
      logger.error(`No action given for utility launch ${appId}!`);
      return null;
    }
    launchOptions.push(makeEnvKeyValue(EnvVars.Action, context.action));
  }

  if (context.terminateAppId) launchOptions.push(makeEnvKeyValue("PYRODECK_TERMINATE_APP_ID", context.terminateAppId));
  if (context.hostId) launchOptions.push(makeEnvKeyValue(EnvVars.HostId, context.hostId));
  if (appType === AppType.Utility && context.remoteAppId) launchOptions.push(makeEnvKeyValue(EnvVars.RemoteAppId, context.remoteAppId));

  if (context.autoResolution && context.displayMode !== null) {
    launchOptions.push(makeEnvKeyValue(EnvVars.AutoResolution, context.displayMode));
  }

  if (context.currentAudioDevice !== null) {
    launchOptions.push(makeEnvKeyValue(EnvVars.LinkedAudio, context.currentAudioDevice));
  }

  if (context.currentDisplay !== null) {
    launchOptions.push(makeEnvKeyValue(EnvVars.LinkedDisplay, context.currentDisplay));
  }

  if (context.pythonExecPath.length > 0) {
    launchOptions.push(makeEnvKeyValue(EnvVars.Python, context.pythonExecPath));
  }

  if (context.reusableLauncher) launchOptions.push("PYRODECK_LAUNCHER=1");
  if (context.libraryShortcut) launchOptions.push(makeEnvKeyValue(EnvVars.LibraryShortcut, 1));
  launchOptions.push("%command%");
  return launchOptions.join(" ");
}

/** The Steam library entry a game page shows, or null when it cannot get a PyroDeck button. */
export function getLibraryAppData(overview: unknown): { appId: number; appName: string; appType: number } | null {
  if (typeof overview !== "object" || overview === null) {
    return null;
  }
  const { appid, display_name: displayName, app_type: appType } = overview as Record<string, unknown>;
  if (typeof appid !== "number" || !Number.isInteger(appid) || appid <= 0) {
    return null;
  }
  if (typeof displayName !== "string" || typeof appType !== "number") {
    return null;
  }
  return { appId: appid, appName: displayName, appType };
}

/** Steam app types that can be streamed: games, demos and betas. */
export function isAppTypeSupported(appType: number): boolean {
  switch (appType) {
    case 1: // game
    case 8: // demo
    case 65536: // beta
      return true;
    default:
      return false;
  }
}
