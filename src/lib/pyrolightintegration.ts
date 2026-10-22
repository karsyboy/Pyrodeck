import { call } from "@decky/api";

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
export type SessionPhase = "none" | "connecting" | "launching" | "streaming" | "disconnected" | "reconnecting" | "ending" | "ended" | "failed";
export interface SessionStatus {
  schema: number;
  state: SessionPhase;
  runnerActive?: boolean;
  updatedAt?: number;
  generation?: string;
  hostId?: string;
  hostName?: string;
  appName?: string;
  remoteAppId?: number;
  steamAppId?: number;
  error?: string;
  effectivePreferences?: Preferences;
  diagnostics?: { codec: string; width: number; height: number; negotiatedFps: number; bitrateKbps: number; yuv444: boolean; displayDriver: string };
  displayBackend?: string;
  quality?: "good" | "poor";
}
export interface RemoteApp { id: number; name: string; hdr_supported: boolean; lastPlayed?: number; sources: string[] }
export interface RemoteHost { id: string; name: string; status: string; error?: string; apps: RemoteApp[] }
export interface Catalog { schema: number; ok: true; defaultHostId: string | null; hosts: RemoteHost[] }

export function eligibleHosts(catalog: Catalog, steamAppId: number): RemoteHost[] {
  const source = `steam:${steamAppId}`;
  return catalog.hosts.filter((host) => host.status === "paired" && host.apps.filter((app) => app.sources.includes(source)).length === 1);
}
export function preferredHost(hosts: RemoteHost[], defaultId: string | null): string | null {
  // Even one alternative requires an explicit selection when the default is absent.
  return hosts.find((host) => host.id === defaultId)?.id ?? null;
}
export function appKind(app: RemoteApp): string {
  const kind = app.sources[0]?.split(":")[0];
  return kind && ["steam", "heroic", "lutris", "desktop"].includes(kind) ? kind : "other";
}
export function steamArtwork(app: RemoteApp): string | undefined {
  const source = app.sources.find((value) => /^steam:[1-9][0-9]*$/.test(value));
  return source ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${source.slice(6)}/library_600x900.jpg` : undefined;
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
  private listeners = new Set<() => void>();
  private catalogPromise: Promise<Catalog> | null = null;
  private catalogTime = 0;
  private settingsEpoch = 0;
  getSnapshot = (): StoreState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(values: Partial<StoreState>): void {
    this.state = { ...this.state, ...values };
    this.listeners.forEach((listener) => listener());
  }

  async refresh(): Promise<void> {
    if (this.state.busy) return;
    const epoch = this.settingsEpoch;
    try {
      const result = await call<[null], Preferences | ApiError>("pyrolight_settings", null);
      if (epoch !== this.settingsEpoch) return;
      if (!result.ok) throw new Error(result.error.message);
      // A draft keeps its original revision until explicitly discarded/applied.
      if (Object.keys(this.state.pending).length === 0) this.update({ preferences: result, error: null });
      else if (result.revision !== this.state.preferences?.revision) this.update({ error: "Pyrolight settings changed elsewhere. Discard this draft and refresh before applying." });
      await this.refreshSession();
    } catch (error) { this.update({ error: String(error) }); }
  }

  async refreshSession(): Promise<void> {
    try {
      const session = await call<[], SessionStatus>("session_status");
      if ((session.updatedAt ?? 0) >= (this.state.session.updatedAt ?? 0)) this.update({ session });
    } catch (error) { this.update({ error: String(error) }); }
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

  catalog(refresh = false): Promise<Catalog> {
    if (refresh || !this.catalogPromise || Date.now() - this.catalogTime > 30000) {
      this.catalogTime = Date.now();
      this.catalogPromise = call<[boolean], Catalog | ApiError>("remote_catalog", refresh).then((result) => {
        if (!result.ok) throw new Error(result.error.message);
        return result;
      }).catch((error: unknown) => { this.catalogPromise = null; throw error; });
    }
    return this.catalogPromise;
  }
}
export const pyrolightIntegration = new PyrolightIntegration();
