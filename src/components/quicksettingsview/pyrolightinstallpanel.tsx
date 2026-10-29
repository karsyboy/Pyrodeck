import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { isInstalling, progressText } from "../../lib/pyrolightinstall";
import { ActionButton } from "../shared/actionbutton";
import { FC } from "react";
import { UserSettings } from "../../lib";
import { usePyrolightInstallControls } from "../updatesview/pyrolightinstallsection";

/** Offers the install only while no Pyrolight is found; updates live in Updates. */
export const PyrolightInstallPanel: FC<{ settings: UserSettings | null }> = ({ settings }) => {
  const { state, mode, prerelease, action, install } = usePyrolightInstallControls(settings);
  const installing = isInstalling(state.status);
  if (!state.status || (mode !== "missing" && !installing && state.status.progress.state !== "failed")) return null;
  const progress = state.status.progress;
  return (
    <PanelSection title="Pyrolight">
      <PanelSectionRow>
        <Field
          label={installing ? "Installing Pyrolight" : mode === "missing" ? "Pyrolight is not installed" : "Pyrolight"}
          description={state.error ?? (progress.state !== "idle" ? progressText(progress) : `PyroDeck streams with Pyrolight. Install ${state.release ? state.release.tag : "the latest release"}${prerelease ? " (prereleases included)" : ""} into ~/Applications.`)}
        />
      </PanelSectionRow>
      {action && mode === "missing" &&
        <PanelSectionRow>
          <ActionButton disabled={!action.enabled} onClick={() => { void install(); }}>
            {action.label === "Install" ? "Install Pyrolight" : action.label}
          </ActionButton>
        </PanelSectionRow>}
    </PanelSection>
  );
};
