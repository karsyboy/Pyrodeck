import { AppType, logger } from "../../lib";
import { FC, useContext, useState } from "react";
import { Field, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { usePyrolight, useSessionPolling } from "../../hooks/usepyrolight";
import { ActionButton } from "../shared/actionbutton";
import { EndHostGameModal } from "../shared";
import { MoonDeckContext } from "../../contexts";
import { pyrolightIntegration } from "../../lib/pyrolightintegration";

export const SessionControls: FC = () => {
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const state = usePyrolight();
  const [working, setWorking] = useState(false);
  const session = state.session;
  useSessionPolling();
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
      <PanelSection title="Session">
        <PanelSectionRow>
          <Field
            label="No active session"
            description="Choose Stream with Pyrolight in your library or open Remote Games."
          />
        </PanelSectionRow>
      </PanelSection>
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
        <Field description="Disconnect keeps the host game open. End Remote Game closes it." />
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton
          disabled={
            disabled ||
            !["waking", "connecting", "launching", "streaming", "reconnecting"].includes(
              session.state
            )
          }
          onClick={() =>
            run(async () => { await moonDeckAppLauncher.moonDeckApp.killApp(true); await moonDeckAppLauncher.moonDeckApp.clearApp(); })}
        >
          Disconnect
        </ActionButton>
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton
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
                  { hostId: session.hostId, remoteAppId: session.remoteAppId }
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
        </ActionButton>
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton
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
        </ActionButton>
      </PanelSectionRow>
    </PanelSection>
  );
};
