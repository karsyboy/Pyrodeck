import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { pyroDeckReleaseText, pyroDeckUpdateDescription } from "../updatesview/updatesview";
import { ActionButton } from "../shared/actionbutton";
import { FC } from "react";
import { UserSettings } from "../../lib";
import { pyroDeckUpdate } from "../../lib/pyrodeckupdate";
import { usePyroDeckUpdate } from "../../hooks/usepyrodeckupdate";

/** Shown only while a newer PyroDeck is available on the configured channel. */
export const PyroDeckUpdatePanel: FC<{ settings: UserSettings | null; visible: boolean }> = ({ settings, visible }) => {
  const { state } = usePyroDeckUpdate(settings, visible);
  if (!state.updateAvailable || !state.release) return null;
  return (
    <PanelSection title="PyroDeck update">
      <PanelSectionRow>
        <Field label={`PyroDeck ${pyroDeckReleaseText(state)} is available`} description={pyroDeckUpdateDescription(state)} />
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton disabled={state.checking} onClick={() => { void pyroDeckUpdate.install(); }}>Update PyroDeck</ActionButton>
      </PanelSectionRow>
    </PanelSection>
  );
};
