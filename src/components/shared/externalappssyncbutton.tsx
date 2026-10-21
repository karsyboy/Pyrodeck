import { AppType, logger } from "../../lib";
import { ConfirmModal, DialogButton, showModal } from "@decky/ui";
import { FC, useContext } from "react";
import { useAppSyncState, useServerStatus } from "../../hooks";
import { ExternalAppType } from "../../lib/externalappshortcuts";
import { MoonDeckContext } from "../../contexts";

interface Props {
  text: string;
  appType: ExternalAppType;
  noConfirmationDialog?: boolean;
}

export const ExternalAppsSyncButton: FC<Props> = ({ text, appType, noConfirmationDialog }) => {
  const { externalAppShortcuts } = useContext(MoonDeckContext);
  const syncState = useAppSyncState();
  const [serverStatus] = useServerStatus();

  const handleClick = (): void => {
    const onOk = (): void => {
      if (serverStatus === "Offline" && appType === AppType.GameStream) {
        // Querying the host's apps through Pyrolight may wake up the host. Let's avoid that...
        logger.toast("The host is offline!", { output: "error" });
        return;
      }

      externalAppShortcuts.syncShortcuts(appType).catch((e) => logger.critical(e));
    };

    if (syncState.syncing) {
      return;
    }

    if (noConfirmationDialog) {
      onOk();
      return;
    }

    showModal(
      <ConfirmModal
        strTitle="Are you sure you want to sync?"
        strDescription="This action cannot be undone."
        onOK={onOk}
      />
    );
  };

  return (
    <DialogButton disabled={syncState.syncing} onClick={() => handleClick()}>
      {syncState.formatText(false, appType, text)}
    </DialogButton>
  );
};
