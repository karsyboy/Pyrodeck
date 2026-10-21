import { ButtonItem, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { CurrentHostSettings, useCommandExecutionStatus } from "../../hooks";
import { FC, useContext } from "react";
import { GameStreamHost, ServerStatus, executeAsyncWrapper, hostGameStateLabels, logger } from "../../lib";
import { EndHostGameModal } from "../shared";
import { MoonDeckContext } from "../../contexts";

interface Props {
  serverStatus: ServerStatus;
  hostInfo: GameStreamHost | null;
  currentHostSettings: CurrentHostSettings;
}

export const HostControlPanel: FC<Props> = ({ serverStatus, hostInfo }) => {
  const { connectivityManager, moonDeckAppLauncher } = useContext(MoonDeckContext);
  const executionStatus = useCommandExecutionStatus();
  const gameRunning = serverStatus === "Online" && (hostInfo?.currentGame ?? 0) !== 0;

  return (
    <PanelSection title="HOST" spinner={executionStatus}>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          bottomSeparator="none"
          disabled={executionStatus || serverStatus !== "Offline"}
          onClick={executeAsyncWrapper(() => connectivityManager.commandProxy.wakeOnLan())}
        >
          Wake On LAN
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          description={gameRunning ? (hostInfo?.gameState ? hostGameStateLabels[hostInfo.gameState] : "A game is running on the host.") : "No game is running on the host."}
          disabled={!gameRunning}
          onClick={() => {
            showModal(<EndHostGameModal onConfirm={() => { moonDeckAppLauncher.endHostGame().catch((e) => logger.critical(e)); }} />);
          }}
        >
          End Game on Host
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};
