import { getAllNonSteamAppIds, getAppDetails, getCurrentDisplayMode } from "../steam-utils";
import { AppDetails } from "@decky/ui/dist/globals/steam-client/App";
import { AppLifetimeNotification } from "@decky/ui/dist/globals/steam-client/GameSessions";
import { call } from "@decky/api";
import { logger } from "./logger";
import { throttleAll } from "promise-throttle-all";
export * from "../steam-utils";
export { AppType, EnvVars, isAppTypeSupported, isMoonDeckShortcut, runnerScriptName } from "./launchenv";

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
