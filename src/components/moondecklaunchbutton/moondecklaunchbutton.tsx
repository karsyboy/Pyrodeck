import { AppType, isAppTypeSupported } from "../../lib/launchenv";
import { Catalog, eligibleHosts, preferredHost, pyrolightIntegration, steamSourceId } from "../../lib/pyrolightintegration";
import { FC, useContext, useEffect, useRef, useState } from "react";
import { Menu, MenuItem, showContextMenu } from "@decky/ui";
import { useCurrentSettings, useMoonDeckAppData } from "../../hooks";
import { usePyrolightSession, useSessionPolling } from "../../hooks/usepyrolight";
import { MoonDeckContext } from "../../contexts";
import { StreamAction } from "./streamaction";
import { logger } from "../../lib/logger";
import { steamIntegrationStatus } from "../../lib/steamintegrationstatus";

interface Props { appId: number; appName: string; appType: number }
export const MoonDeckLaunchButtonShell: FC = () => <StreamAction label="Stream" disabled />;

const MoonDeckLaunchButton: FC<Props> = ({ appId, appName, appType }) => {
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const settings = useCurrentSettings();
  const activeApp = useMoonDeckAppData();
  const session = usePyrolightSession();
  useSessionPolling();
  const streaming = useRef(false);
  streaming.current = Boolean(session.runnerActive || activeApp);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [alternative, setAlternative] = useState<string | null>(null);
  const menu = useRef<ReturnType<typeof showContextMenu> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    setCatalog(null);
    setAlternative(null);
    setError(null);
    const refresh = (force = false): void => {
      if (loading) return;
      loading = true;
      void pyrolightIntegration.catalog(force).then((value) => {
        if (cancelled) return;
        const hosts = eligibleHosts(value, appId);
        setCatalog(value);
        steamIntegrationStatus.update({
          eligibleHostIds: hosts.map((host) => host.id),
          library: `${appName}: ${hosts.length ? `${hosts.length} streaming host(s) available` : "no validated host match"}`
        });
      }).catch((problem: unknown) => {
        if (!cancelled) steamIntegrationStatus.update({ library: `${appName}: catalog failed (${String(problem)})` });
        logger.error("Library catalog query failed", problem);
      }).finally(() => { loading = false; });
    };
    refresh();
    const timer = setInterval(() => {
      // Catalog refresh launches a separate headless Pyrolight process. Keep
      // the validated catalog during gameplay; revalidate at the next launch.
      if (!document.hidden && !streaming.current) refresh(true);
    }, 30000);
    return () => { cancelled = true; clearInterval(timer); menu.current?.Hide(); menu.current = null; };
  }, [appId, appName]);
  if (!isAppTypeSupported(appType) || !settings || !catalog) return null;
  const hosts = eligibleHosts(catalog, appId);
  if (!hosts.length) return null;
  const retained = session.steamAppId === appId && session.hostId && session.state !== "ended" && session.state !== "none";
  // Resume always retains the original host. An explicit dropdown selection
  // affects this launch only; it never writes the configured default.
  const hostId = alternative ?? (retained && hosts.some((host) => host.id === session.hostId) ? session.hostId! : preferredHost(hosts, settings.currentHostId ?? catalog.defaultHostId));
  const selected = hosts.find((host) => host.id === hostId);
  const same = retained && session.hostId === hostId;
  const active = Boolean(same && session.runnerActive) || activeApp?.steamAppId === appId;
  const progress = session.state === "waking" ? "Waking host…" : session.stage === "starting_window" ? "Starting stream…" : session.state === "launching" ? "Starting game…" : "Connecting…";
  const failure = error ?? (same && session.state === "failed" ? session.error : null);
  const label = active ? (session.state === "streaming" ? "Streaming" : progress) : failure ? "Retry Stream" : same ? "Resume Stream" : "Stream";
  return (
    <StreamAction
      label={busy ? "Connecting…" : label}
      disabled={busy || active}
      launchDisabled={!selected}
      hostName={selected?.name}
      message={failure ?? (selected?.cached && !active ? `${selected.name} is offline. Stream will try Wake-on-LAN.` : null)}
      onLaunch={() => {
        if (!selected || busy) return;
        const remoteAppId = selected.apps.find((app) => steamSourceId(app) === appId)?.id;
        if (!remoteAppId) return;
        setBusy(true);
        setError(null);
        void moonDeckAppLauncher.launchApp(appId, appName, AppType.MoonDeck, undefined, { hostId: selected.id, remoteAppId })
          .catch((problem: unknown) => setError(String(problem)))
          .finally(() => { setBusy(false); void pyrolightIntegration.refreshSession(); });
      }}
      onChooseHost={hosts.length > 1 || !selected ?
          (anchor) => {
            menu.current?.Hide();
            menu.current = showContextMenu(
              <Menu label="Stream from">
                {hosts.map((host) => (
                  <MenuItem key={host.id} selected={host.id === hostId} onSelected={() => setAlternative(host.id)}>
                    {host.name}
                    {host.cached ? " · offline" : ""}
                  </MenuItem>
                ))}
              </Menu>, anchor,
              { bOverlapHorizontal: true, bPreferPopTop: true }
            );
          } :
        undefined}
    />
  );
};

/** Library action beside Steam Input, sharing its controller navigation context. */
export const MoonDeckLaunchButtonAnchor: FC<Props> = (props) => <div id="pyrodeck"><MoonDeckLaunchButton key={props.appId} {...props} /></div>;
