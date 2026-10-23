import { DialogBody, DialogControlsSection, DialogControlsSectionHeader, Field } from "@decky/ui";
import { FC } from "react";

export const ChangelogView: FC = () => {
  return (
    <DialogBody>
      <DialogControlsSection>
        <DialogControlsSectionHeader>Upcoming</DialogControlsSectionHeader>
        <Field description="Controller Back from a Quick Access subpage returns to PyroDeck's main menu before exiting to Decky's plugin list." />
        <Field description="Add individual Remote Games applications, including the host's Steam entry, to your Steam Library. Saved shortcuts keep their original host and application. Host non-Steam Steam Library games are available with an updated Pyroshine build." />
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>PyroDeck 0.2.0</DialogControlsSectionHeader>
        <Field description="Separate Stream with Pyrolight library action; explicit multi-host selection; Remote Games browser; native Pyrolight profiles and settings in Quick Access; staged Apply & Reconnect; pinned session controls and conditional remote termination." />
      </DialogControlsSection>
      <DialogControlsSection>
        <Field
          label="0.1.0"
          description={
            <>
              <div>&bull; First PyroDeck release, based on MoonDeck 1.13.0 by FrogTheFrog.</div>
              <div>&bull; Streams Steam library games from a Pyroshine host through Pyrolight. MoonDeck Buddy is no longer used or needed.</div>
              <div>&bull; Games are found on the host by their Steam app ID, never by title.</div>
              <div>&bull; Closing the stream keeps the game running on the host; End Game on Host closes it on purpose.</div>
              <div>&bull; Pairing uses Pyrolight's own pairing, started from Host Selection.</div>
              <div>&bull; PyroDeck only stops the Pyrolight it started; other Pyrolight, Moonlight or MoonDeck processes are left alone.</div>
              <div>&bull; PyroDeck can be installed next to MoonDeck: its settings, shortcuts, logs and collection are its own. MoonDeck's hosts and preferences are imported once.</div>
              <div>&bull; New Pyrolight options: PyroWave codec and VRR presentation, used only when the installed Pyrolight offers them.</div>
              <div>&bull; The quick access menu and Host Info show whether Steam is launching, updating or running the game on the host.</div>
              <div>&bull; Removed: Buddy pairing, Steam control on the host, host restart/shutdown/suspend, Non-Steam app sync and the CLI.</div>
            </>
          }
          focusable={true}
        />
      </DialogControlsSection>
    </DialogBody>
  );
};
