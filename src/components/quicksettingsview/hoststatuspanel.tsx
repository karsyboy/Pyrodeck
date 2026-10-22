import { ButtonItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FC, useContext } from "react";
import { GameStreamHost, ServerStatus, UserSettings } from "../../lib";
import { LabelWithIcon, ServerStatusField } from "../shared";
import { CurrentHostSettings } from "../../hooks";
import { HostOff } from "../icons";
import { HostSelectionDropdown } from "../hostselectionview/hostselectiondropdown";
import { MoonDeckContext } from "../../contexts";
import { usePyrolight } from "../../hooks/usepyrolight";

interface Props {
  currentHostSettings: CurrentHostSettings | null;
  currentSettings: UserSettings | null;
  serverStatus: ServerStatus;
  serverRefreshStatus: boolean;
  hostInfo: GameStreamHost | null;
}

export const HostStatusPanel: FC<Props> = ({ currentHostSettings, currentSettings, serverStatus, serverRefreshStatus, hostInfo }) => {
  const session = usePyrolight().session;
  const { settingsManager, connectivityManager } = useContext(MoonDeckContext);

  if (currentHostSettings === null || currentSettings === null) {
    return (
      <PanelSection title="STATUS">
        <PanelSectionRow>
          <Field
            label={<LabelWithIcon icon={HostOff} label="HOST IS NOT SELECTED" />}
            description="Go to settings to select host"
          />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <PanelSection title="STATUS">
      <PanelSectionRow>
        <Field
          childrenContainerWidth="fixed"
          spacingBetweenLabelAndChild="none"
          childrenLayout="below"
        >
          <HostSelectionDropdown
            disableNoneOption={true}
            disabled={["connecting", "launching", "streaming", "reconnecting", "ending"].includes(session.state)}
            singleItemSelection={true}
            currentSettings={currentSettings}
            setHost={(value) => { settingsManager.update((settings) => { settings.currentHostId = value; }); }}
          />
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ServerStatusField label="Pyroshine" status={serverStatus} isRefreshing={serverRefreshStatus} noSeparator={hostInfo === null || hostInfo.appSources > 0} />
      </PanelSectionRow>
      {serverStatus === "Offline" && <PanelSectionRow><ButtonItem disabled={serverRefreshStatus} onClick={() => { void connectivityManager.commandProxy.wakeOnLan(); }}>Wake Default Host</ButtonItem></PanelSectionRow>}
      {hostInfo !== null && hostInfo.appSources === 0 &&
        <PanelSectionRow>
          <Field
            bottomSeparator="standard"
            description="This host does not report Steam app IDs, so library games cannot be matched. Update Pyroshine on the host."
          />
        </PanelSectionRow>}
    </PanelSection>
  );
};
