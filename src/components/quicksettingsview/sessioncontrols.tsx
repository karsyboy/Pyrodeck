import { AppType, logger } from "../../lib";
import {
  ButtonItem,
  Field,
  PanelSection,
  PanelSectionRow,
  showModal
} from "@decky/ui";
import { FC, useContext, useState } from "react";
import { EndHostGameModal } from "../shared";
import { MoonDeckContext } from "../../contexts";
import { pyrolightIntegration } from "../../lib/pyrolightintegration";
import { usePyrolight } from "../../hooks/usepyrolight";

export const SessionControls: FC = () => {
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const state = usePyrolight();
  const [working, setWorking] = useState(false);
  const session = state.session;
  const disabled = working || state.busy;
  const run = (action: () => Promise<void>): void => {
    setWorking(true);
    void action()
      .catch((error: unknown) =>
        logger.toast(String(error), { output: "error" })
      )
      .finally(() => {
        setWorking(false);
        void pyrolightIntegration.refreshSession();
      });
  };
  if (session.state === "none")
    return (
      <Field
        label="No PyroDeck session"
        description="Choose Stream with Pyrolight in your library or open Remote Games."
      />
    );
  return (
    <PanelSection title="Session Controls">
      <PanelSectionRow>
        <Field
          label={session.appName ?? "Remote game"}
          description={`${session.hostName ?? "Host"} · ${session.state}${session.error ? ` · ${session.error}` : ""}`}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          disabled={
            disabled ||
            !["connecting", "launching", "streaming", "reconnecting"].includes(
              session.state
            )
          }
          onClick={() =>
            run(() => moonDeckAppLauncher.moonDeckApp.killApp(true))}
        >
          Disconnect
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          disabled={disabled || session.state === "ended"}
          onClick={() =>
            run(async () => {
              if (session.runnerActive) {
                await pyrolightIntegration.reconnect();
              } else if (session.hostId && session.steamAppId) {
                await moonDeckAppLauncher.launchApp(
                  session.steamAppId,
                  session.appName ?? "Remote game",
                  AppType.MoonDeck,
                  undefined,
                  { hostId: session.hostId }
                );
              } else if (session.hostId && session.remoteAppId) {
                await moonDeckAppLauncher.launchRemote(
                  session.hostId,
                  session.remoteAppId,
                  session.appName ?? "Remote game"
                );
              }
            })}
        >
          Reconnect
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          disabled={
            disabled ||
            !session.hostId ||
            !session.remoteAppId ||
            session.state === "ended"
          }
          onClick={() =>
            showModal(
              <EndHostGameModal
                onConfirm={() =>
                  run(() =>
                    moonDeckAppLauncher.endHostGame(
                      session.hostId,
                      session.remoteAppId
                    )
                  )}
              />
            )}
        >
          End Remote Game
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};
