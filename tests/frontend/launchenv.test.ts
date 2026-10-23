import { describe, expect, it, vi } from "vitest";

vi.mock("@decky/api", () => ({ call: vi.fn(), toaster: { toast: vi.fn() } }));

const { AppType, EnvVars, getLaunchOptionsString, getLibraryAppData, isAppTypeSupported, isMoonDeckShortcut } = await import("../../src/lib/launchenv");
const { getEnvKeyValueString, makeEnvKeyValue } = await import("../../src/lib/envutils");

const context = { displayMode: "1280x800", autoResolution: true, currentAudioDevice: null, currentDisplay: "internal", pythonExecPath: "" };

describe("launch options", () => {
  it("keeps saved remote shortcuts pinned without making them reusable helpers", () => {
    const options = getLaunchOptionsString("", 123, AppType.Remote, {
      ...context, hostId: "host-a", remoteAppId: 42, remoteAppName: "Steam", libraryShortcut: true
    });
    expect(options).toContain("PYRODECK_HOST_ID=host-a");
    expect(options).toContain("PYRODECK_REMOTE_APP_ID=42");
    expect(options).toContain("PYRODECK_LIBRARY_SHORTCUT=1");
    expect(options).not.toContain("PYRODECK_LAUNCHER");
  });
  it("carries the selected library entry's Steam app id", () => {
    const options = getLaunchOptionsString("", 892970, AppType.MoonDeck, context);
    expect(options).toBe("PYRODECK_APP_TYPE=0 PYRODECK_STEAM_APP_ID=892970 PYRODECK_AUTO_RES=1280x800 PYRODECK_LINKED_DISPLAY=internal %command%");
    expect(options).not.toContain("MOONDECK_");
  });

  it("refuses ids that are not Steam app ids", () => {
    expect(getLaunchOptionsString("", 0, AppType.MoonDeck, context)).toBeNull();
    expect(getLaunchOptionsString("", -3, AppType.MoonDeck, context)).toBeNull();
    expect(getLaunchOptionsString("", 1.5, AppType.MoonDeck, context)).toBeNull();
  });

  it("keeps a synced host app's name, quoted", () => {
    const current = `${EnvVars.AppType}=1 ${EnvVars.AppName}='Tom'\\''s Game' %command%`;
    const options = getLaunchOptionsString(current, 123, AppType.GameStream, { ...context, autoResolution: false, currentDisplay: null });
    expect(options).toBe("PYRODECK_APP_TYPE=1 PYRODECK_APP_NAME='Tom'\\''s Game' %command%");
    expect(getEnvKeyValueString(options!, EnvVars.AppName)).toBe("Tom's Game");
  });

  it("utility launches name their action and nothing else", () => {
    const options = getLaunchOptionsString("", 55, AppType.Utility, { ...context, action: "quit" });
    expect(options).toContain("PYRODECK_APP_TYPE=2 PYRODECK_ACTION=quit");
    expect(options).not.toContain(EnvVars.SteamAppId);
    expect(getLaunchOptionsString("", 55, AppType.Utility, context)).toBeNull();
  });
});

describe("safe names", () => {
  it("quotes shell metacharacters even without whitespace", () => {
    for (const name of ["A;B", "Game$(command)", "Game`command`", "A&B", "A\\B"]) {
      const encoded = makeEnvKeyValue("NAME", name);
      expect(encoded.startsWith("NAME='")).toBe(true);
      expect(getEnvKeyValueString(encoded, "NAME")).toBe(name);
    }
  });
  it("remote browser launches carry only stable identity, never an app name in shell options", () => {
    const value = getLaunchOptionsString("", 123, AppType.Remote, { ...context, hostId: "host-a", remoteAppId: 45, remoteAppName: "--a;$(bad)" });
    expect(value).toContain("PYRODECK_REMOTE_APP_ID=45");
    expect(value).not.toContain("bad");
    expect(value).not.toContain("PYRODECK_APP_NAME");
  });
});

describe("shortcut ownership", () => {
  it("adopts only PyroDeck's runner shortcuts, never MoonDeck's", () => {
    expect(isMoonDeckShortcut({ strShortcutExe: "\"/home/deck/homebrew/plugins/PyroDeck/python/pyrodeckrun.sh\"" })).toBe(true);
    expect(isMoonDeckShortcut({ strShortcutExe: "\"/home/deck/homebrew/plugins/MoonDeck/python/moondeckrun.sh\"" })).toBe(false);
    expect(isMoonDeckShortcut({ strShortcutExe: "/usr/bin/moonlight" })).toBe(false);
  });
});

describe("library page", () => {
  it("reads the Steam app id from the selected entry", () => {
    expect(getLibraryAppData({ appid: 892970, display_name: "Valheim", app_type: 1 })).toEqual({ appId: 892970, appName: "Valheim", appType: 1 });
  });

  it("ignores entries without a usable app id", () => {
    for (const overview of [null, undefined, {}, { appid: "892970", display_name: "Valheim", app_type: 1 }, { appid: 0, display_name: "X", app_type: 1 }, { appid: 5, app_type: 1 }]) {
      expect(getLibraryAppData(overview)).toBeNull();
    }
  });

  it("shows the button for games, demos and betas only", () => {
    expect([1, 8, 65536].map(isAppTypeSupported)).toEqual([true, true, true]);
    expect([2, 4, 32, 128, 1073741824].map(isAppTypeSupported)).toEqual([false, false, false, false, false]);
  });
});
