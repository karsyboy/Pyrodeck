import { DialogBody, DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field, Navigation } from "@decky/ui";
import { FC } from "react";
import { MoonDeckLaunchButtonShell } from "../moondecklaunchbutton";
import { SettingsLoadingField } from "../shared";
import { useCurrentSettings } from "../../hooks";

const pyroshineLink = "https://github.com/karsyboy/pyroshine#readme";
const pyrolightLink = "https://github.com/karsyboy/pyrolight/releases";
const pyrodeckLink = "https://github.com/karsyboy/pyrodeck#troubleshooting";

export const SetupGuideView: FC = () => {
  const settings = useCurrentSettings();
  if (settings === null) {
    return <SettingsLoadingField />;
  }

  return (
    <DialogBody>
      <DialogControlsSection>
        <DialogControlsSectionHeader>How to get PyroDeck working</DialogControlsSectionHeader>
        <Field
          label="Step 1 - Run Pyroshine on the host PC"
          description="Install Pyroshine and Steam on the host and install your games there. Nothing else is needed on the host."
        >
          <DialogButton onClick={() => { Navigation.NavigateToExternalWeb(pyroshineLink); }}>Open</DialogButton>
        </Field>
        <Field
          label="Step 2 - Install Pyrolight on the Steam Deck"
          description="In Desktop Mode, download the Pyrolight AppImage into ~/Applications and make it executable. PyroDeck finds it there."
        >
          <DialogButton onClick={() => { Navigation.NavigateToExternalWeb(pyrolightLink); }}>Open</DialogButton>
        </Field>
        <Field
          label="Step 3 - Select the host"
          description="On the left, open &quot;Host Selection&quot;, scan the network (or add the host by address) and select it."
          focusable={true}
        />
        <Field
          label="Step 4 - Pair Pyrolight"
          description="On &quot;Host Selection&quot;, press Pair. Pyrolight shows a PIN: approve it on the host in Pyroshine's web interface or with `pyroshine pair`. Press Check to confirm the pairing."
          focusable={true}
        />
        <Field
          label="Step 5 - Launch a game from its library page"
          description="Open any Steam game installed on the host and press the PyroDeck button. Closing the stream keeps the game running on the host; End Game on Host in the quick access menu closes it."
          focusable={true}
        >
          <MoonDeckLaunchButtonShell buttonStyle={settings.buttonStyle} />
        </Field>
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Troubleshooting</DialogControlsSectionHeader>
        <Field label="Common errors and what to do about them">
          <DialogButton onClick={() => { Navigation.NavigateToExternalWeb(pyrodeckLink); }}>Open</DialogButton>
        </Field>
      </DialogControlsSection>
    </DialogBody>
  );
};
