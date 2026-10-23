import { logger } from "../lib/logger";

export enum AppStartResult { TimeoutOrError, Started, Cancelled }

/** Steam lifetime is process readiness only; Pyrolight reports window readiness. */
export async function waitForAppStartNotification(appId: number, gameId: string, timeout: number, signal?: AbortSignal): Promise<AppStartResult> {
  return await new Promise<AppStartResult>((resolve) => {
    let finished = false;
    let actionId: number | null = null;
    let creatingProcess = false;
    const cleanup: Array<() => void> = [];
    const complete = (result: AppStartResult): void => {
      if (finished) return;
      finished = true;
      cleanup.splice(0).reverse().forEach((remove) => { try { remove(); } catch (error) { logger.critical(error); } });
      resolve(result);
    };
    const register = (subscription: { unregister(): void }): void => {
      if (typeof subscription?.unregister !== "function") throw new Error("Steam notification subscription changed");
      if (finished) subscription.unregister();
      else cleanup.push(() => subscription.unregister());
    };
    const abort = (): void => complete(AppStartResult.Cancelled);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    cleanup.push(() => signal?.removeEventListener("abort", abort));
    const timer = setTimeout(() => complete(AppStartResult.TimeoutOrError), timeout);
    cleanup.push(() => clearTimeout(timer));
    try {
      register(SteamClient.Apps.RegisterForGameActionStart((id, target, action) => {
        if (action === "LaunchApp" && target === gameId && actionId === null) { actionId = id; logger.log(`Steam helper ${appId}: launch action ${id}`); }
      }));
      register(SteamClient.Apps.RegisterForGameActionTaskChange((id, _1, _2, task) => {
        if (id === actionId) { logger.debug(`Steam helper ${appId}: ${task}`); if (task === "CreatingProcess") creatingProcess = true; }
      }));
      register(SteamClient.Apps.RegisterForGameActionEnd((id) => {
        if (id === actionId && !creatingProcess) complete(AppStartResult.Cancelled);
      }));
      register(SteamClient.GameSessions.RegisterForAppLifetimeNotifications((data) => {
        if (data.unAppID === appId) { logger.log(`Steam helper ${appId}: running=${data.bRunning}`); complete(data.bRunning ? AppStartResult.Started : AppStartResult.TimeoutOrError); }
      }));
    } catch (error) {
      logger.critical(error);
      complete(AppStartResult.TimeoutOrError);
    }
  });
}
