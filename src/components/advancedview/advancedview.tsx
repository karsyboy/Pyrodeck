import { CurrentHostSettings, useCurrentHostSettings, useCurrentSettings } from "../../hooks";
import { DialogBody, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext } from "react";
import { ListDropdown, NoHostSelectedField, NumericTextInput, SettingsLoadingField, ToggleField } from "../shared";
import { getControllerConfigDropdownValues, servicePingDefault, steamLaunchDefault, wakeOnLanDefault } from "../../lib";
import { AppResolutionOverrideSection } from "../moonlightsettingsview/appresolutionoverride/appresolutionoverridesection";
import { HostAppShortcutsSection } from "./hostappshortcuts";
import { MoonDeckContext } from "../../contexts";
import { PyrolightExecutableSection } from "./pyrolightexecutablesection";
import { PythonExecutableSection } from "./pythonexecutablesection";

const TimeoutsSection: FC<{ hostSettings: CurrentHostSettings }> = ({ hostSettings }) => {
  const { settingsManager } = useContext(MoonDeckContext);
  const timeouts = hostSettings.runnerTimeouts;
  return (
    <DialogControlsSection>
      <DialogControlsSectionHeader>Launch Timeouts</DialogControlsSectionHeader>
      <Field description="In seconds. Changing these from their defaults can break launching." focusable={true} />
      <Field label={`Host status (default: ${servicePingDefault})`} description="Each host status request." childrenContainerWidth="fixed">
        <NumericTextInput min={1} value={timeouts.servicePing} setValue={(value) => settingsManager.updateHost((settings) => { settings.runnerTimeouts.servicePing = value; })} />
      </Field>
      <Field label={`Wake-on-LAN (default: ${wakeOnLanDefault})`} description="How long to wait for the host to wake. 0 turns automatic Wake-on-LAN off." childrenContainerWidth="fixed">
        <NumericTextInput min={0} value={timeouts.wakeOnLan} setValue={(value) => settingsManager.updateHost((settings) => { settings.runnerTimeouts.wakeOnLan = value; })} />
      </Field>
      <Field label={`Steam launch (default: ${steamLaunchDefault})`} description="How long to wait for Steam to start the stream." childrenContainerWidth="fixed">
        <NumericTextInput min={1} value={timeouts.steamLaunch} setValue={(value) => settingsManager.updateHost((settings) => { settings.runnerTimeouts.steamLaunch = value; })} />
      </Field>
    </DialogControlsSection>
  );
};

/** PyroDeck settings most people never change, on one page. */
export const AdvancedView: FC = () => {
  const { settingsManager } = useContext(MoonDeckContext);
  const settings = useCurrentSettings();
  const hostSettings = useCurrentHostSettings();
  if (settings === null) {
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
        <DialogControlsSectionHeader>Session</DialogControlsSectionHeader>
        <Field
          label="Steam Input for external controllers"
          description="Disabling Steam Input lets Pyrolight see the real controller, with motion and better rumble for PlayStation controllers."
          childrenContainerWidth="fixed"
        >
          <ListDropdown
            optionList={getControllerConfigDropdownValues()}
            label="Do nothing"
            withOptionalValue={true}
            value={settings.gameSession.controllerConfig}
            setValue={(value) => settingsManager.update((settings) => { settings.gameSession.controllerConfig = value; })}
          />
        </Field>
        <ToggleField
          label="Resume stream after suspend"
          description="Reconnects to the game, which keeps running on the host, when the Steam Deck wakes up."
          value={settings.gameSession.resumeAfterSuspend}
          setValue={(value) => settingsManager.update((settings) => { settings.gameSession.resumeAfterSuspend = value; })}
        />
      </DialogControlsSection>
      {hostSettings === null ?
          (
            <DialogControlsSection>
              <DialogControlsSectionHeader>Host</DialogControlsSectionHeader>
              <NoHostSelectedField />
            </DialogControlsSection>
          ) :
          (
            <>
              <AppResolutionOverrideSection hostSettings={hostSettings} />
              <TimeoutsSection hostSettings={hostSettings} />
              <HostAppShortcutsSection hostSettings={hostSettings} />
            </>
          )}
      <DialogControlsSection>
        <DialogControlsSectionHeader>Logging</DialogControlsSectionHeader>
        <ToggleField
          label="Debug logs"
          description="Write detailed launcher logs, for troubleshooting."
          value={settings.runnerDebugLogs}
          setValue={(value) => settingsManager.update((settings) => { settings.runnerDebugLogs = value; })}
        />
      </DialogControlsSection>
    </DialogBody>
  );
};
