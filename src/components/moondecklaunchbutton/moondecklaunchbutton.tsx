import { AppType, UserSettings, isAppTypeSupported, logger } from "../../lib";
import {
  Button,
  DropdownItem,
  Focusable,
  appDetailsClasses,
  appDetailsHeaderClasses,
  basicAppDetailsSectionStylerClasses,
  joinClassNames,
  playSectionClasses
} from "@decky/ui";
import {
  CSSProperties,
  FC,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import {
  Catalog,
  eligibleHosts,
  preferredHost,
  pyrolightIntegration
} from "../../lib/pyrolightintegration";
import { OffsetStyle, achorPositionName } from "./offsetstyle";
import { ButtonStyle } from "./buttonstyle";
import { ContainerStyle } from "./containerstyle";
import { MoonDeckContext } from "../../contexts";
import { MoonDeckMain } from "../icons";
import { useCurrentSettings } from "../../hooks";

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
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isAppTypeSupported(appType)) return;
    let cancelled = false;
    let initialized = false;
    let loading = false;
    const refresh = (force = false): void => {
      if (loading) return;
      loading = true;
      void pyrolightIntegration.catalog(force).then((value) => {
        if (cancelled) return;
        const hosts = eligibleHosts(value, appId);
        setCatalog(value);
        if (!initialized) {
          setHostId(preferredHost(hosts, settings?.currentHostId ?? value.defaultHostId));
          initialized = true;
        } else {
          setHostId((current) => hosts.some((host) => host.id === current) ? current : null);
        }
      }).catch((error: unknown) => logger.debug(String(error))).finally(() => { loading = false; });
    };
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(true); }, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [appId, appType, settings?.currentHostId]);
  if (!isAppTypeSupported(appType) || !settings || !catalog) return null;
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
        disabled={busy || !hostId}
        onClick={() => {
          if (!hostId || busy) return;
          setBusy(true);
          void moonDeckAppLauncher
            .launchApp(appId, appName, AppType.MoonDeck, undefined, { hostId })
            .catch((error: unknown) => logger.critical(error))
            .finally(() => setBusy(false));
        }}
      >
        Stream with Pyrolight
        {hostId ?
          ` · ${hosts.find((host) => host.id === hostId)?.name ?? ""}` :
          ""}
      </Button>
    </Focusable>
  );
};

function findTopCapsuleParent(ref: HTMLDivElement | null): Element | null {
  const children = ref?.parentElement?.children;
  if (!children) {
    return null;
  }

  let headerContainer: Element | undefined;
  for (const child of children) {
    if (child.className.includes(appDetailsClasses.Header)) {
      headerContainer = child;
      break;
    }
  }

  if (!headerContainer) {
    return null;
  }

  let topCapsule: Element | null = null;
  for (const child of headerContainer.children) {
    if (child.className.includes(appDetailsHeaderClasses.TopCapsule)) {
      topCapsule = child;
      break;
    }
  }

  return topCapsule;
}

export const MoonDeckLaunchButtonAnchor: FC<Props> = (props) => {
  // There will be no mutation when the page is loaded (either from exiting the game
  // or just newly opening the page), therefore it's visible by default.
  const [show, setShow] = useState<boolean>(true);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const topCapsule = findTopCapsuleParent(ref?.current);
    if (!topCapsule) {
      logger.error("TopCapsule container not found!");
      return;
    }

    const mutationObserver = new MutationObserver((entries) => {
      for (const entry of entries) {
        if (entry.type !== "attributes" || entry.attributeName !== "class") {
          continue;
        }

        const className = (entry.target as Element).className;
        const fullscreenMode =
          className.includes(appDetailsHeaderClasses.FullscreenEnterStart) ||
          className.includes(appDetailsHeaderClasses.FullscreenEnterActive) ||
          className.includes(appDetailsHeaderClasses.FullscreenEnterDone) ||
          className.includes(appDetailsHeaderClasses.FullscreenExitStart) ||
          className.includes(appDetailsHeaderClasses.FullscreenExitActive);
        const fullscreenAborted = className.includes(
          appDetailsHeaderClasses.FullscreenExitDone
        );

        setShow(!fullscreenMode || fullscreenAborted);
      }
    });
    mutationObserver.observe(topCapsule, {
      attributes: true,
      attributeFilter: ["class"]
    });
    return () => {
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div
      id="pyrodeck"
      ref={ref}
      style={{
        position:
          `var(${achorPositionName}, relative)` as CSSProperties["position"]
      }}
    >
      {show && <MoonDeckLaunchButton {...props} />}
    </div>
  );
};
