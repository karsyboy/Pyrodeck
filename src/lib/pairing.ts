import { call } from "@decky/api";
import { logger } from "./logger";

// Whether Pyrolight can use the host, from one headless `pyrolight list`
// (main.py get_pairing_status). Pairing itself is Pyrolight's own.
export type PairingStatus = "Unknown" | "Checking" | "Paired" | "NotPaired" | "Unreachable" | "WrongHost" | "Outdated" | "NotInstalled" | "Error";

export const pairingStatusDescriptions: Record<PairingStatus, string> = {
  Unknown: "Not checked yet.",
  Checking: "Asking Pyrolight for the host's app list...",
  Paired: "Pyrolight is paired with this host.",
  NotPaired: "Pyrolight is not paired with this host. Pair it, then approve the PIN on the host.",
  Unreachable: "Pyrolight cannot reach the host. Check that it is on and that Pyroshine is running.",
  WrongHost: "Pyrolight reached a different host at this address. Select the host again.",
  Outdated: "This Pyrolight is too old for PyroDeck. Update Pyrolight.",
  NotInstalled: "Pyrolight was not found. Install the Pyrolight AppImage in ~/Applications or set its path.",
  Error: "Pyrolight failed. See the backend log in Troubleshooting & Diagnostics."
};

export async function getPairingStatus(address: string, port: number, hostId: string, pyrolightExecPath: string | null): Promise<PairingStatus> {
  try {
    return await call<[string, number, string, string | null, number], PairingStatus>("get_pairing_status", address, port, hostId, pyrolightExecPath, 45);
  } catch (message) {
    logger.critical("Error while checking Pyrolight pairing: ", message);
  }
  return "Error";
}

export async function getPyrolightPath(pyrolightExecPath: string | null): Promise<string | null> {
  try {
    return await call<[string | null], string | null>("get_pyrolight_path", pyrolightExecPath);
  } catch (message) {
    logger.critical("Error while looking for Pyrolight: ", message);
  }
  return null;
}
