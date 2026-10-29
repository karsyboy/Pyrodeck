import { call } from "@decky/api";
import { logger } from "./logger";

// The backend side is defaults/python/lib/pyrodeckupdate.py.
export interface PyroDeckRelease {
  tag: string;
  prerelease: boolean;
  publishedAt?: string;
  sha256: string;
  asset: { name: string; size?: number; url: string };
}
export interface UpdateState {
  current: string | null;
  release: PyroDeckRelease | null;
  channel: boolean | null;
  updateAvailable: boolean;
  checking: boolean;
  requested: boolean;
  error: string | null;
}
interface Failure { ok: false; current?: string; error: { code: string; message: string } }

// Decky Loader's plugin install route and its install types.
interface DeckyRouter { call<Args extends unknown[], Return>(route: string, ...args: Args): Promise<Return> }
export const DECKY_INSTALL_ROUTE = "utilities/install_plugin";
export const DECKY_INSTALL_UPDATE = 2;
export const PLUGIN_NAME = "PyroDeck";
// GitHub allows 60 anonymous API requests an hour per address.
export const UPDATE_CHECK_TTL = 600000;

function deckyBackend(): DeckyRouter | null {
  const router = (window as unknown as { DeckyBackend?: DeckyRouter }).DeckyBackend;
  return typeof router?.call === "function" ? router : null;
}

/** PyroDeck's own updates, installed through Decky's confirmed plugin installer. */
export class PyroDeckUpdateStore {
  private state: UpdateState = { current: null, release: null, channel: null, updateAvailable: false, checking: false, requested: false, error: null };
  private listeners = new Set<() => void>();
  private checkedAt = -Infinity;
  private epoch = 0;
  getSnapshot = (): UpdateState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(values: Partial<UpdateState>): void {
    this.state = { ...this.state, ...values };
    this.listeners.forEach((listener) => listener());
  }

  async check(prerelease: boolean, force = false): Promise<void> {
    if (!force && this.state.channel === prerelease && !this.state.error && Date.now() - this.checkedAt < UPDATE_CHECK_TTL) return;
    const epoch = ++this.epoch;
    this.update({ checking: true, error: null, channel: prerelease });
    try {
      const result = await call<[boolean], { ok: true; current: string; release: PyroDeckRelease; updateAvailable: boolean } | Failure>("check_pyrodeck_update", prerelease);
      if (epoch !== this.epoch) return;
      if (!result.ok) {
        this.update({ current: result.current ?? this.state.current, release: null, updateAvailable: false, error: result.error.message });
        return;
      }
      this.checkedAt = Date.now();
      this.update({ current: result.current, release: result.release, updateAvailable: result.updateAvailable });
    } catch (error) {
      if (epoch === this.epoch) this.update({ release: null, updateAvailable: false, error: String(error) });
    } finally {
      if (epoch === this.epoch) this.update({ checking: false });
    }
  }

  /** Ask Decky to install the checked release; Decky shows its own confirmation. */
  async install(): Promise<void> {
    const release = this.state.release;
    if (!release || !this.state.updateAvailable) return;
    const router = deckyBackend();
    if (!router) {
      this.update({ error: `This Decky Loader cannot install updates for plugins. Install ${release.asset.url} from Decky's Developer settings.` });
      return;
    }
    try {
      // Decky verifies the ZIP against this SHA-256 before replacing PyroDeck.
      await router.call(DECKY_INSTALL_ROUTE, release.asset.url, PLUGIN_NAME, release.tag.replace(/^v/, ""), release.sha256, DECKY_INSTALL_UPDATE);
      logger.log(`Requested PyroDeck ${release.tag} from Decky`);
      this.update({ requested: true, error: null });
    } catch (error) {
      logger.error("Decky could not start the PyroDeck update", error);
      this.update({ error: `Decky could not start the update: ${String(error)}` });
    }
  }
}
export const pyroDeckUpdate = new PyroDeckUpdateStore();
