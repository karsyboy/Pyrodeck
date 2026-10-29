import { DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext, useEffect } from "react";
import { InstallMode, InstallState, installMode, isInstalling, progressText, pyrolightInstall } from "../../lib/pyrolightinstall";
import { MoonDeckContext } from "../../contexts";
import { ToggleField } from "../shared";
import { UserSettings } from "../../lib";
import { usePyrolightInstall } from "../../hooks/usepyrolightinstall";

const modeDescriptions: Record<InstallMode, string> = {
  missing: "Pyrolight was not found. Install the latest AppImage into ~/Applications.",
  managed: "Installed and updated by PyroDeck.",
  package: "Installed by the system's package manager. Update it there.",
  selected: "PyroDeck uses the executable set in Advanced Tools → Executables. Turn that off to use an AppImage PyroDeck installs.",
  appimage: "An AppImage you added. Installing the latest release adds ~/Applications/Pyrolight.AppImage, which PyroDeck then uses."
};

/** The single install/update action for the current state, or null when PyroDeck must not change Pyrolight. */
export function installAction(state: InstallState, mode: InstallMode): { label: string; enabled: boolean } | null {
  if (mode === "package" || mode === "selected") return null;
  if (isInstalling(state.status)) return { label: "Installing…", enabled: false };
  if (mode === "missing") return { label: "Install", enabled: true };
  if (mode === "managed") return state.updateAvailable ? { label: "Update", enabled: true } : { label: "Up to date", enabled: false };
  return { label: "Install latest", enabled: Boolean(state.release) };
}

function releaseText(state: InstallState): string {
  if (state.checking) return "Checking…";
  if (!state.release) return state.error ? "Unavailable" : "Not checked";
  return `${state.release.tag}${state.release.prerelease ? " (prerelease)" : ""}`;
}

export function usePyrolightInstallControls(settings: UserSettings | null) {
  const state = usePyrolightInstall(settings ? (settings.useMoonlightExec ? settings.moonlightExecPath : null) : null);
  const prerelease = settings?.pyrolightPrereleases ?? false;
  useEffect(() => { if (settings) void pyrolightInstall.check(prerelease); }, [prerelease, Boolean(settings)]);
  const mode = state.status ? installMode(state.status, Boolean(settings?.useMoonlightExec)) : null;
  return { state, mode, prerelease, action: mode ? installAction(state, mode) : null, install: () => pyrolightInstall.install(prerelease) };
}

export const PyrolightInstallSection: FC<{ settings: UserSettings }> = ({ settings }) => {
  const { settingsManager } = useContext(MoonDeckContext);
  const { state, mode, prerelease, action, install } = usePyrolightInstallControls(settings);
  const progress = state.status?.progress;
  const feedback = state.error ?? (progress && progress.state !== "idle" ? progressText(progress) : null);
  return (
    <DialogControlsSection>
      <DialogControlsSectionHeader>Pyrolight</DialogControlsSectionHeader>
      <Field label="Installed" focusable={true} description={mode ? modeDescriptions[mode] : undefined}>
        {!state.status ? "Looking..." : state.status.installed && mode === "managed" ? state.status.installed.tag : (state.status.executable ?? "Not found")}
      </Field>
      <ToggleField
        label="Include prereleases"
        description="Install and update to Pyrolight prereleases as well. Prereleases are test builds."
        value={prerelease}
        disabled={isInstalling(state.status)}
        setValue={(value) => settingsManager.update((userSettings) => { userSettings.pyrolightPrereleases = value; })}
      />
      <Field label="Latest release" focusable={true} bottomSeparator={action || feedback ? "standard" : "none"}>
        {releaseText(state)}
      </Field>
      {action ?
          (
            <Field label="Install Pyrolight" description={feedback ?? undefined} childrenContainerWidth="fixed" bottomSeparator="none">
              <DialogButton disabled={!action.enabled} onClick={() => { void install(); }}>{action.label}</DialogButton>
            </Field>
          ) :
        feedback && <Field description={feedback} bottomSeparator="none" />}
    </DialogControlsSection>
  );
};
