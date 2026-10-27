import { DialogBody, DialogControlsSection, Field } from "@decky/ui";
import { useCurrentHostSettings, useHostInfo } from "../../hooks";
import { FC } from "react";
import { HostOff } from "../icons";
import { LabelWithIcon } from "../shared";
import { hostGameStateLabels } from "../../lib";

export const HostInfoView: FC = () => {
  const hostSettings = useCurrentHostSettings();
  const hostInfo = useHostInfo();
  if (hostSettings === null) {
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
        <Field label="Host ID" focusable={true}>
          {hostSettings.currentHostId}
        </Field>
        <Field label="Hostname" focusable={true}>
          {hostSettings.hostName}
        </Field>
        <Field label="MAC address" focusable={true}>
          {hostSettings.mac}
        </Field>
        <Field label="Address" focusable={true}>
          {hostSettings.address}
        </Field>
        <Field label="Address type" focusable={true}>
          {hostSettings.staticAddress ? "Static" : "Dynamic"}
        </Field>
        <Field label="Host info port" focusable={true}>
          {hostSettings.hostInfoPort}
        </Field>
        <Field label="Steam app IDs" focusable={true} description="Whether the host reports which Steam game each app starts (Pyroshine with app sources).">
          {hostInfo === null ? "Unknown (host offline)" : (hostInfo.appSources > 0 ? `Reported (version ${hostInfo.appSources})` : "Not reported - update Pyroshine")}
        </Field>
        <Field label="Safe game switching" focusable={true} description="Whether the host ends only the game you confirmed when switching or ending a remote game.">
          {hostInfo === null ? "Unknown (host offline)" : (hostInfo.conditionalCancel > 0 ? "Supported" : "Not supported - update Pyroshine")}
        </Field>
        <Field label="Running app ID" focusable={true}>
          {hostInfo === null ? "Unknown (host offline)" : (hostInfo.currentGame === 0 ? "None" : hostInfo.currentGame)}
        </Field>
        {hostInfo !== null && hostInfo.gameState !== null &&
          <Field label="Steam game state" focusable={true}>
            {hostGameStateLabels[hostInfo.gameState]}
          </Field>}
      </DialogControlsSection>
    </DialogBody>
  );
};
