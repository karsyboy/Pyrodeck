import { DialogBody, DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field, Navigation } from "@decky/ui";
import { ExternalAppsPurgeButton, ExternalAppsSyncButton, LabelWithIcon, ToggleField } from "../shared";
import { FC, ReactNode, useContext } from "react";
import { useCurrentHostSettings, useCurrentSettings, useGameStreamAppShortcuts } from "../../hooks";
import { AppType } from "../../lib";
import { HostOff } from "../icons";
import { MoonDeckContext } from "../../contexts";

export const GameStreamAppsView: FC = () => {
  const { settingsManager } = useContext(MoonDeckContext);
  const settings = useCurrentSettings();
  const hostSettings = useCurrentHostSettings();
  const shortcuts = useGameStreamAppShortcuts();

  let syncButton: ReactNode = null;
  if (settings == null || hostSettings === null) {
    syncButton =
      <DialogControlsSection>
        <DialogControlsSectionHeader>Sync with the host</DialogControlsSectionHeader>
        <Field
          label={<LabelWithIcon icon={HostOff} label="HOST IS NOT SELECTED" />}
          description="Go to host selection page to select host"
          bottomSeparator="none"
        />
      </DialogControlsSection>;
  } else {
    syncButton =
      <DialogControlsSection>
        <DialogControlsSectionHeader>Sync with the host</DialogControlsSectionHeader>
        <Field
          label="Sync all host apps"
          description="Steam client might be restarted afterwards!"
          childrenContainerWidth="fixed"
        >
          <ExternalAppsSyncButton text="Sync Apps" appType={AppType.GameStream} />
        </Field>
        <ToggleField
          label="Show button in Quick Access Menu"
          description="Confirmation dialog will not be displayed when using it!"
          value={hostSettings.gameStreamApps.showQuickAccessButton}
          setValue={(value) => settingsManager.updateHost((settings) => { settings.gameStreamApps.showQuickAccessButton = value; })}
        />
      </DialogControlsSection>;
  }

  let shortcutsList: ReactNode = null;
  if (shortcuts.length > 0) {
    shortcutsList =
      <DialogControlsSection>
        <DialogControlsSectionHeader>Generated Shortcuts</DialogControlsSectionHeader>
        {shortcuts.map((shortcut) => {
          return (
            <Field
              key={shortcut.appId}
              label={shortcut.appName}
              childrenContainerWidth="min"
            >
              <DialogButton onClick={() => Navigation.Navigate(`/library/app/${shortcut.appId}`)}>
                Open
              </DialogButton>
            </Field>
          );
        })}
      </DialogControlsSection>;
  }

  return (
    <DialogBody>
      <DialogControlsSection>
        <DialogControlsSectionHeader>What are the host apps?</DialogControlsSectionHeader>
        <Field
          description={
            <>
              <div>These are non-Steam shortcuts PyroDeck creates from the host's app list (what Pyrolight shows), for apps that are not in your Steam library: Desktop, Lutris or Heroic games and your own Pyroshine entries.</div>
              <div>Steam library games do not need this: use the PyroDeck button on their library page.</div>
              <br />
              <div>PyroDeck keeps shortcuts whose name and executable do not change, so custom artwork stays.</div>
              <div>If this cannot be done, the shortcuts will be removed and new ones created.</div>
              <br />
              <div>All synced apps are added to the PyroDeck library collection.</div>
            </>
          }
          focusable={true}
        />
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Cleanup</DialogControlsSectionHeader>
        <Field
          label="Purge all generated shortcuts!"
          description="Steam client might be restarted afterwards!"
          childrenContainerWidth="fixed"
        >
          <ExternalAppsPurgeButton disabled={shortcuts.length === 0} appType={AppType.GameStream} />
        </Field>
      </DialogControlsSection>
      {syncButton}
      {shortcutsList}
    </DialogBody>
  );
};
