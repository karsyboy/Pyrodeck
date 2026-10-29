import { call } from "@decky/api";
import { isEqual } from "lodash";

export type SettingValue = number | boolean;
export interface SettingDescriptor {
  key: string;
  category: string;
  scope: "global" | "profile";
  application: "reconnect";
  type: "boolean" | "integer";
  minimum: number;
  maximum: number;
  choices?: { value: number; label: string; supported: boolean }[];
  requires?: string;
  disabledWhen?: string;
  supported?: boolean;
}
export interface Preferences {
  schema: 1;
  ok: true;
  revision: string;
  activeProfileId: string;
  activeProfileName: string;
  profiles: { id: string; name: string }[];
  values: Record<string, SettingValue>;
  profileDefaults?: Record<string, SettingValue>;
  registry: SettingDescriptor[];
  capabilities: { pyrowave: boolean; liveUpdates: boolean; displayProbe: string };
}
export interface ApiError { schema: number; ok: false; error: { code: string; message: string } }
export type SessionPhase = "none" | "waking" | "connecting" | "launching" | "streaming" | "disconnected" | "reconnecting" | "ending" | "ended" | "failed";
export interface SessionStatus {
  schema: number;
  state: SessionPhase;
  runnerActive?: boolean;
  // Wall-clock time of the last change, for diagnostics only.
  updatedAt?: number;
  // When the backend made this observation, on a clock that never goes back.
  observedAt?: number;
  generation?: string;
  // The runner's launch variant (AppType) and the Steam game ID of the shortcut that started it.
  launchKind?: number | null;
  launcherGameId?: string | null;
  hostId?: string;
  hostName?: string;
  appName?: string;
  remoteAppId?: number;
  steamAppId?: number;
  error?: string;
  effectivePreferences?: Preferences;
  diagnostics?: { codec: string; width: number; height: number; negotiatedFps: number; bitrateKbps: number; yuv444: boolean; displayDriver: string };
  displayBackend?: string;
  stage?: string;
  lastLifecycle?: string;
  window?: { id: number; shown: boolean; focused: boolean; rendererReady?: boolean; nativeId?: string; steamGameId?: string };
  quality?: "good" | "poor";
}
export interface RemoteApp { id: number; name: string; hdr_supported: boolean; lastPlayed?: number; sources: string[] }
export interface RemoteHost { id: string; name: string; status: string; error?: string; validated?: boolean; cached?: boolean; canWake?: boolean; validatedAt?: number; apps: RemoteApp[] }
export interface Catalog { schema: number; ok: true; defaultHostId: string | null; hosts: RemoteHost[] }

/**
 * A host PyroDeck may launch on: paired now, or validated within the backend's
 * retention window and only failing to answer (offline, or busy right after a
 * stream). The runner revalidates the host and app before every launch.
 */
export function isLaunchableHost(host: RemoteHost): boolean {
  return host.status === "paired" || Boolean(host.validated && host.cached);
}
export function eligibleHosts(catalog: Catalog, steamAppId: number): RemoteHost[] {
  const source = `steam:${steamAppId}`;
  return catalog.hosts.filter((host) => isLaunchableHost(host) && host.apps.filter((app) => steamSourceId(app) === steamAppId && app.sources.includes(source)).length === 1);
}
/** Why a launchable host is shown without a fresh catalog. */
export function unansweredHostMessage(host: RemoteHost): string | null {
  if (!host.cached) return null;
  return host.canWake ? `${host.name} is offline. Stream will try Wake-on-LAN.` : `${host.name} did not answer. Stream checks it again.`;
}
export function preferredHost(hosts: RemoteHost[], defaultId: string | null): string | null {
  // Even one alternative requires an explicit selection when the default is absent.
  return hosts.find((host) => host.id === defaultId)?.id ?? null;
}
export function appKind(app: RemoteApp): string {
  const kind = app.sources[0]?.split(":")[0];
  return kind && ["steam", "heroic", "lutris", "desktop"].includes(kind) ? kind : "other";
}
/** A single exact Steam identity; ambiguous source claims remain remote apps. */
export function steamSourceId(app: RemoteApp): number | null {
  const ids = [...new Set(app.sources.filter((source) => /^steam:[1-9][0-9]*$/.test(source)).map((source) => Number(source.slice(6))))];
  return ids.length === 1 && Number.isSafeInteger(ids[0]) && ids[0] < 0x80000000 ? ids[0] : null;
}
export function steamArtwork(app: RemoteApp): string | undefined {
  const id = steamSourceId(app);
  return id ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg` : undefined;
}

interface StoreState {
  preferences: Preferences | null;
  pending: Record<string, SettingValue>;
  session: SessionStatus;
  busy: boolean;
  error: string | null;
  message: string | null;
}

export class PyrolightIntegration {
  private state: StoreState = { preferences: null, pending: {}, session: { schema: 1, state: "none" }, busy: false, error: null, message: null };
  private settingsState = { preferences: this.state.preferences, pending: this.state.pending, busy: this.state.busy };
  private listeners = new Set<() => void>();
  private catalogPromise: Promise<Catalog> | null = null;
  private catalogTime = 0;
  private catalogLoading = false;
  private sessionRequest: Promise<void> | null = null;
  private preferencesRequest: Promise<void> | null = null;
  private sessionObservedAt = -Infinity;
  private pollUsers = new Set<object>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsEpoch = 0;
  getSnapshot = (): StoreState => this.state;
  getSettingsSnapshot = () => this.settingsState;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(values: Partial<StoreState>): void {
    if (Object.entries(values).every(([key, value]) => this.state[key as keyof StoreState] === value)) return;
    this.state = { ...this.state, ...values };
    if (this.settingsState.preferences !== this.state.preferences || this.settingsState.pending !== this.state.pending || this.settingsState.busy !== this.state.busy)
      this.settingsState = { preferences: this.state.preferences, pending: this.state.pending, busy: this.state.busy };
    this.listeners.forEach((listener) => listener());
  }

  refresh(): Promise<void> {
    if (this.preferencesRequest) return this.preferencesRequest;
    if (this.state.busy) return Promise.resolve();
    this.preferencesRequest = this.refreshPreferences().finally(() => { this.preferencesRequest = null; });
    return this.preferencesRequest;
  }

  private async refreshPreferences(): Promise<void> {
    const epoch = this.settingsEpoch;
    const session = this.refreshSession();
    try {
      const result = await call<[null], Preferences | ApiError>("pyrolight_settings", null);
      if (epoch !== this.settingsEpoch) return;
      if (!result.ok) throw new Error(result.error.message);
      // A draft keeps its original revision until explicitly discarded/applied.
      if (Object.keys(this.state.pending).length === 0) this.update({ preferences: isEqual(result, this.state.preferences) ? this.state.preferences : result, error: null });
      else if (result.revision !== this.state.preferences?.revision) this.update({ error: "Pyrolight settings changed elsewhere. Discard this draft and refresh before applying." });
    } catch (error) { this.update({ error: String(error) }); } finally { await session; }
  }

  refreshSession(afterPending = false): Promise<void> {
    // An explicit exit must observe status after cleanup, rather than join a
    // poll that read the still-running client before Exit was clicked.
    if (this.sessionRequest) return afterPending ? this.sessionRequest.then(() => this.refreshSession()) : this.sessionRequest;
    let request: Promise<SessionStatus>;
    try { request = call<[], SessionStatus>("session_status"); } catch (error) { this.update({ error: String(error) }); return Promise.resolve(); }
    this.sessionRequest = request.then((session) => {
      // Order observations by when the backend made them. Wall-clock
      // updatedAt can go back and an absent record has none: a new runner
      // generation or a cleared session must still replace the old stream.
      if (session.observedAt !== undefined) {
        if (session.observedAt < this.sessionObservedAt) return;
        this.sessionObservedAt = session.observedAt;
      }
      // Timestamps alone do not change any displayed state. Keep the snapshot
      // identity stable, while tracking freshness separately to reject races.
      const timeless = (value: SessionStatus) => ({ ...value, updatedAt: 0, observedAt: 0 });
      if (!isEqual(timeless(session), timeless(this.state.session)))
        this.update({ session });
    }).catch((error: unknown) => { this.update({ error: String(error) }); })
      .finally(() => { this.sessionRequest = null; });
    return this.sessionRequest;
  }

  /** One completion-paced poll for every mounted session view combined. */
  watchSession(): () => void {
    const user = {};
    this.pollUsers.add(user);
    if (this.pollUsers.size === 1) this.pollSession();
    return () => {
      this.pollUsers.delete(user);
      if (!this.pollUsers.size && this.pollTimer !== null) {
        clearTimeout(this.pollTimer); this.pollTimer = null;
      }
    };
  }

  private pollSession(): void {
    void this.refreshSession().finally(() => {
      if (!this.pollUsers.size || this.pollTimer !== null) return;
      this.pollTimer = setTimeout(() => {
        this.pollTimer = null;
        this.pollSession();
      }, 2000);
    });
  }

  stage(key: string, value: SettingValue): void {
    if (this.state.busy || !this.state.preferences?.registry.some((descriptor) => descriptor.key === key)) return;
    const pending = { ...this.state.pending, [key]: value };
    if (this.state.preferences.values[key] === value) delete pending[key];
    this.update({ pending, message: null });
  }

  async discard(): Promise<void> { this.settingsEpoch++; this.update({ pending: {}, error: null, message: null }); await this.refresh(); }
  async apply(reconnect: boolean): Promise<void> {
    if (this.state.busy || !this.state.preferences || !Object.keys(this.state.pending).length) return;
    this.settingsEpoch++;
    this.update({ busy: true, error: null, message: null });
    try {
      const request = { schema: 1, operation: "patch", revision: this.state.preferences.revision, values: this.state.pending };
      const result = await call<[typeof request, boolean], { ok: boolean; preferences?: Preferences; persisted?: boolean; error?: { message: string } }>("apply_pyrolight_settings", request, reconnect);
      if (result.preferences) this.update({ preferences: result.preferences });
      if (!result.ok) throw new Error(`${result.persisted ? "Saved for the next launch, but the stream has not confirmed these changes. " : ""}${result.error?.message ?? "Settings could not be applied"}`);
      this.update({ pending: {}, message: reconnect ? "Stream reconnected with your settings." : "Saved in Pyrolight for the next session." });
      await this.refreshSession();
    } catch (error) { this.update({ error: String(error) }); } finally { this.update({ busy: false }); }
  }

  async profile(operation: string, name?: string): Promise<void> {
    if (this.state.busy || !this.state.preferences || Object.keys(this.state.pending).length) return;
    this.settingsEpoch++;
    this.update({ busy: true, error: null });
    try {
      const request = { schema: 1, operation: operation === "restore" ? "defaults" : operation, revision: this.state.preferences.revision, profileId: this.state.preferences.activeProfileId, name };
      const result = await call<[typeof request], Preferences | ApiError>("pyrolight_settings", request);
      if (!result.ok) throw new Error(result.error.message);
      if (operation === "restore") {
        const pending = Object.fromEntries(Object.entries(result.profileDefaults ?? {}).filter(([key, value]) => result.values[key] !== value));
        this.update({ preferences: result, pending, message: "Default profile values are staged. Apply explicitly to save them." });
        return;
      }
      this.update({ preferences: result, message: "Profile saved in Pyrolight. Running streams keep their launch settings." });
    } catch (error) { this.update({ error: String(error) }); } finally { this.update({ busy: false }); }
  }

  async activate(profileId: string): Promise<void> {
    if (this.state.busy || !this.state.preferences || Object.keys(this.state.pending).length) return;
    this.settingsEpoch++;
    this.update({ busy: true, error: null });
    try {
      const request = { schema: 1, operation: "activate", revision: this.state.preferences.revision, profileId };
      const result = await call<[typeof request], Preferences | ApiError>("pyrolight_settings", request);
      if (!result.ok) throw new Error(result.error.message);
      this.update({ preferences: result, message: "Active profile changed for subsequent launches. Reconnect explicitly to use it now." });
    } catch (error) { this.update({ error: String(error) }); } finally { this.update({ busy: false }); }
  }

  async reconnect(): Promise<void> {
    if (this.state.busy) return;
    this.settingsEpoch++;
    this.update({ busy: true, error: null });
    try {
      const result = await call<[], { ok: boolean; error?: { message: string } }>("reconnect_session");
      if (!result.ok) throw new Error(result.error?.message ?? "Reconnect failed");
      await this.refreshSession();
    } catch (error) { this.update({ error: String(error) }); } finally { this.update({ busy: false }); }
  }

  catalog(refresh = false, preferCached = false): Promise<Catalog> {
    if (this.catalogLoading && this.catalogPromise) return this.catalogPromise;
    // Navigating between Library pages during a stream must not start another
    // headless client just because the normal browsing TTL elapsed. Explicit
    // refresh still works, and the runner revalidates every launch target.
    const streaming = preferCached || this.state.session.runnerActive;
    if (refresh || !this.catalogPromise || (!streaming && Date.now() - this.catalogTime > 30000)) {
      this.catalogTime = Date.now();
      this.catalogLoading = true;
      let request: Promise<Catalog | ApiError>;
      try { request = call<[boolean], Catalog | ApiError>("remote_catalog", refresh); } catch (error) { this.catalogLoading = false; this.catalogPromise = null; return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
      this.catalogPromise = request.then((result) => {
        if (!result.ok) throw new Error(result.error.message);
        return result;
      }).catch((error: unknown) => { this.catalogPromise = null; throw error; })
        .finally(() => { this.catalogLoading = false; });
    }
    return this.catalogPromise;
  }
}
export const pyrolightIntegration = new PyrolightIntegration();
