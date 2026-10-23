import { ExternalAppInfo, GameStreamAppInfo, RemoteAppInfo } from "../lib/externalappshortcuts";
import { useContext, useEffect, useState } from "react";
import { AppType } from "../lib";
import { MoonDeckContext } from "../contexts";

function filterApps(apps: Map<number, ExternalAppInfo>): GameStreamAppInfo[] {
  return Array.from(apps.values())
    .filter((app) => app.appType === AppType.GameStream)
    .sort((a, b) => a.appName < b.appName ? -1 : a.appName > b.appName ? 1 : 0);
}

export function useGameStreamAppShortcuts(): GameStreamAppInfo[] {
  return filterApps(useExternalAppShortcuts());
}

export function useRemoteAppShortcuts(): RemoteAppInfo[] {
  return Array.from(useExternalAppShortcuts().values()).filter((app) => app.appType === AppType.Remote);
}

function useExternalAppShortcuts(): Map<number, ExternalAppInfo> {
  const { externalAppShortcuts } = useContext(MoonDeckContext);
  const [shortcuts, setShortcuts] = useState(externalAppShortcuts.appInfo.value);

  useEffect(() => {
    const sub = externalAppShortcuts.appInfo.asObservable().subscribe(setShortcuts);
    return () => {
      sub.unsubscribe();
    };
  }, [externalAppShortcuts]);

  return shortcuts;
}
