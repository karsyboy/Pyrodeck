import { DialogBody, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { PairingStatus, ServerStatus, pairingStatusDescriptions } from "../../lib";
import { FC } from "react";
import { stringifyStatus } from "../shared";

const serverStatuses: Array<[ServerStatus, string]> = [
  ["Offline", "The host is off, or Pyroshine is not reachable on it."],
  ["Online", "Pyroshine answers and is ready to stream."]
];

const pairingStatuses: PairingStatus[] = ["Paired", "NotPaired", "Unreachable", "WrongHost", "Outdated", "NotInstalled", "Error"];

export const StatusIndicatorsView: FC = () => {
  return (
    <DialogBody>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Pyroshine</DialogControlsSectionHeader>
        {serverStatuses.map(([status, description]) =>
          <Field key={status} label={stringifyStatus(status)} description={description} focusable={true} />
        )}
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Pyrolight pairing</DialogControlsSectionHeader>
        {pairingStatuses.map((status) =>
          <Field key={status} label={stringifyStatus(status)} description={pairingStatusDescriptions[status]} focusable={true} />
        )}
      </DialogControlsSection>
    </DialogBody>
  );
};
