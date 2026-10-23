import { ConfirmModal, showModal } from "@decky/ui";

export async function confirmStreamSwitch(name: string, host: string, sameHost: boolean): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    showModal(
      <ConfirmModal
        strTitle={sameHost ? "Switch remote games?" : "Stream from another host?"}
        strDescription={sameHost ? `Switching will end ${name} on ${host}. Unsaved progress may be lost. The server will refuse if that game has changed or cannot safely be ended.` : `Disconnect from ${name} on ${host} and connect to the selected host? The original game stays running according to the host's retention policy.`}
        strOKButtonText="Switch"
        strCancelButtonText="Keep current stream"
        onOK={() => resolve(true)}
        onCancel={() => resolve(false)}
        onEscKeypress={() => resolve(false)}
      />
    );
  });
}
