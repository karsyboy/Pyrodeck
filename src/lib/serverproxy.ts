import { HostSettings, SettingsManager, servicePingDefault, steamLaunchDefault, wakeOnLanDefault } from "./settingsmanager";
import { BehaviorSubject } from "rxjs";
import { Mutex } from "async-mutex";
import { ReadonlySubject } from "./readonlysubject";
import { call } from "@decky/api";
import { isEqual } from "lodash";
import { logger } from "./logger";

export interface GameStreamHost {
  address: string;
  port: number;
  hostName: string;
  uniqueId: string;
  // Version of Pyroshine's launcher identities; 0 when the host has none.
  appSources: number;
  // GameStream ID of the app running on the host; 0 when idle.
  currentGame: number;
}

export type ServerStatus = "Offline" | "Online";

async function scanForHosts(timeout: number): Promise<GameStreamHost[]> {
  try {
    return await call<[number], GameStreamHost[]>("scan_for_hosts", timeout);
  } catch (message) {
    logger.critical("Error while scanning for hosts: ", message);
  }
  return [];
}

async function findHost(hostId: string, timeout: number): Promise<GameStreamHost | null> {
  try {
    return await call<[string, number], GameStreamHost | null>("find_host", hostId, timeout);
  } catch (message) {
    logger.critical("Error while finding host: ", message);
  }
  return null;
}

async function getServerInfo(address: string, port: number, timeout: number): Promise<GameStreamHost | null> {
  try {
    return await call<[string, number, number], GameStreamHost | null>("get_server_info", address, port, timeout);
  } catch (message) {
    logger.critical("Error while getting server info: ", message);
  }
  return null;
}

export class ServerProxy {
  private readonly settingsManager: SettingsManager;

  private readonly mutex = new Mutex();
  private readonly statusSubject = new BehaviorSubject<ServerStatus>("Offline");
  private readonly refreshingSubject = new BehaviorSubject<boolean>(false);
  private readonly hostInfoSubject = new BehaviorSubject<GameStreamHost | null>(null);

  readonly status = new ReadonlySubject(this.statusSubject);
  readonly refreshing = new ReadonlySubject(this.refreshingSubject);
  // The selected host's last serverinfo while it is online.
  readonly hostInfo = new ReadonlySubject(this.hostInfoSubject);

  private updateHostSettingsUnlocked(host: GameStreamHost, selectHost: boolean, staticAddress: boolean | null): void {
    this.settingsManager.update((settings) => {
      const currentSettings = settings.hostSettings[host.uniqueId] ?? null;
      const hostSettings: HostSettings = {
        hostInfoPort: host.port,
        address: host.address,
        staticAddress: staticAddress ?? (currentSettings?.staticAddress ?? false),
        hostName: host.hostName,
        mac: currentSettings?.mac ?? "00:00:00:00:00:00",
        resolution: {
          automatic: currentSettings?.resolution.automatic ?? true,
          appResolutionOverride: currentSettings?.resolution.appResolutionOverride ?? "CustomResolution",
          appResolutionOverrideForInternalDisplay: currentSettings?.resolution.appResolutionOverrideForInternalDisplay ?? false,
          useCustomDimensions: currentSettings?.resolution.useCustomDimensions ?? false,
          useLinkedDisplays: currentSettings?.resolution.useLinkedDisplays ?? true,
          selectedDimensionIndex: currentSettings?.resolution.selectedDimensionIndex ?? -1,
          defaultBitrate: currentSettings?.resolution.defaultBitrate ?? null,
          defaultFps: currentSettings?.resolution.defaultFps ?? null,
          defaultHdr: currentSettings?.resolution.defaultHdr ?? null,
          dimensions: currentSettings?.resolution.dimensions ?? []
        },
        audio: {
          defaultOption: currentSettings?.audio.defaultOption ?? null,
          useLinkedAudio: currentSettings?.audio.useLinkedAudio ?? true,
          linkedAudio: currentSettings?.audio.linkedAudio ?? {}
        },
        passToMoonlight: currentSettings?.passToMoonlight ?? true,
        showPerformanceStats: currentSettings?.showPerformanceStats ?? null,
        enableVSync: currentSettings?.enableVSync ?? null,
        enableFramePacing: currentSettings?.enableFramePacing ?? null,
        enableVrr: currentSettings?.enableVrr ?? null,
        videoCodec: currentSettings?.videoCodec ?? null,
        runnerTimeouts: {
          servicePing: currentSettings?.runnerTimeouts.servicePing ?? servicePingDefault,
          wakeOnLan: currentSettings?.runnerTimeouts.wakeOnLan ?? wakeOnLanDefault,
          steamLaunch: currentSettings?.runnerTimeouts.steamLaunch ?? steamLaunchDefault
        },
        gameStreamApps: {
          showQuickAccessButton: currentSettings?.gameStreamApps.showQuickAccessButton ?? false
        },
        wolSettings: {
          useCustomWolExec: currentSettings?.wolSettings.useCustomWolExec ?? false,
          sendOnce: currentSettings?.wolSettings.sendOnce ?? false,
          customWolExecPath: currentSettings?.wolSettings.customWolExecPath ?? "",
          port: currentSettings?.wolSettings.port ?? 9
        }
      };

      settings.currentHostId = selectHost ? host.uniqueId : settings.currentHostId;
      settings.hostSettings[host.uniqueId] = hostSettings;
    });
  }

  private updateStatus(newStatus: ServerStatus): void {
    if (this.statusSubject.value !== newStatus) {
      this.statusSubject.next(newStatus);
    }
  }

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager;
  }

  async refreshStatus(): Promise<void> {
    if (this.mutex.isLocked()) {
      await this.mutex.waitForUnlock();
      return;
    }

    const release = await this.mutex.acquire();
    try {
      this.refreshingSubject.next(true);

      const hostId = this.settingsManager.settings.value?.currentHostId ?? null;
      if (hostId === null) {
        this.updateStatus("Offline");
        this.hostInfoSubject.next(null);
        return;
      }

      let result: GameStreamHost | null = null;
      const hostSettings = this.settingsManager.hostSettings;
      if (hostSettings) {
        result = hostSettings.staticAddress ? await getServerInfo(hostSettings.address, hostSettings.hostInfoPort, 1) : await findHost(hostId, 1);
      } else {
        result = await findHost(hostId, 1);
      }

      if (this.settingsManager.settings.value?.currentHostId === hostId) {
        const online = result?.uniqueId === hostId;
        this.updateStatus(online ? "Online" : "Offline");
        const hostInfo = online ? result : null;
        if (!isEqual(this.hostInfoSubject.value, hostInfo)) {
          this.hostInfoSubject.next(hostInfo);
        }
      }

      if (result?.uniqueId === hostId) {
        this.updateHostSettingsUnlocked(result, false, null);
      }
    } finally {
      this.refreshingSubject.next(false);
      release();
    }
  }

  async getServerInfo(address: string, port: number): Promise<GameStreamHost | null> {
    return await getServerInfo(address, port, 2);
  }

  async scanForHosts(): Promise<GameStreamHost[]> {
    return await scanForHosts(5);
  }

  async updateHostSettings(host: GameStreamHost, selectHost: boolean, staticAddress: boolean): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.updateHostSettingsUnlocked(host, selectHost, staticAddress);
    } finally {
      release();
    }
  }
}
