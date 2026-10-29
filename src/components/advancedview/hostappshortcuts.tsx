import { DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field, Navigation } from "@decky/ui";
import { ExternalAppsPurgeButton, ExternalAppsSyncButton, ToggleField } from "../shared";
import { FC, useContext } from "react";
import { AppType } from "../../lib";
import { CurrentHostSettings } from "../../hooks";
import { MoonDeckContext } from "../../contexts";
import { useGameStreamAppShortcuts } from "../../hooks";

/** Optional Steam shortcuts for host apps that are not Steam games. */
export const HostAppShortcutsSection: FC<{ hostSettings: CurrentHostSettings }> = ({ hostSettings }) => {
  const { settingsManager } = useContext(MoonDeckContext);
  const shortcuts = useGameStreamAppShortcuts();
  return (
    <DialogControlsSection>
      <DialogControlsSectionHeader>Host App Shortcuts</DialogControlsSectionHeader>
      <Field
        description="Adds the host's non-Steam apps (Desktop, Lutris or Heroic games, your own Pyroshine entries) to the PyroDeck collection. Steam games need no shortcut. Unchanged shortcuts keep their artwork."
        focusable={true}
      />
      <Field label="Sync host apps" description="Steam may restart afterwards." childrenContainerWidth="fixed">
        <ExternalAppsSyncButton text="Sync" appType={AppType.GameStream} />
      </Field>
      <ToggleField
        label="Sync from Quick Access"
        description="Shows a sync button in Quick Access that syncs without asking."
        value={hostSettings.gameStreamApps.showQuickAccessButton}
        setValue={(value) => settingsManager.updateHost((settings) => { settings.gameStreamApps.showQuickAccessButton = value; })}
      />
      <Field label="Remove all host app shortcuts" description="Steam may restart afterwards." childrenContainerWidth="fixed">
        <ExternalAppsPurgeButton disabled={shortcuts.length === 0} appType={AppType.GameStream} />
      </Field>
      {shortcuts.map((shortcut) => (
        <Field key={shortcut.appId} label={shortcut.appName} childrenContainerWidth="min">
          <DialogButton onClick={() => Navigation.Navigate(`/library/app/${shortcut.appId}`)}>Open</DialogButton>
        </Field>
      ))}
    </DialogControlsSection>
  );
};
