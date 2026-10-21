import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { AppType } from "../../lib";
import { CurrentHostSettings } from "../../hooks";
import { ExternalAppsSyncButton } from "../shared";
import { FC } from "react";

interface Props {
  currentHostSettings: CurrentHostSettings | null;
}

export const ExternalAppsPanel: FC<Props> = ({ currentHostSettings }) => {
  if (currentHostSettings === null || !currentHostSettings.gameStreamApps.showQuickAccessButton) {
    return null;
  }

  return (
    <PanelSection title="EXTERNAL APPS">
      <PanelSectionRow>
        <Field
          childrenContainerWidth="fixed"
          spacingBetweenLabelAndChild="none"
          childrenLayout="below"
        >
          <ExternalAppsSyncButton text="Sync Host Apps" appType={AppType.GameStream} noConfirmationDialog={true} />
        </Field>
      </PanelSectionRow>
    </PanelSection>
  );
};
