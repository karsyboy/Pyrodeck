import { DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext } from "react";
import { HostSettings, videoCodecOptions } from "../../../lib";
import { ListDropdown, OptionalBooleanDropdown, ToggleField } from "../../shared";
import { MoonDeckContext } from "../../../contexts";
import { MoonlightExecutableSelection } from "./moonlightexecutableselection";

interface Props {
  hostSettings: HostSettings;
}

export const GeneralSection: FC<Props> = ({ hostSettings }) => {
  const { settingsManager } = useContext(MoonDeckContext);

  return (
    <DialogControlsSection>
      <DialogControlsSectionHeader>General</DialogControlsSectionHeader>
      <MoonlightExecutableSelection />
      <ToggleField
        label="Pass audio, resolution and other options to Pyrolight instead of using Pyrolight's own settings"
        description="Disable this to use the settings made in the Pyrolight app itself"
        value={hostSettings.passToMoonlight}
        setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.passToMoonlight = value; })}
      />
      <Field
        label="Video codec"
        description="Codec to use when streaming. Pyrolight's own setting (automatic by default) is used unless overridden. PyroWave needs a Pyrolight build and host that offer it; an option the installed Pyrolight lacks is skipped."
        childrenContainerWidth="fixed"
      >
        <ListDropdown
          optionList={videoCodecOptions}
          label="Don't override"
          withOptionalValue={true}
          value={hostSettings.videoCodec}
          setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.videoCodec = value; })}
        />
      </Field>
      <Field
        label="Toggle V-sync"
        description="V-sync option to use when streaming. Pyrolight's own setting is used unless overridden."
        childrenContainerWidth="fixed"
      >
        <OptionalBooleanDropdown
          value={hostSettings.enableVSync}
          optValueLabel="Don't override"
          setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.enableVSync = value; })}
        />
      </Field>
      <Field
        label="Toggle VRR presentation"
        description="Variable refresh rate presentation (needs V-sync and a VRR display). Pyrolight's own setting is used unless overridden; skipped when the installed Pyrolight has no VRR option."
        childrenContainerWidth="fixed"
      >
        <OptionalBooleanDropdown
          value={hostSettings.enableVrr}
          optValueLabel="Don't override"
          setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.enableVrr = value; })}
        />
      </Field>
      <Field
        label="Toggle frame pacing"
        description="Frame pacing option to use when streaming. Pyrolight's own setting is used unless overridden."
        childrenContainerWidth="fixed"
      >
        <OptionalBooleanDropdown
          value={hostSettings.enableFramePacing}
          optValueLabel="Don't override"
          setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.enableFramePacing = value; })}
        />
      </Field>
      <Field
        label="Toggle performance stats"
        description="Show or hide performance stats when streaming. Pyrolight's own setting is used unless overridden."
        childrenContainerWidth="fixed"
      >
        <OptionalBooleanDropdown
          value={hostSettings.showPerformanceStats}
          optValueLabel="Don't override"
          setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.showPerformanceStats = value; })}
        />
      </Field>
    </DialogControlsSection>
  );
};
