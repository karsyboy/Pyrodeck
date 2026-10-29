import { DialogBody, DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext } from "react";
import { MoonDeckContext } from "../../contexts";
import { PyrolightInstallSection } from "./pyrolightinstallsection";
import { ToggleField } from "../shared";
import { UpdateState } from "../../lib/pyrodeckupdate";
import { UserSettings } from "../../lib";
import { pyroDeckUpdate } from "../../lib/pyrodeckupdate";
import { useCurrentSettings } from "../../hooks";
import { usePyroDeckUpdate } from "../../hooks/usepyrodeckupdate";

export function pyroDeckReleaseText(state: UpdateState): string {
  if (state.checking) return "Checking…";
  if (!state.release) return state.error ? "Unavailable" : "Not checked";
  return `${state.release.tag}${state.release.prerelease ? " (prerelease)" : ""}`;
}

export function pyroDeckUpdateDescription(state: UpdateState): string {
  if (state.error) return state.error;
  if (state.requested) return "Confirm the installation in Decky's prompt. PyroDeck reloads with the new version.";
  if (state.updateAvailable && state.release) return `Decky asks for confirmation, then installs ${state.release.tag} after checking its SHA-256.`;
  return state.release ? "PyroDeck is up to date." : "";
}

export const PyroDeckUpdateSection: FC<{ settings: UserSettings }> = ({ settings }) => {
  const { settingsManager } = useContext(MoonDeckContext);
  const { state, prerelease } = usePyroDeckUpdate(settings);
  return (
    <DialogControlsSection>
      <DialogControlsSectionHeader>PyroDeck</DialogControlsSectionHeader>
      <Field label="Installed" focusable={true}>{state.current ? `v${state.current}` : "Unknown"}</Field>
      <ToggleField
        label="Include prereleases"
        description="Update PyroDeck to prereleases as well. Prereleases are test builds."
        value={prerelease}
        setValue={(value) => settingsManager.update((userSettings) => { userSettings.pyrodeckPrereleases = value; })}
      />
      <Field label="Latest release" focusable={true}>{pyroDeckReleaseText(state)}</Field>
      <Field label="Update PyroDeck" description={pyroDeckUpdateDescription(state) || undefined} childrenContainerWidth="fixed" bottomSeparator="none">
        <DialogButton disabled={!state.updateAvailable || state.checking} onClick={() => { void pyroDeckUpdate.install(); }}>
          {state.updateAvailable ? "Update" : "Up to date"}
        </DialogButton>
      </Field>
      <Field childrenContainerWidth="fixed" bottomSeparator="none">
        <DialogButton disabled={state.checking} onClick={() => { void pyroDeckUpdate.check(prerelease, true); }}>Check now</DialogButton>
      </Field>
    </DialogControlsSection>
  );
};

export const UpdatesView: FC = () => {
  const settings = useCurrentSettings();
  if (settings === null) return null;
  return (
    <DialogBody>
      <PyroDeckUpdateSection settings={settings} />
      <PyrolightInstallSection settings={settings} />
    </DialogBody>
  );
};
