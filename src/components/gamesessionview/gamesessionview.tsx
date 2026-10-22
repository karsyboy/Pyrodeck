import { DialogBody, DialogControlsSection, Field } from "@decky/ui";
import { FC, useContext } from "react";
import { ListDropdown, SettingsLoadingField, ToggleField } from "../shared";
import { MoonDeckContext } from "../../contexts";
import { getControllerConfigDropdownValues } from "../../lib";
import { useCurrentSettings } from "../../hooks";

export const GameSessionView: FC = () => {
  const { settingsManager } = useContext(MoonDeckContext);
  const settings = useCurrentSettings();
  if (settings === null) {
    return <SettingsLoadingField />;
  }

  return (
    <DialogBody>
      <Field
        description="Settings applied to every stream. Closing a stream never ends the game on the host: use End Game on Host in the quick access menu for that."
        focusable={true}
      />
      <DialogControlsSection>
        <Field
          label="Selected Steam Input option"
          childrenContainerWidth="fixed"
          bottomSeparator="none"
        >
          <ListDropdown
            optionList={getControllerConfigDropdownValues()}
            label="Do nothing"
            withOptionalValue={true}
            value={settings.gameSession.controllerConfig}
            setValue={(value) =>
              settingsManager.update((settings) => {
                settings.gameSession.controllerConfig = value;
              })}
          />
        </Field>
        <Field
          description={
            <>
              <div>
                Choose how to configure Steam Input before the game is launched
                for the external controllers.
              </div>
              <br />
              <div>
                Disabling Steam Input is preferable in most cases as Pyrolight
                can then see the actual controller instead of a generic XBox one
                that Steam exposes.
              </div>
              <br />
              <div>
                This means that the motion data becomes available for
                PS4/Dualsense controllers and the rumble works better in most
                cases.
              </div>
            </>
          }
          focusable={true}
        />
        <Field
          label="Steam game association"
          description="Matching streams display the Steam game’s name, artwork and details while keeping the streaming helper’s process and window identity. Steam's Exit action disconnects the stream; End Remote Game closes the game on the host."
        />
        <ToggleField
          label="Resume stream after system suspension"
          description="Suspending the Steam Deck disconnects the stream and the game keeps running on the host. With this on, PyroDeck reconnects to it when the Deck wakes up; otherwise the stream stays closed."
          value={settings.gameSession.resumeAfterSuspend}
          setValue={(value) =>
            settingsManager.update((settings) => {
              settings.gameSession.resumeAfterSuspend = value;
            })}
        />
      </DialogControlsSection>
    </DialogBody>
  );
};
