import { CommandProxy } from "./commandproxy";
import { IncrementalLoop } from "./incrementalloop";
import { ServerProxy } from "./serverproxy";
import { SettingsManager } from "./settingsmanager";
import { Subscription } from "rxjs";
import { logger } from "./logger";

export class ConnectivityManager {
  private readonly settingsManager: SettingsManager;
  private subscription: Subscription | null = null;

  readonly serverProxy: ServerProxy;
  readonly commandProxy: CommandProxy;

  // Polls serverinfo only while a PyroDeck view that shows host status is open.
  readonly serverAutoRefresh = new IncrementalLoop(async () => { await this.serverProxy.refreshStatus(); }, 5000);

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager;

    this.serverProxy = new ServerProxy(this.settingsManager);
    this.commandProxy = new CommandProxy(this.settingsManager, this.serverProxy);
  }

  init(): void {
    this.serverAutoRefresh.init().catch((e) => logger.critical(e));
    this.subscription = new Subscription();
    this.subscription.add(this.settingsManager.settings.asObservable().subscribe(() => {
      this.refresh().catch((e) => logger.critical(e));
    }));
  }

  deinit(): void {
    this.serverAutoRefresh.deinit().catch((e) => logger.critical(e));
    if (this.subscription !== null) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  async refresh(): Promise<void> {
    await this.serverProxy.refreshStatus();
  }
}
