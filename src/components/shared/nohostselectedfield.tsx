import { DialogBody, DialogControlsSection, Field } from "@decky/ui";
import { FC } from "react";
import { HostOff } from "../icons";
import { LabelWithIcon } from "./labelwithicon";

/** Shown by per-host settings while no host is selected. */
export const NoHostSelectedField: FC = () => (
  <Field
    label={<LabelWithIcon icon={HostOff} label="HOST IS NOT SELECTED" />}
    description="Select a host in Hosts & Pairing first."
    bottomSeparator="none"
  />
);

export const NoHostSelectedView: FC = () => (
  <DialogBody>
    <DialogControlsSection>
      <NoHostSelectedField />
    </DialogControlsSection>
  </DialogBody>
);
