import { HostSettings, SettingsManager, UserSettings } from "./settingsmanager";
import { ServerProxy, ServerStatus } from "./serverproxy";
import { BehaviorSubject } from "rxjs";
import { Mutex } from "async-mutex";
import { ReadonlySubject } from "./readonlysubject";
import { call } from "@decky/api";
import { logger } from "./logger";
import { sleep } from "@decky/ui";

async function wakeOnLan(hostName: string, address: string, mac: string, port: number, customExec: string | null): Promise<void> {
  try {
    await call<[string, string, string, number, string | null], unknown>("wake_on_lan", hostName, address, mac, port, customExec);
  } catch (message) {
    logger.critical("Error while sending WOL: ", message);
  }
}

type Callback<T = void> = () => Promise<T>;
type CallbackWithSettings<T = void> = (userSettings: Readonly<UserSettings>, hostSettings: Readonly<HostSettings>) => Promise<T>;
interface InvocationOptions {
  locked: boolean;
  validServerStatus: ServerStatus[];
  updateExecutionState: boolean;
}
const defaultInvocationOptions: InvocationOptions = { locked: true, validServerStatus: [], updateExecutionState: true };
const defaultSleepForUX = 2000;

// Host commands PyroDeck sends itself. Only Wake-on-LAN exists: ending the
// host game goes through Pyrolight (`MoonDeckAppLauncher.endHostGame`), and
// PyroDeck has no host power controls.
export class CommandProxy {
  private readonly mutex = new Mutex();
  private readonly executingSubject = new BehaviorSubject<boolean>(false);

  readonly executing = new ReadonlySubject(this.executingSubject);

  private withMutex<T>(callback: Callback<T>) {
    return async () => {
      const release = await this.mutex.acquire();
      try {
        return await callback();
      } finally {
        release();
      }
    };
  }

  private withServerStatus<T>(callback: Callback<T>, validStatus: ServerStatus[]) {
    return async () => {
      if (validStatus.includes(this.serverProxy.status.value)) {
        return await callback();
      }
      return undefined;
    };
  }

  private withExecutionState<T>(callback: Callback<T>) {
    return async () => {
      try {
        this.executingSubject.next(true);
        return await callback();
      } finally {
        this.executingSubject.next(false);
      }
    };
  }

  private withSettings<T>(callback: CallbackWithSettings<T>) {
    return async () => {
      const userSettings = this.settingsManager.settings.value;
      const hostSettings = this.settingsManager.hostSettings;
      if (userSettings && hostSettings) {
        return await callback(userSettings, hostSettings);
      }
      return undefined;
    };
  }

  private async invokeCallback<T>(callback: CallbackWithSettings<T>, options: InvocationOptions = defaultInvocationOptions) {
    let wrappedCallback = this.withSettings(callback);
    if (options.validServerStatus.length > 0) {
      wrappedCallback = this.withServerStatus(wrappedCallback, options.validServerStatus);
    }
    if (options.updateExecutionState) {
      wrappedCallback = this.withExecutionState(wrappedCallback);
    }
    if (options.locked) {
      wrappedCallback = this.withMutex(wrappedCallback);
    }

    return await wrappedCallback();
  }

  constructor(private readonly settingsManager: SettingsManager, private readonly serverProxy: ServerProxy) {
  }

  async wakeOnLan(): Promise<void> {
    await this.invokeCallback(async (_, { hostName, address, mac, wolSettings }) => {
      await wakeOnLan(hostName, address, mac, wolSettings.port, wolSettings.useCustomWolExec ? wolSettings.customWolExecPath : null);
      await sleep(defaultSleepForUX);
      await this.serverProxy.refreshStatus();
    }, { ...defaultInvocationOptions, validServerStatus: ["Offline"] });
  }
}
