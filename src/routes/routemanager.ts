import { LibraryAppHook } from "./libaryapp";
import { MoonDeckRouterHook } from "./moondeck";
import { SteamPresentationHook } from "./steampresentation";

export class RouteManager {
  private moonDeckRouteUnhook: (() => void) | null = null;
  private libraryAppUnhook: (() => void) | null = null;
  private presentationUnhook: (() => void) | null = null;

  init(): void {
    this.deinit();
    this.moonDeckRouteUnhook = MoonDeckRouterHook();
    this.libraryAppUnhook = LibraryAppHook();
    this.presentationUnhook = SteamPresentationHook();
  }

  deinit(): void {
    this.presentationUnhook?.();
    this.presentationUnhook = null;
    if (this.moonDeckRouteUnhook !== null) {
      this.moonDeckRouteUnhook();
      this.moonDeckRouteUnhook = null;
    }
    if (this.libraryAppUnhook !== null) {
      this.libraryAppUnhook();
      this.libraryAppUnhook = null;
    }
  }
}
