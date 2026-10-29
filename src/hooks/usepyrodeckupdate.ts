import { useEffect, useSyncExternalStore } from "react";
import { UserSettings } from "../lib/settingsmanager";
import { pyroDeckUpdate } from "../lib/pyrodeckupdate";

/** PyroDeck's update state for the configured channel, checked at most every 10 min. */
export function usePyroDeckUpdate(settings: UserSettings | null, enabled = true) {
  const state = useSyncExternalStore(pyroDeckUpdate.subscribe, pyroDeckUpdate.getSnapshot);
  const prerelease = settings?.pyrodeckPrereleases ?? false;
  const ready = settings !== null && enabled;
  useEffect(() => { if (ready) void pyroDeckUpdate.check(prerelease); }, [prerelease, ready]);
  return { state, prerelease };
}
