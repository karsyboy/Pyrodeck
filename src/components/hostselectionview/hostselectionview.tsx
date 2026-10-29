import { DialogBody, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC, useContext, useState } from "react";
import { ServerStatusField, SettingsLoadingField } from "../shared";
import { useCurrentHostSettings, useCurrentSettings, useServerStatus } from "../../hooks";
import { AddHostButton } from "./addhostbutton";
import { HostForgetButton } from "./hostforgetbutton";
import { HostScanButton } from "./hostscanbutton";
import { HostSelectionDropdown } from "./hostselectiondropdown";
import { MoonDeckContext } from "../../contexts";
import { PyrolightExecutableSelection } from "./pyrolightexecutableselection";
import { PyrolightInstallSection } from "./pyrolightinstallsection";
import { PyrolightSection } from "./pyrolightsection";

export const HostSelectionView: FC = () => {
  const { settingsManager } = useContext(MoonDeckContext);
  const [isScanning, setIsScanning] = useState(false);
  const [serverStatus, serverRefreshStatus] = useServerStatus();
  const settings = useCurrentSettings();
  const hostSettings = useCurrentHostSettings();

  if (settings === null) {
    return <SettingsLoadingField />;
  }

  return (
    <DialogBody>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Pyroshine Host</DialogControlsSectionHeader>
        <ServerStatusField label="Status" status={serverStatus} isRefreshing={serverRefreshStatus} />
        <Field
          label="Default host"
          childrenContainerWidth="fixed"
          description="The preferred host for library launches. Selecting another host on a game page applies only to that launch."
        >
          <HostSelectionDropdown
            disabled={isScanning}
            currentSettings={settings}
            setHost={(value) => { settingsManager.update((settings) => { settings.currentHostId = value; }); }}
          />
        </Field>
        <Field
          label="Scan local network"
          description="Pyroshine announces itself on the local network (mDNS). A firewall or VPN can prevent discovery; add the host manually then."
          childrenContainerWidth="fixed"
        >
          <HostScanButton
            disabled={isScanning}
            isScanning={isScanning}
            setIsScanning={setIsScanning}
          />
        </Field>
        <Field
          label="Add host manually"
          description="Add host by specifying a static address if it cannot be found via scanning."
          childrenContainerWidth="fixed"
        >
          <AddHostButton
            disabled={isScanning}
          />
        </Field>
        <Field
          label="Forget current host"
          childrenContainerWidth="fixed"
        >
          <HostForgetButton
            disabled={isScanning || settings.currentHostId === null}
            currentHost={settings.currentHostId}
            onForget={(value) => {
              settingsManager.update((settings) => {
                delete settings.hostSettings[value];
                settings.currentHostId = null;
              });
            }}
          />
        </Field>
      </DialogControlsSection>
      <DialogControlsSection><PyrolightExecutableSelection /></DialogControlsSection>
      <PyrolightInstallSection settings={settings} />
      {hostSettings &&
        <PyrolightSection
          hostSettings={hostSettings}
          pyrolightExecPath={settings.useMoonlightExec ? settings.moonlightExecPath : null}
          serverStatus={serverStatus}
          disabled={isScanning}
        />}
    </DialogBody>
  );
};
