import { pyrolightIntegration } from "../lib/pyrolightintegration";
import { useSyncExternalStore } from "react";

export function usePyrolight() {
  return useSyncExternalStore(pyrolightIntegration.subscribe, pyrolightIntegration.getSnapshot);
}
