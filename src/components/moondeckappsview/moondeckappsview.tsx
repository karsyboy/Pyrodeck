import { DialogBody, DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field, Navigation } from "@decky/ui";
import { FC, ReactNode, useContext } from "react";
import { useCurrentSettings, useMoonDeckAppShortcuts } from "../../hooks";
import { MoonDeckContext } from "../../contexts";
import { PurgeButton } from "./purgebutton";
import { ToggleField } from "../shared";

export const MoonDeckAppsView: FC = () => {
  const { settingsManager } = useContext(MoonDeckContext);
  const shortcuts = useMoonDeckAppShortcuts();
  const currentSettings = useCurrentSettings();

  let shortcutsList: ReactNode = null;
  if (shortcuts.length > 0) {
    shortcutsList =
      <DialogControlsSection>
        <DialogControlsSectionHeader>Generated Shortcuts</DialogControlsSectionHeader>
        <Field description="These shortcuts are exposed here for debugging purposes mostly. Any changes you make here could break something or could be just discarded." />
        {shortcuts.map((info) => {
          return (
            <Field
              key={info.appId}
              label={info.appName}
              childrenContainerWidth="min"
            >
              <DialogButton onClick={() => Navigation.Navigate(`/library/app/${info.appId}`)}>
                Open
              </DialogButton>
            </Field>
          );
        })}
      </DialogControlsSection>;
  }

  return (
    <DialogBody>
      {
        currentSettings !== null &&
        <DialogControlsSection>
          <ToggleField
            label="Show Stream with Pyrolight in the Library"
            description="Steam Play and Install remain available."
            value={currentSettings.enableMoondeckShortcuts}
            setValue={(value) => settingsManager.update((settings) => { settings.enableMoondeckShortcuts = value; })}
          />

        </DialogControlsSection>
      }
      <DialogControlsSection>
        <DialogControlsSectionHeader>Cleanup</DialogControlsSectionHeader>
        <Field
          label="Purge all the PyroDeck shortcuts!"
          description="Steam client will be restarted afterwards!"
          childrenContainerWidth="fixed"
        >
          <PurgeButton disabled={shortcuts.length === 0} />
        </Field>
      </DialogControlsSection>
      {shortcutsList}
    </DialogBody>
  );
};
