import { DialogButton, DialogButtonProps } from "@decky/ui";
import { FC } from "react";

// ButtonItem reserves a label column even without a label in some Steam builds.
// A native DialogButton fills the row and retains Steam's focus/contrast styles.
export const ActionButton: FC<DialogButtonProps> = ({ style, ...props }) => (
  <DialogButton
    {...props}
    style={{
      width: "100%",
      minWidth: 0,
      minHeight: 44,
      margin: "4px 0",
      boxSizing: "border-box",
      whiteSpace: "normal",
      ...style
    }}
  />
);
