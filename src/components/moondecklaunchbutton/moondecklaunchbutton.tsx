import { AppType, UserSettings, isAppTypeSupported, logger } from "../../lib";
import {
  Button,
  DropdownItem,
  Field,
  Focusable,
  basicAppDetailsSectionStylerClasses,
  joinClassNames,
  playSectionClasses
} from "@decky/ui";
import {
  Catalog,
  eligibleHosts,
  preferredHost,
  pyrolightIntegration
} from "../../lib/pyrolightintegration";
import { FC, useContext, useEffect, useState } from "react";
import { useCurrentSettings, useMoonDeckAppData } from "../../hooks";
import { ButtonStyle } from "./buttonstyle";
import { ContainerStyle } from "./containerstyle";
import { MoonDeckContext } from "../../contexts";
import { MoonDeckMain } from "../icons";
import { OffsetStyle } from "./offsetstyle";
import { steamIntegrationStatus } from "../../lib/steamintegrationstatus";

interface Props {
  appId: number;
  appName: string;
  appType: number;
}

interface ShellProps {
  buttonPosition?: UserSettings["buttonPosition"];
  buttonStyle: UserSettings["buttonStyle"];
  onClick?: (onDone: () => void) => void;
}

export const MoonDeckLaunchButtonShell: FC<ShellProps> = ({
  onClick,
  buttonPosition,
  buttonStyle
}) => {
  const [clickPending, setClickPending] = useState(false);
  const handleClick = (() => {
    if (onClick) {
      return () => {
        setClickPending(true);
        onClick(() => setClickPending(false));
      };
    }
    return undefined;
  })();

  return (
    <Focusable
      className={joinClassNames(
        basicAppDetailsSectionStylerClasses.AppButtons,
        "pyrodeck-container"
      )}
    >
      <OffsetStyle buttonPosition={buttonPosition} />
      <ContainerStyle buttonPosition={buttonPosition} />
      <ButtonStyle theme={buttonStyle.theme} />
      <Focusable>
        <Button
          disabled={clickPending}
          noFocusRing={!buttonStyle.showFocusRing}
          className={joinClassNames(
            playSectionClasses.MenuButton,
            "pyrodeck-button"
          )}
          onClick={handleClick}
        >
          <MoonDeckMain />
        </Button>
      </Focusable>
    </Focusable>
  );
};

const MoonDeckLaunchButton: FC<Props> = ({ appId, appName, appType }) => {
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const settings = useCurrentSettings();
  const activeApp = useMoonDeckAppData();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isAppTypeSupported(appType)) return;
    let cancelled = false;
    let initialized = false;
    let loading = false;
    const refresh = (force = false): void => {
      if (loading) return;
      loading = true;
      void pyrolightIntegration
        .catalog(force)
        .then((value) => {
          if (cancelled) return;
          const hosts = eligibleHosts(value, appId);
          setCatalog(value);
          setError(null);
          steamIntegrationStatus.update({ library: `${appName}: ${hosts.length ? `${hosts.length} streaming host(s) available` : "no eligible streaming host"}` });
          logger.debug(`Library game ${appId}: ${hosts.length} eligible streaming host(s)`);
          if (!initialized) {
            setHostId(
              preferredHost(
                hosts,
                settings?.currentHostId ?? value.defaultHostId
              )
            );
            initialized = true;
          } else {
            setHostId((current) =>
              hosts.some((host) => host.id === current) ? current : null
            );
          }
        })
        .catch((problem: unknown) => { if (!cancelled) { setError(String(problem)); steamIntegrationStatus.update({ library: `${appName}: catalog failed` }); } logger.error("Library catalog query failed", problem); })
        .finally(() => {
          loading = false;
        });
    };
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh(true);
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [appId, appName, appType, settings?.currentHostId]);
  if (!isAppTypeSupported(appType) || !settings) return null;
  if (error) return <Field label="Pyrolight streaming unavailable" description={error} />;
  if (!catalog) return <Button disabled>Checking Pyrolight hosts…</Button>;
  const hosts = eligibleHosts(catalog, appId);
  if (!hosts.length) return null;
  return (
    <Focusable
      style={{
        padding: "12px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      {(hosts.length > 1 || hostId === null) && (
        <DropdownItem
          label="Streaming host"
          selectedOption={hostId ?? ""}
          rgOptions={[
            { data: "", label: "Choose a host" },
            ...hosts.map((host) => ({ data: host.id, label: host.name }))
          ]}
          onChange={(choice) => setHostId((choice.data as string) || null)}
          disabled={busy}
        />
      )}
      <Button
        disabled={busy || !hostId || activeApp !== null}
        onClick={() => {
          if (!hostId || busy) return;
          const remoteAppId = hosts
            .find((host) => host.id === hostId)
            ?.apps.find((app) => app.sources.includes(`steam:${appId}`))?.id;
          if (!remoteAppId) return;
          setBusy(true);
          void moonDeckAppLauncher
            .launchApp(appId, appName, AppType.MoonDeck, undefined, {
              hostId,
              remoteAppId
            })
            .catch((error: unknown) => logger.critical(error))
            .finally(() => setBusy(false));
        }}
      >
        {activeApp?.steamAppId === appId ?
          "Streaming with Pyrolight" :
          "Stream with Pyrolight"}
        {hostId ?
          ` · ${hosts.find((host) => host.id === hostId)?.name ?? ""}` :
          ""}
      </Button>
    </Focusable>
  );
};

/** A normal flow section; Steam owns its own launch/fullscreen transitions. */
export const MoonDeckLaunchButtonAnchor: FC<Props> = (props) => (
  <div id="pyrodeck">
    <MoonDeckLaunchButton {...props} />
  </div>
);
