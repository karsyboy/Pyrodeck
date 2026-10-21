import { DialogBody, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext } from "react";
import { LabelWithIcon, NumericTextInput, ToggleField } from "../shared";
import { servicePingDefault, steamLaunchDefault, wakeOnLanDefault } from "../../lib";
import { useCurrentHostSettings, useCurrentSettings } from "../../hooks";
import { HostOff } from "../icons";
import { MoonDeckContext } from "../../contexts";
import { PythonExecutableSection } from "./pythonexecutablesection";

export const RunnerSettingsView: FC = () => {
  const { settingsManager } = useContext(MoonDeckContext);
  const userSettings = useCurrentSettings();
  const hostSettings = useCurrentHostSettings();
  if (userSettings === null || hostSettings === null) {
    return (
      <DialogBody>
        <DialogControlsSection>
          <Field
            label={<LabelWithIcon icon={HostOff} label="HOST IS NOT SELECTED" />}
            description="Go to host selection page to select host"
            bottomSeparator="none"
          />
        </DialogControlsSection>
      </DialogBody>
    );
  }

  return (
    <DialogBody>
      <DialogControlsSection>
        <DialogControlsSectionHeader>General</DialogControlsSectionHeader>
        <ToggleField
          label="Debug logs"
          value={userSettings.runnerDebugLogs}
          setValue={(value) => settingsManager.update((userSettings) => { userSettings.runnerDebugLogs = value; })}
        />
        <PythonExecutableSection />
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Timeouts</DialogControlsSectionHeader>
        <Field
          description="Warning! Changing anything here to anything than the default values could easily break the runner!"
          focusable={true}
        />
        <Field
          label={`servicePing (default: ${servicePingDefault})`}
          description="Timeout for each host status request (serverinfo)."
          childrenContainerWidth="fixed"
        >
          <NumericTextInput
            min={1}
            value={hostSettings.runnerTimeouts.servicePing}
            setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.runnerTimeouts.servicePing = value; })}
          />
        </Field>
        <Field
          label={`wakeOnLan (default: ${wakeOnLanDefault})`}
          description="Timeout for how long to wait until host is available. Setting this to 0 disables the automatic WOL."
          childrenContainerWidth="fixed"
        >
          <NumericTextInput
            min={0}
            value={hostSettings.runnerTimeouts.wakeOnLan}
            setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.runnerTimeouts.wakeOnLan = value; })}
          />
        </Field>
        <Field
          label={`steamLaunch (default: ${steamLaunchDefault})`}
          description="Timeout for how long to wait until Steam launches the PyroDeck shortcut."
          childrenContainerWidth="fixed"
        >
          <NumericTextInput
            min={1}
            value={hostSettings.runnerTimeouts.steamLaunch}
            setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.runnerTimeouts.steamLaunch = value; })}
          />
        </Field>
      </DialogControlsSection>
    </DialogBody>
  );
};
