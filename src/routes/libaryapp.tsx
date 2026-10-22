/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Navigation, afterPatch, appDetailsClasses, createReactTreePatcher, findInReactTree } from "@decky/ui";
import { RoutePatch, routerHook } from "@decky/api";
import { getLibraryAppData, logger } from "../lib";
import { MoonDeckLaunchButtonAnchor } from "../components/moondecklaunchbutton";
import { ReactElement } from "react";
import { getDefaultContext } from "../contexts";
import { streamActionIndex } from "../lib/libraryintegration";

function patchLibraryApp(route: string): RoutePatch {
  const { moonDeckAppLauncher, settingsManager } = getDefaultContext();
  return routerHook.addPatch(
    route,
    (tree: any) => {
      const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
      if (routeProps) {
        let appType: number | undefined;
        let appId: number | undefined;
        let appName: string | undefined;

        const patchHandler = createReactTreePatcher([
          (tree: any) => {
            const children = findInReactTree(tree, (x: any) => x?.props?.children?.props?.overview)?.props?.children;
            if (typeof children !== "object") {
              logger.debug(`Failed to patch ${route}, @children!`);
              return null;
            }

            // The PyroDeck button streams the entry this page shows, by its Steam app ID.
            const data = getLibraryAppData(children.props?.overview);
            if (data === null) {
              logger.error(`Failed to patch ${route}, @overview!`);
              return null;
            }

            ({ appType, appId, appName } = data);
            return children;
          }
        ], (_: Array<Record<string, unknown>>, ret?: ReactElement) => {
          if (!settingsManager.settings.value?.enableMoondeckShortcuts) {
            return ret;
          }

          if (moonDeckAppLauncher.moonDeckApp.value?.moonDeckAppId === appId) {
            // We are suppressing the navigation to custom shortcut ONLY if this happens after
            // launch via the moondeck button and we MUST navigate back ONLY once
            if (moonDeckAppLauncher.moonDeckApp.canRedirect()) {
              Navigation.NavigateBack();
            }

            return ret;
          }

          type ParentElement = ReactElement<{ children: Array<ReactElement<{ id?: string; overview?: unknown; onShowLaunchingDetails?: unknown }>>; className: string }>;
          const parent = findInReactTree(ret, (x: ParentElement) => Array.isArray(x?.props?.children) && x?.props?.className?.includes(appDetailsClasses.InnerContainer)) as ParentElement;
          if (typeof parent !== "object") {
            logger.error(`Failed to patch ${route} - parent element not found!`);
            return ret;
          }

          if (typeof appType !== "number" || typeof appId !== "number" || typeof appName !== "string") {
            logger.error(`Failed to patch ${route} - undefined data!`);
            return ret;
          }

          const insertion = streamActionIndex(parent.props.children);
          if (insertion === null) return ret;
          parent.props.children.splice(
            insertion,
            0,
            <MoonDeckLaunchButtonAnchor
              key="pyrodeck"
              appId={appId}
              appName={appName}
              appType={appType}
            />
          );

          return ret;
        });

        afterPatch(routeProps, "renderFunc", patchHandler);
      }

      return tree;
    }
  );
}

export function LibraryAppHook(): () => void {
  const route = "/library/app/:appid";
  const libraryPatch = patchLibraryApp(route);
  return () => {
    routerHook.removePatch(route, libraryPatch);
  };
}
