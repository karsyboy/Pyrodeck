import { callOriginal, replacePatch } from "@decky/ui";
import { logger } from "../lib/logger";

/** Route Steam's Exit action for the owned helper through name restoration. */
export function registerForStreamExit(
  resolve: (gameId: string) => (() => Promise<void>) | null
): (() => void) | null {
  if (typeof SteamClient.Apps.TerminateApp !== "function") return null;
  try {
    const patch = replacePatch(
      SteamClient.Apps,
      "TerminateApp",
      ([gameId]: unknown[]) => {
        if (typeof gameId !== "string") return callOriginal;
        const disconnect = resolve(gameId);
        if (!disconnect) return callOriginal;
        void disconnect().catch((error: unknown) => logger.critical(error));
        return undefined;
      }
    );
    return () => patch.unpatch();
  } catch (error) {
    logger.critical(error);
    return null;
  }
}
