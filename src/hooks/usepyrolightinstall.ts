import { useEffect, useSyncExternalStore } from "react";
import { pyrolightInstall } from "../lib/pyrolightinstall";

/** The shared Pyrolight installation state, refreshed for this executable setting. */
export function usePyrolightInstall(configuredPath: string | null) {
  const state = useSyncExternalStore(pyrolightInstall.subscribe, pyrolightInstall.getSnapshot);
  useEffect(() => { void pyrolightInstall.refresh(configuredPath); }, [configuredPath]);
  return state;
}
