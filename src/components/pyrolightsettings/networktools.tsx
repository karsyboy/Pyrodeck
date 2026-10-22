import { FC, useState } from "react";
import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { ActionButton } from "../shared/actionbutton";
import { call } from "@decky/api";
import { pyrolightIntegration } from "../../lib/pyrolightintegration";
import { useCurrentSettings } from "../../hooks";

interface NetworkResult {
  ok: boolean;
  problem?: string;
  message?: string;
  fixDescription?: string;
  manualCommand?: string;
  needsFix?: boolean;
  canApply?: boolean;
  ceilingKbps?: number;
  error?: { message: string };
}
export const NetworkTools: FC = () => {
  const settings = useCurrentSettings();
  const [result, setResult] = useState<NetworkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: string): Promise<void> => {
    if (!settings?.currentHostId) return;
    setBusy(true);
    setError(null);
    try {
      const value = await call<[string, string], NetworkResult>(
        "pyrolight_network_tool",
        settings.currentHostId,
        action
      );
      if (!value.ok)
        throw new Error(
          value.error?.message ?? value.message ?? "Network check failed"
        );
      setResult(value);
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PanelSection title="Pyrolight Network Tools" spinner={busy}>
      <PanelSectionRow>
        <Field
          description={`Host: ${settings?.hostSettings[settings.currentHostId ?? ""]?.hostName ?? "Select a host"}. Calibration reports a recommendation; it never changes bitrate automatically.`}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton
          disabled={busy || !settings?.currentHostId}
          onClick={() => {
            void run("check");
          }}
        >
          Check Receive Buffers
        </ActionButton>
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton
          disabled={busy || !settings?.currentHostId}
          onClick={() => {
            void run("calibrate");
          }}
        >
          Calibrate Network Bandwidth
        </ActionButton>
      </PanelSectionRow>
      {result && (
        <PanelSectionRow>
          <Field
            label={
              result.ceilingKbps ?
                `Recommendation: ${result.ceilingKbps} Kbps` :
                "Network buffers"
            }
            description={result.problem ?? result.message}
          />
        </PanelSectionRow>
      )}
      {result?.needsFix && (
        <>
          <PanelSectionRow>
            <Field description={result.fixDescription} />
          </PanelSectionRow>
          <PanelSectionRow>
            <Field label="Manual command" description={result.manualCommand} />
          </PanelSectionRow>
          <PanelSectionRow>
            <ActionButton
              disabled={busy || !result.canApply}
              onClick={() => {
                void run("fix");
              }}
            >
              Fix Receive Buffers…
            </ActionButton>
          </PanelSectionRow>
        </>
      )}
      {result?.ceilingKbps && (
        <PanelSectionRow>
          <ActionButton
            onClick={() => {
              pyrolightIntegration.stage("autoAdjustBitrate", false);
              pyrolightIntegration.stage("bitrateKbps", result.ceilingKbps!);
            }}
          >
            Stage Recommended Bitrate
          </ActionButton>
        </PanelSectionRow>
      )}
      {error && (
        <PanelSectionRow>
          <Field label="Network tool" description={error} />
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};
