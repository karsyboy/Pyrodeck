import { Catalog, SessionStatus } from "../../lib/pyrolightintegration";
import { DropdownItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { FC, useEffect, useState, useSyncExternalStore } from "react";
import { ActionButton } from "../shared/actionbutton";
import { call } from "@decky/api";
import { steamIntegrationStatus } from "../../lib/steamintegrationstatus";
interface Report {
  pyrodeckVersion?: string;
  session: SessionStatus;
  processes: { runnerActive: boolean; clientPid: number | null };
  catalog?: Catalog;
  pyrolightVersion?: string;
  error?: string;
}
export const Diagnostics: FC = () => {
  const steam = useSyncExternalStore(steamIntegrationStatus.subscribe, steamIntegrationStatus.getSnapshot);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("runner");
  const [output, setOutput] = useState<{ path: string; text: string } | null>(null);
  const refresh = (): void => {
    setBusy(true);
    void call<[], Report>("troubleshooting").then(setReport).catch((problem: unknown) => setError(String(problem))).finally(() => setBusy(false));
  };
  useEffect(refresh, []);
  return (
    <PanelSection title="Troubleshooting & Diagnostics">
      <PanelSectionRow><Field label={`PyroDeck ${report?.pyrodeckVersion ?? "unknown"}`} description={`Pyrolight: ${report?.pyrolightVersion ?? "Unavailable"}`} /></PanelSectionRow>
      <PanelSectionRow><ActionButton disabled={busy} onClick={refresh}>{busy ? "Refreshing…" : "Refresh Diagnostics"}</ActionButton></PanelSectionRow>
      <PanelSectionRow><Field label="Steam Library integration" description={`${steam.libraryPhase ?? "Not attached"} · ${steam.library} · Steam App ID: ${steam.currentAppId ?? "none"} · Eligible hosts: ${steam.eligibleHostIds?.join(", ") || "none"}`} /></PanelSectionRow>
      {steam.libraryDetails && <PanelSectionRow><Field label="Library mount observations" description={steam.libraryDetails} /></PanelSectionRow>}
      <PanelSectionRow><Field label="Steam presentation" description={steam.overlay} /></PanelSectionRow>
      {steam.launchFailure && <PanelSectionRow><Field label={`Last launch failure · ${steam.launchStage}`} description={steam.launchFailure} /></PanelSectionRow>}
      {(error || report?.error) && <PanelSectionRow><Field label="Diagnostic query" description={error ?? report?.error} /></PanelSectionRow>}
      {report && (
        <>
          <PanelSectionRow><Field label="Runner & client" description={`Runner: ${report.processes.runnerActive ? "active" : "stopped"} · Pyrolight PID: ${report.processes.clientPid ?? "none"}`} /></PanelSectionRow>
          <PanelSectionRow><Field label={`Session: ${report.session.state}`} description={`Stage: ${report.session.stage ?? "unknown"} · Last Pyrolight event: ${report.session.lastLifecycle ?? "none"} · Backend: ${report.session.displayBackend ?? "unknown"}${report.session.error ? ` · ${report.session.error}` : ""}`} /></PanelSectionRow>
          <PanelSectionRow><Field label="Client window" description={report.session.window ? `SDL ID ${report.session.window.id} · Native ID: ${report.session.window.nativeId ?? "unavailable"} · SteamGameId: ${report.session.window.steamGameId ?? "unknown"} · Shown: ${report.session.window.shown} · Focused: ${report.session.window.focused} · Renderer: ${report.session.window.rendererReady}` : "Not confirmed. SDL readiness does not prove compositor visibility; verify video on the Deck."} /></PanelSectionRow>
          {report.catalog?.hosts.map((host) => <PanelSectionRow key={host.id}><Field label={host.name} description={`${host.status} · ${host.apps.length} apps · Host software version: not advertised${host.cached ? " · previously validated catalog" : ""}${host.error ? ` · ${host.error}` : ""}`} /></PanelSectionRow>)}
        </>
      )}
      <PanelSectionRow><DropdownItem label="Log" selectedOption={log} rgOptions={["frontend", "backend", "runner", "pyrolight"].map((name) => ({ data: name, label: name }))} onChange={(value) => { setLog(value.data as string); setOutput(null); }} /></PanelSectionRow>
      <PanelSectionRow><ActionButton onClick={() => { void call<[string], { path: string; text: string }>("diagnostic_log", log).then(setOutput).catch((problem: unknown) => setError(String(problem))); }}>View Log</ActionButton></PanelSectionRow>
      {output && (
        <PanelSectionRow>
          <Field label={output.path} />
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, maxHeight: 400, overflow: "auto", userSelect: "text" }}>{output.text}</pre>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};
