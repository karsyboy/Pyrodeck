import { DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext } from "react";
import { AppResolutionOverrideDropdown } from "./appresolutionoverridedropdown";
import { HostSettings } from "../../../lib";
import { MoonDeckContext } from "../../../contexts";
import { ToggleField } from "../../shared";

interface Props {
  hostSettings: HostSettings;
}

export const AppResolutionOverrideSection: FC<Props> = ({ hostSettings }) => {
  const { settingsManager } = useContext(MoonDeckContext);

  return (
    <DialogControlsSection>
      <DialogControlsSectionHeader>App Resolution Override</DialogControlsSectionHeader>
      <Field
        description="Controls Steam's resolution hint for the reusable launcher window. This does not select or modify a Pyrolight streaming profile. Native uses the attached display; Default uses Steam's default. Custom Resolution retains a migrated launch hint, falling back to the current display."
        focusable={true}
      />
      <Field
        label="Selected override"
        childrenContainerWidth="fixed"
      >
        <AppResolutionOverrideDropdown
          currentOverride={hostSettings.resolution.appResolutionOverride}
          setOverride={(value) => { settingsManager.updateHost((hostSettings) => { hostSettings.resolution.appResolutionOverride = value; }); }}
        />
      </Field>
      <ToggleField
        label="Also apply to internal display"
        description="By default the override is for external displays only, but this can be changed with this option."
        value={hostSettings.resolution.appResolutionOverrideForInternalDisplay}
        setValue={(value) => settingsManager.updateHost((hostSettings) => { hostSettings.resolution.appResolutionOverrideForInternalDisplay = value; })}
      />
    </DialogControlsSection>
  );
};
