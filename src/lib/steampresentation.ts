import { EDisplayStatus } from "@decky/ui/dist/globals/steam-client/App";

type SteamObject = Record<string, unknown>;
type Method = (...args: unknown[]) => unknown;
export interface StreamIdentity {
  helperAppId: number;
  steamAppId: number;
  gameId: string | null;
}
export interface PresentationHooks {
  after(
    target: SteamObject,
    method: string,
    handler: (args: unknown[], result: unknown) => unknown,
  ): () => void;
  before(
    target: SteamObject,
    method: string,
    handler: (args: unknown[]) => void,
  ): () => void;
}
interface Options {
  appStore: SteamObject;
  details?: SteamObject;
  router?: SteamObject;
  systemUI?: SteamObject;
  session: () => StreamIdentity | null;
  hooks: PresentationHooks;
  status: (message: string) => void;
}
interface Mapping {
  session: StreamIdentity;
  helper: SteamObject;
  native: SteamObject;
  view: SteamObject;
}
const runtimeFields = new Set([
  "local_per_client_data",
  "selected_per_client_data",
  "most_available_per_client_data",
  "per_client_data",
  "selected_clientid",
  "display_status",
  "status_per_client",
  "status_percentage",
  "installed",
  "active_beta",
  "is_available_on_current_platform",
  "is_invalid_os_type",
  "most_available_clientid"
]);
const object = (value: unknown): SteamObject | null =>
  value && typeof value === "object" ? (value as SteamObject) : null;

/** Native metadata for the owned helper; Steam's process records stay untouched. */
export function installSteamPresentation(options: Options): {
  refresh(): void;
  stop(): void;
} {
  const { appStore, details, router, systemUI, hooks } = options;
  const lookup = appStore.GetAppOverviewByAppID as Method;
  if (typeof lookup !== "function")
    throw new Error("Steam app overview lookup is unavailable");
  const raw = (id: number): SteamObject | null =>
    object(lookup.call(appStore, id));
  const cleanup: Array<() => void> = [];
  let cached: Mapping | null = null;
  let registeredId: number | null = null;
  let registration: { unregister(): void } | null = null;
  const releaseData = (): void => {
    registration?.unregister();
    registration = null;
    registeredId = null;
  };
  const mapping = (): Mapping | null => {
    const session = options.session();
    const helper = session ? raw(session.helperAppId) : null;
    const native = session ? raw(session.steamAppId) : null;
    const local = object(native?.local_per_client_data);
    const localRunning = [
      EDisplayStatus.Launching,
      EDisplayStatus.Running,
      EDisplayStatus.Terminating
    ].includes(local?.display_status as EDisplayStatus);
    if (
      !session ||
      !helper ||
      !native ||
      session.helperAppId === session.steamAppId ||
      localRunning
    ) {
      cached = null;
      releaseData();
      options.status(
        localRunning ?
          "Game is also running locally; stream stays separate" :
          "No matched stream"
      );
      return null;
    }
    if (registeredId !== session.steamAppId) {
      releaseData();
      registeredId = session.steamAppId;
      if (typeof details?.RegisterForAppData === "function")
        registration = (details.RegisterForAppData as Method).call(
          details,
          session.steamAppId
        ) as { unregister(): void };
    }
    if (
      cached?.helper === helper &&
      cached.native === native &&
      cached.session.helperAppId === session.helperAppId &&
      cached.session.steamAppId === session.steamAppId &&
      cached.session.gameId === session.gameId
    )
      return cached;
    const bound = new Map<PropertyKey, unknown>();
    const view: SteamObject = new Proxy(
      Object.create(
        Object.getPrototypeOf(native) as object | null
      ) as SteamObject,
      {
        get(_target, key) {
          if (key === "appid") return session.steamAppId;
          // Composition must continue to focus the real helper's Gamescope window.
          if (key === "shortcut_override_appid") return session.helperAppId;
          if (key === "gameid") return session.gameId ?? helper.gameid;
          if (key === "GetGameID") return () => session.gameId ?? helper.gameid;
          const source = runtimeFields.has(String(key)) ? helper : native;
          const value = Reflect.get(source, key, source) as unknown;
          if (typeof value !== "function") return value;
          if (!bound.has(key)) bound.set(key, (value as Method).bind(source));
          return bound.get(key);
        },
        // UI edits through this temporary projection can only affect the helper.
        set(_target, key, value) {
          return Reflect.set(helper, key, value, helper);
        },
        has(_target, key) {
          return key in native || key in helper;
        },
        ownKeys() {
          return [
            ...new Set([
              ...Reflect.ownKeys(native),
              ...Reflect.ownKeys(helper)
            ])
          ];
        },
        getOwnPropertyDescriptor(_target, key): PropertyDescriptor {
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: Reflect.get(view, key) as unknown
          };
        }
      }
    );
    cached = { session, helper, native, view };
    options.status(`Steam details: ${String(native.display_name)}`);
    return cached;
  };
  const after = (
    target: SteamObject | undefined,
    key: string,
    handler: (args: unknown[], result: unknown) => unknown
  ): void => {
    if (typeof target?.[key] === "function")
      cleanup.push(hooks.after(target, key, handler));
  };
  const execution = (target: SteamObject | undefined, key: string): void => {
    if (typeof target?.[key] !== "function") return;
    cleanup.push(
      hooks.before(target, key, (args) => {
        const active = mapping();
        if (active && args[0] === active.session.steamAppId)
          args[0] = active.session.helperAppId;
      })
    );
  };
  try {
    after(appStore, "GetAppOverviewByAppID", ([id], result) => {
      const active = mapping();
      return active && id === active.session.helperAppId ? active.view : result;
    });
    after(appStore, "GetAppOverviewByGameID", (_args, result) => {
      const active = mapping();
      return active && object(result)?.appid === active.session.helperAppId ?
        active.view :
        result;
    });
    for (const key of ["GetAppDetails", "GetAppData"]) {
      const original = details?.[key] as Method | undefined;
      if (typeof original === "function")
        after(details, key, ([id], result) => {
          const active = mapping();
          return active && id === active.session.helperAppId ?
              (original.call(details, active.session.steamAppId) ?? result) :
            result;
        });
    }
    // Images requested with an old/raw helper overview also use the real game.
    for (const [target, keys] of [
      [
        appStore,
        [
          "GetIconURLForApp",
          "GetLandscapeImageURLForApp",
          "GetVerticalCapsuleURLForApp",
          "GetCachedLandscapeImageURLForApp",
          "GetCachedVerticalImageURLForApp"
        ]
      ],
      [details, ["GetLogoImages", "GetHeroImages", "GetCapsuleImages"]]
    ] as const)
      for (const key of keys) {
        if (typeof target?.[key] === "function")
          cleanup.push(
            hooks.before(target, key, (args) => {
              const active = mapping();
              if (
                active &&
                object(args[0])?.appid === active.session.helperAppId
              )
                args[0] = active.native;
            })
          );
      }
    // These are window/process operations, never launch or install operations.
    execution(router, "SetRunningApp");
    const windows = object(router?.WindowStore);
    for (const key of [
      "GetAppWindowIDs",
      "GetAppFocusedWindowID",
      "SetFocusedAppWindowID",
      "BHasAppWindow",
      "GetOverlayInstances"
    ])
      execution(windows ?? undefined, key);
    for (const key of ["GetGameWindowsInfo", "CloseGameWindow"])
      execution(systemUI, key);
  } catch (error) {
    cleanup.reverse().forEach((remove) => remove());
    releaseData();
    throw error;
  }
  return {
    refresh: () => {
      mapping();
    },
    stop: () => {
      cleanup.reverse().forEach((remove) => remove());
      releaseData();
      cached = null;
      options.status("No matched stream");
    }
  };
}
