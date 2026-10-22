import { AppType, setShortcutName, terminateApp } from "./steamutils";
import { BehaviorSubject } from "rxjs";
import { Mutex } from "async-mutex";
import { ReadonlySubject } from "./readonlysubject";
import { call } from "@decky/api";
import { isEqual } from "lodash";
import { logger } from "./logger";

export type RunnerResult = "TERMINATED" | (string & {}) | null;

async function killRunner(): Promise<void> {
  try {
    await call<[], unknown>("kill_runner");
  } catch (message) {
    logger.critical("Error while killing runner script: ", message);
  }
}

async function suspendRunner(): Promise<boolean> {
  try {
    return await call<[], boolean>("suspend_runner");
  } catch (message) {
    logger.critical("Error while suspending runner script: ", message);
    return false;
  }
}

async function unsuspendRunner(): Promise<boolean> {
  try {
    return await call<[], boolean>("unsuspend_runner");
  } catch (message) {
    logger.critical("Error while unsuspending runner script: ", message);
    return false;
  }
}

async function isRunnerActive(): Promise<boolean> {
  try {
    return await call<[], boolean>("is_runner_active");
  } catch (message) {
    logger.critical("Error while getting runner status: ", message);
  }
  return false;
}

async function getRunnerResult(): Promise<RunnerResult> {
  try {
    return await call<[], RunnerResult>("get_runner_result");
  } catch (message) {
    logger.critical("Error while fetching runner result: ", message);
  }

  return "Error while fetching runner result!";
}

function getAppId(appData: MoonDeckAppData) {
  return appData.moonDeckAppId ?? appData.steamAppId;
}

export interface SessionOptions {
  nameSetToAppId: boolean;
}

export interface MoonDeckAppData {
  steamAppId: number;
  moonDeckAppId: number | null;
  name: string;
  appType: AppType;
  redirected: boolean;
  launcherGameId: string | null;
  sessionOptions: SessionOptions;
}

export class MoonDeckAppProxy extends ReadonlySubject<MoonDeckAppData | null> {
  private readonly nameMutex = new Mutex();
  private generation = 0;
  closing = false;
  constructor() {
    super(new BehaviorSubject<MoonDeckAppData | null>(null));
  }

  setApp(
    steamAppId: number,
    moonDeckAppId: number,
    name: string,
    appType: AppType,
    sessionOptions: SessionOptions,
    launcherGameId: string | null = null
  ): void {
    this.generation++;
    this.closing = false;
    this.subject.next({
      steamAppId,
      moonDeckAppId: appType === AppType.MoonDeck ? moonDeckAppId : null,
      name,
      appType,
      redirected: false,
      launcherGameId,
      sessionOptions
    });
  }

  getAppId() {
    if (this.subject.value === null) {
      return false;
    }

    return getAppId(this.subject.value);
  }

  async applySessionOptions(): Promise<void> {
    if (this.closing) return;
    const options = this.subject.value?.sessionOptions ?? null;
    if (options === null) {
      return;
    }

    if (!(await this.changeName(options.nameSetToAppId))) {
      logger.toast("Failed to change shortcut name!", { output: "warn" });
    }
  }

  async changeName(_changeToAppId: boolean): Promise<boolean> {
    const generation = this.generation;
    return await this.nameMutex.runExclusive(async () => {
      const current = this.subject.value;
      if (
        !current || generation !== this.generation
      )
        return false;
      if (current.moonDeckAppId === null) return true;
      const result = await setShortcutName(
        current.moonDeckAppId,
        current.name
      );
      if (generation !== this.generation || !this.subject.value) return false;
      if (result) {
        const newValue = {
          ...this.subject.value,
          sessionOptions: {
            ...this.subject.value.sessionOptions,
            nameSetToAppId: false
          }
        };
        if (!isEqual(this.subject.value, newValue)) this.subject.next(newValue);
      }
      return result;
    });
  }

  canRedirect(): boolean {
    if (this.subject.value === null || this.subject.value.redirected) {
      return false;
    }

    this.subject.next({ ...this.subject.value, redirected: true });
    return true;
  }

  async clearApp(): Promise<void> {
    if (this.subject.value === null) {
      return;
    }

    const generation = this.generation;
    await this.changeName(false);
    if (generation === this.generation) {
      this.generation++;
      this.subject.next(null);
    }
  }

  async killApp(forceCleanup = false): Promise<void> {
    if (this.subject.value === null) {
      if (forceCleanup) {
        await killRunner();
      }
      return;
    }

    if (this.closing) return;
    this.closing = true;
    const nameSetToAppId = this.subject.value.sessionOptions.nameSetToAppId;
    const appId = getAppId(this.subject.value);
    // Necessary, otherwise the termination fails
    await this.changeName(false);
    if (!(await terminateApp(appId, 5000))) {
      logger.warn("Failed to terminate, trying to kill!");
      await killRunner();
    }

    // If someone cleared it already, we can exit YAY \0/
    if (this.subject.value === null) {
      return;
    }

    // Reset the original value
    if (nameSetToAppId) {
      const newValue = {
        ...this.subject.value,
        sessionOptions: {
          ...this.subject.value.sessionOptions,
          nameSetToAppId
        }
      };
      if (!isEqual(this.subject.value, newValue)) {
        this.subject.next(newValue);
      }
    }
  }

  async suspendApp(): Promise<void> {
    if (this.subject.value === null) {
      return;
    }

    if (!(await suspendRunner())) {
      await this.killApp();
      await this.clearApp();
    }
  }

  async unsuspendApp(): Promise<void> {
    if (this.subject.value === null) {
      return;
    }

    if (!(await unsuspendRunner())) {
      await this.killApp();
      await this.clearApp();
    }
  }

  async getRunnerResult(): Promise<RunnerResult> {
    return await getRunnerResult();
  }

  async clearRunnerResult(): Promise<void> {
    // Getting the result clears it automatically
    await this.getRunnerResult();
  }

  async isStillRunning(): Promise<boolean> {
    return await isRunnerActive();
  }
}
