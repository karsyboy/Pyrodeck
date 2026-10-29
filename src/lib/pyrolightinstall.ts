import { call } from "@decky/api";
import { logger } from "./logger";

// The backend side is defaults/python/lib/pyrolightinstaller.py.
export interface InstalledPyrolight { path: string; tag: string; prerelease: boolean; installedAt: number }
export interface InstallProgress {
  state: "idle" | "checking" | "downloading" | "verifying" | "installed" | "failed";
  tag?: string;
  received?: number;
  total?: number | null;
  error?: string;
}
export interface InstallStatus {
  executable: string | null;
  onPath: string | null;
  installPath: string;
  installed: InstalledPyrolight | null;
  progress: InstallProgress;
}
export interface PyrolightRelease { tag: string; prerelease: boolean; publishedAt?: string; asset: { name: string; size?: number } }
interface Failure { ok: false; error: { code: string; message: string } }

export interface InstallState {
  status: InstallStatus | null;
  release: PyrolightRelease | null;
  releaseChannel: boolean | null;
  updateAvailable: boolean;
  checking: boolean;
  error: string | null;
}

/** How PyroDeck may manage the Pyrolight it uses. */
export type InstallMode = "missing" | "managed" | "package" | "selected" | "appimage";
export function installMode(status: InstallStatus, useSelected: boolean): InstallMode {
  if (!status.executable) return "missing";
  if (useSelected) return "selected";
  if (status.installed && status.executable === status.installed.path) return "managed";
  if (status.onPath && status.executable === status.onPath) return "package";
  return "appimage";
}
export function isInstalling(status: InstallStatus | null): boolean {
  return ["checking", "downloading", "verifying"].includes(status?.progress.state ?? "idle");
}
export function progressText(progress: InstallProgress): string {
  const megabytes = (value: number): string => (value / 1048576).toFixed(0);
  switch (progress.state) {
    case "checking": return "Looking for the latest release…";
    case "downloading":
      return `Downloading ${progress.tag ?? "Pyrolight"}: ${megabytes(progress.received ?? 0)}${progress.total ? ` of ${megabytes(progress.total)}` : ""} MB`;
    case "verifying": return "Verifying the download…";
    case "installed": return `Installed Pyrolight ${progress.tag ?? ""}`.trim();
    case "failed": return progress.error ?? "Installation failed";
    default: return "";
  }
}

const POLL_INTERVAL = 500;
// GitHub allows 60 anonymous API requests an hour per address.
export const RELEASE_CHECK_TTL = 600000;

/** One installation view shared by Quick Access, Updates and pairing. */
export class PyrolightInstallStore {
  private state: InstallState = { status: null, release: null, releaseChannel: null, updateAvailable: false, checking: false, error: null };
  private listeners = new Set<() => void>();
  private configuredPath: string | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private checkEpoch = 0;
  private checkedAt = -Infinity;
  getSnapshot = (): InstallState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(values: Partial<InstallState>): void {
    this.state = { ...this.state, ...values };
    this.listeners.forEach((listener) => listener());
  }

  async refresh(configuredPath: string | null = this.configuredPath): Promise<void> {
    this.configuredPath = configuredPath;
    try {
      const result = await call<[string | null], (InstallStatus & { ok: true }) | Failure>("pyrolight_install_status", configuredPath);
      if (!result.ok) throw new Error(result.error.message);
      this.update({ status: result });
      if (isInstalling(result)) this.schedulePoll();
    } catch (error) {
      logger.error("Could not read the Pyrolight installation", error);
      this.update({ error: String(error) });
    }
  }

  async check(prerelease: boolean, force = false): Promise<void> {
    if (!force && this.state.release && this.state.releaseChannel === prerelease && Date.now() - this.checkedAt < RELEASE_CHECK_TTL) return;
    const epoch = ++this.checkEpoch;
    this.update({ checking: true, error: null });
    try {
      const result = await call<[boolean], { ok: true; release: PyrolightRelease; updateAvailable: boolean } | Failure>("check_pyrolight_release", prerelease);
      if (epoch !== this.checkEpoch) return;
      if (!result.ok) throw new Error(result.error.message);
      this.checkedAt = Date.now();
      this.update({ release: result.release, releaseChannel: prerelease, updateAvailable: result.updateAvailable });
    } catch (error) {
      if (epoch === this.checkEpoch) this.update({ release: null, releaseChannel: prerelease, error: String(error) });
    } finally {
      if (epoch === this.checkEpoch) this.update({ checking: false });
    }
  }

  async install(prerelease: boolean): Promise<void> {
    if (isInstalling(this.state.status)) return;
    this.update({ error: null });
    try {
      const result = await call<[boolean], { ok: true } | Failure>("install_pyrolight", prerelease);
      if (!result.ok) throw new Error(result.error.message);
    } catch (error) {
      this.update({ error: String(error) });
      return;
    }
    await this.refresh();
  }

  private schedulePoll(): void {
    if (this.poll !== null) return;
    this.poll = setTimeout(() => {
      this.poll = null;
      const before = this.state.status?.progress.state;
      void this.refresh().then(() => {
        // A finished install changes what PyroDeck runs and whether it is current.
        const after = this.state.status?.progress.state;
        if (before !== after && after === "installed" && this.state.releaseChannel !== null)
          void this.check(this.state.releaseChannel, true);
      });
    }, POLL_INTERVAL);
  }
}
export const pyrolightInstall = new PyrolightInstallStore();
