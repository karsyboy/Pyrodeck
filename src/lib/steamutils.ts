import { getAllNonSteamAppIds, getAppDetails, getCurrentDisplayMode } from "../steam-utils";
import { AppDetails } from "@decky/ui/dist/globals/steam-client/App";
import { AppLifetimeNotification } from "@decky/ui/dist/globals/steam-client/GameSessions";
import { call } from "@decky/api";
import { logger } from "./logger";
import { throttleAll } from "promise-throttle-all";
export * from "../steam-utils";

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
  Python = "PYRODECK_PYTHON"
}

export enum AppType {
  MoonDeck,
  GameStream,
  NonSteam
}

export function registerForGameLifetime(callback: (data: AppLifetimeNotification) => void): () => void {
  const unregisterable = SteamClient.GameSessions.RegisterForAppLifetimeNotifications(callback);
  return () => unregisterable.unregister();
}

export async function getCurrentDisplayModeString(): Promise<string | null> {
  const currentMode = await getCurrentDisplayMode();
  return currentMode ? `${currentMode.width}x${currentMode.height}` : null;
}

let MoonDeckRunPath: string | null = null;
export async function getMoonDeckRunPath(): Promise<string | null> {
  if (MoonDeckRunPath !== null) {
    return MoonDeckRunPath;
  }

  try {
    MoonDeckRunPath = await call<[], string | null>("get_runner_path");
  } catch (message) {
    logger.critical("Error while getting pyrodeckrun.sh path: ", message);
  }
  return MoonDeckRunPath;
}

// Only shortcuts that run PyroDeck's own runner are PyroDeck's. The original
// MoonDeck plugin's shortcuts (moondeckrun.sh) are never adopted or removed.
export const runnerScriptName = "pyrodeckrun.sh";
export function isMoonDeckShortcut(details: AppDetails): boolean {
  return details.strShortcutExe.includes(runnerScriptName);
}

export function checkExecPathMatch(execPath: string, shortcutExe: string): boolean {
  return new RegExp(`^${execPath}|"${execPath}"$`).test(shortcutExe);
}

export async function getAppDetailsForAppIds(appIds: number[]): Promise<AppDetails[]> {
  const tasks = appIds.map((appid) => async () => await getAppDetails(appid));
  return (await throttleAll(100, tasks)).filter((details) => details !== null);
}

export async function getAllNonSteamAppDetails(): Promise<AppDetails[] | null> {
  const appIds = getAllNonSteamAppIds();
  if (appIds === null) {
    return null;
  }

  return await getAppDetailsForAppIds(appIds);
}

export function isAppTypeSupported(appType: number): boolean {
  // Supported steam apps:
  switch (appType) {
    case 1: // game
      return true;
    case 2: // software
      return false;
    case 4: // tool
      return false;
    case 8: // demo
      return true;
    case 32: // dlc
      return false;
    case 128: // driver
      return false;
    case 256: // config
      return false;
    case 2048: // video
      return false;
    case 8192: // music
      return false;
    case 65536: // beta
      return true;
    default:
      return false;
  }
}
