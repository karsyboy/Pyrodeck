import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { pyrolightIntegration } from "../lib/pyrolightintegration";

const noSubscription = (): (() => void) => () => {};
const sessionSnapshot = () => pyrolightIntegration.getSnapshot().session;
export const PyrolightViewVisibility = createContext(true);

export function usePyrolight(enabled = true) {
  const visible = useContext(PyrolightViewVisibility);
  return useSyncExternalStore(enabled && visible ? pyrolightIntegration.subscribe : noSubscription, pyrolightIntegration.getSnapshot);
}

export function usePyrolightSession() {
  const visible = useContext(PyrolightViewVisibility);
  return useSyncExternalStore(visible ? pyrolightIntegration.subscribe : noSubscription, sessionSnapshot);
}

export function usePyrolightSettings() {
  const visible = useContext(PyrolightViewVisibility);
  return useSyncExternalStore(visible ? pyrolightIntegration.subscribe : noSubscription, pyrolightIntegration.getSettingsSnapshot);
}

export function useSessionPolling(enabled = true): void {
  const active = useContext(PyrolightViewVisibility) && enabled;
  useEffect(() => active ? pyrolightIntegration.watchSession() : undefined, [active]);
}
