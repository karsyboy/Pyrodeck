import { AppType, MoonDeckAppData, logger } from "../../lib";
import { ButtonItem, Field, Navigation, PanelSection, PanelSectionRow, ToggleField, showModal } from "@decky/ui";
import { FC, useContext, useState } from "react";
import { EndHostGameModal } from "../shared";
import { MoonDeckContext } from "../../contexts";

interface Props {
  appData: MoonDeckAppData;
}

export const GameSessionPanel: FC<Props> = ({ appData }) => {
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const [isDisabled, setIsDisabled] = useState<boolean>(false);

  const handleNameChange = (): void => {
    setIsDisabled(true);
    moonDeckAppLauncher.moonDeckApp.changeName(!appData.sessionOptions.nameSetToAppId)
      .then((result) => { if (!result) logger.toast("Failed to change app name!", { output: "error" }); })
      .catch((e) => logger.critical(e))
      .finally(() => setIsDisabled(false));
  };

  const handleTermination = (): void => {
    setIsDisabled(true);
    Navigation.CloseSideMenus();
    moonDeckAppLauncher.moonDeckApp.killApp()
      .catch((e) => logger.critical(e))
      .finally(() => setIsDisabled(false));
  };

  const handleEndHostGame = (): void => {
    showModal(
      <EndHostGameModal onConfirm={() => {
        setIsDisabled(true);
        Navigation.CloseSideMenus();
        moonDeckAppLauncher.endHostGame()
          .catch((e) => logger.critical(e))
          .finally(() => setIsDisabled(false));
      }}
      />
    );
  };

  let gameSession = null;
  if (appData.appType === AppType.MoonDeck) {
    gameSession =
      <PanelSection title="Game Session">
        <PanelSectionRow>
          <ToggleField
            label="AppId as game title"
            disabled={isDisabled}
            checked={appData.sessionOptions.nameSetToAppId}
            onChange={() => handleNameChange()}
          />
        </PanelSectionRow>
      </PanelSection>;
  }

  return (
    <>
      {gameSession}
      <PanelSection title="Stream">
        <PanelSectionRow>
          <Field
            bottomSeparator="none"
            description="Disconnect closes Pyrolight; the game keeps running on the host and you can reconnect from its library page."
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            disabled={isDisabled}
            layout="below"
            bottomSeparator="none"
            onClick={() => handleTermination()}
          >
            Disconnect
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            disabled={isDisabled}
            layout="below"
            onClick={() => handleEndHostGame()}
          >
            End Game on Host
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};
