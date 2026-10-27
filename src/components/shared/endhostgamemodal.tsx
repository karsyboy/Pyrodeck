import { ConfirmModal } from "@decky/ui";
import { FC } from "react";

interface Props {
  closeModal?: () => void;
  onConfirm: () => void;
}

// Ending the host game is the only PyroDeck action that stops something on
// the host, so it always asks first. Closing the stream never does this.
export const EndHostGameModal: FC<Props> = ({ closeModal, onConfirm }) => {
  return (
    <ConfirmModal
      strTitle="End the game on the host?"
      strDescription="The application currently running on the host will be closed; unsaved progress may be lost. To keep it running for later, just close the stream instead."
      strOKButtonText="End game"
      strCancelButtonText="Keep it running"
      closeModal={closeModal}
      onOK={onConfirm}
    />
  );
};
