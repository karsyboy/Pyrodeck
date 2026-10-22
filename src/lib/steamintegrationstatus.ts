export interface SteamIntegrationStatus {
  library: string;
  overlay: string;
}
let state: SteamIntegrationStatus = {
  library: "Waiting for a Library page",
  overlay: "No matched stream"
};
const listeners = new Set<() => void>();
export const steamIntegrationStatus = {
  getSnapshot: (): SteamIntegrationStatus => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  update: (patch: Partial<SteamIntegrationStatus>): void => {
    if (
      Object.entries(patch).every(
        ([key, value]) => state[key as keyof SteamIntegrationStatus] === value
      )
    )
      return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
};
