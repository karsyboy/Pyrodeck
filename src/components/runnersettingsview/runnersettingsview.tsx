import { CurrentHostSettings, useCurrentHostSettings, useCurrentSettings } from "../../hooks";
import { DialogBody, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext } from "react";
import { NoHostSelectedField, NumericTextInput, SettingsLoadingField, ToggleField } from "../shared";
import { servicePingDefault, steamLaunchDefault, wakeOnLanDefault } from "../../lib";
import { AppResolutionOverrideSection } from "../moonlightsettingsview/appresolutionoverride/appresolutionoverridesection";
import { MoonDeckContext } from "../../contexts";
import { PyrolightExecutableSection } from "./pyrolightexecutablesection";
import { PythonExecutableSection } from "./pythonexecutablesection";

export const RunnerSettingsView: FC = () => {
  const { settingsManager } = useContext(MoonDeckContext);
  const userSettings = useCurrentSettings();
  const hostSettings = useCurrentHostSettings();
  if (userSettings === null) {
    return <SettingsLoadingField />;
  }

  return (
    <DialogBody>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Executables</DialogControlsSectionHeader>
        <PyrolightExecutableSection />
        <PythonExecutableSection />
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Logging</DialogControlsSectionHeader>
        <ToggleField
          label="Debug logs"
          description="Write detailed launcher logs, for troubleshooting."
          value={userSettings.runnerDebugLogs}
          setValue={(value) => settingsManager.update((userSettings) => { userSettings.runnerDebugLogs = value; })}
        />
      </DialogControlsSection>
      {hostSettings === null ?
          (
            <DialogControlsSection>
              <DialogControlsSectionHeader>Host</DialogControlsSectionHeader>
              <NoHostSelectedField />
            </DialogControlsSection>
          ) :
          <RunnerHostSettings hostSettings={hostSettings} />}
    </DialogBody>
  );
};

const RunnerHostSettings: FC<{ hostSettings: CurrentHostSettings }> = ({ hostSettings }) => {
  const { settingsManager } = useContext(MoonDeckContext);
  return (
    <>
      <AppResolutionOverrideSection hostSettings={hostSettings} />
      <DialogControlsSection>
        <DialogControlsSectionHeader>Timeouts</DialogControlsSectionHeader>
        <Field
          description="Changing these from their defaults can break launching."
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
    </>
  );
};
