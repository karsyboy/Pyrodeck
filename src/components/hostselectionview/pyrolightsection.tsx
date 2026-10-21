import { ConfirmModal, DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field, showModal } from "@decky/ui";
import { FC, useContext, useEffect, useState } from "react";
import { PairingStatus, ServerStatus, getPairingStatus, getPyrolightPath, logger, pairingStatusDescriptions } from "../../lib";
import { CurrentHostSettings } from "../../hooks";
import { GameSteamMain } from "../icons";
import { MoonDeckContext } from "../../contexts";
import { StatusField } from "../shared";

interface Props {
  hostSettings: CurrentHostSettings;
  pyrolightExecPath: string | null;
  serverStatus: ServerStatus;
  disabled: boolean;
}

const PairModal: FC<{ closeModal?: () => void; onConfirm: () => void }> = ({ closeModal, onConfirm }) => {
  return (
    <ConfirmModal
      strTitle="Pair Pyrolight with this host"
      strDescription={
        "Pyrolight opens and shows a four-digit PIN. On the host, approve the request with that PIN in Pyroshine's " +
        "web interface (Clients) or with `pyroshine pair`. Pyrolight closes when pairing is done."
      }
      strOKButtonText="Start pairing"
      closeModal={closeModal}
      onOK={onConfirm}
    />
  );
};

// Pyrolight owns pairing: PyroDeck starts Pyrolight's own pairing screen and
// checks the result with a headless app-list request. It never reads or
// copies Pyrolight's credentials.
export const PyrolightSection: FC<Props> = ({ hostSettings, pyrolightExecPath, serverStatus, disabled }) => {
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const [executable, setExecutable] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<PairingStatus>("Unknown");

  useEffect(() => {
    let active = true;
    getPyrolightPath(pyrolightExecPath)
      .then((path) => { if (active) setExecutable(path); })
      .catch((e) => logger.critical(e));
    return () => { active = false; };
  }, [pyrolightExecPath]);

  useEffect(() => { setStatus("Unknown"); }, [hostSettings.currentHostId]);

  const check = (): void => {
    setStatus("Checking");
    getPairingStatus(hostSettings.address, hostSettings.hostInfoPort, hostSettings.currentHostId, pyrolightExecPath)
      .then(setStatus)
      .catch((e) => { logger.critical(e); setStatus("Error"); });
  };

  const pair = (): void => {
    showModal(<PairModal onConfirm={() => { moonDeckAppLauncher.launchUtility("pair").catch((e) => logger.critical(e)); }} />);
  };

  return (
    <DialogControlsSection>
      <DialogControlsSectionHeader>Pyrolight</DialogControlsSectionHeader>
      <Field label="Executable" focusable={true} description={executable === null ? pairingStatusDescriptions.NotInstalled : undefined}>
        {executable === undefined ? "Looking..." : (executable ?? "Not found")}
      </Field>
      <StatusField label="Pairing" icon={GameSteamMain} status={status} isRefreshing={status === "Checking"} />
      <Field description={pairingStatusDescriptions[status]} bottomSeparator="none" />
      <Field label="Check pairing" childrenContainerWidth="fixed">
        <DialogButton disabled={disabled || status === "Checking" || serverStatus !== "Online" || !executable} onClick={check}>
          Check
        </DialogButton>
      </Field>
      <Field
        label="Pair Pyrolight"
        description="Needed once per host. Approve the PIN on the host."
        childrenContainerWidth="fixed"
      >
        <DialogButton disabled={disabled || status === "Paired" || serverStatus !== "Online" || !executable} onClick={pair}>
          Pair
        </DialogButton>
      </Field>
    </DialogControlsSection>
  );
};
