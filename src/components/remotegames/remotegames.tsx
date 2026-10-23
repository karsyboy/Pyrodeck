import {
  Catalog,
  RemoteApp,
  appKind,
  pyrolightIntegration,
  steamArtwork,
  steamSourceId
} from "../../lib/pyrolightintegration";
import {
  DropdownItem,
  Field,
  Focusable,
  Menu,
  MenuItem,
  PanelSection,
  PanelSectionRow,
  TextField,
  showContextMenu
} from "@decky/ui";
import { FC, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePyrolightSession, useSessionPolling } from "../../hooks/usepyrolight";
import { ActionButton } from "../shared/actionbutton";
import { FaEllipsisH } from "react-icons/fa";
import { MoonDeckContext } from "../../contexts";
import { call } from "@decky/api";
import { useAppSyncState } from "../../hooks/useappsyncstate";
import { useRemoteAppShortcuts } from "../../hooks/usegamestreamappshortcuts";

const Artwork: FC<{ hostId: string; app: RemoteApp }> = ({ hostId, app }) => {
  const [image, setImage] = useState<string | undefined>(steamArtwork(app));
  useEffect(() => {
    let cancelled = false;
    setImage(steamArtwork(app));
    void call<[string, number], { image?: string }>(
      "remote_artwork",
      hostId,
      app.id
    )
      .then((result) => {
        if (!cancelled && result.image) setImage(result.image);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hostId, app.id]);
  return image ?
      (
        <img
          src={image}
          alt=""
          loading="lazy"
          style={{
            width: 54,
            height: 72,
            objectFit: "cover",
            borderRadius: 4,
            flexShrink: 0
          }}
          onError={() => setImage(undefined)}
        />
      ) :
      (
        <div
          aria-hidden="true"
          style={{
            width: 54,
            height: 72,
            flexShrink: 0,
            borderRadius: 4,
            background: "linear-gradient(140deg, #33465b, #162333)",
            display: "grid",
            placeItems: "center",
            fontSize: 30
          }}
        >
          {app.name.slice(0, 1).toUpperCase()}
        </div>
      );
};

export const RemoteGames: FC = () => {
  const { moonDeckAppLauncher, externalAppShortcuts } = useContext(MoonDeckContext);
  const shortcuts = useRemoteAppShortcuts();
  const syncState = useAppSyncState();
  const menu = useRef<ReturnType<typeof showContextMenu> | null>(null);
  const session = usePyrolightSession();
  useSessionPolling();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [hostId, setHostId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = async (refresh = false): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await pyrolightIntegration.catalog(refresh);
      setCatalog(result);
      setPage(0);
      setHostId((current) =>
        result.hosts.some((host) => host.id === current) ?
          current :
            (result.defaultHostId ?? "")
      );
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const host = catalog?.hosts.find((entry) => entry.id === hostId);
  const apps = useMemo(() => (host?.apps ?? [])
    .filter(
      (app) =>
        app.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
        (kind === "all" || appKind(app) === kind)
    )
    .sort((a, b) =>
      sort === "recent" ?
          (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) ||
          a.name.localeCompare(b.name) :
          a.name.localeCompare(b.name)
    ), [host?.apps, query, kind, sort]);
  useEffect(() => {
    setPage(0);
  }, [hostId, query, kind, sort]);
  useEffect(() => () => {
    // A native popup can deactivate Quick Access while it owns focus. Steam
    // handles popup dismissal; only changing its contents/owner invalidates it.
    menu.current?.Hide();
    menu.current = null;
  }, [hostId, query, kind, sort, page]);
  const openActions = (app: RemoteApp, anchor: EventTarget): void => {
    if (busy) return;
    menu.current?.Hide();
    const saved = shortcuts.some((shortcut) => shortcut.hostId === hostId && shortcut.remoteAppId === app.id);
    menu.current = showContextMenu(
      <Menu label={app.name}>
        <MenuItem
          disabled={saved || syncState.syncing || !host?.validated}
          onSelected={() => {
            menu.current?.Hide();
            menu.current = null;
            setBusy(true);
            setError(null);
            setMessage(null);
            void externalAppShortcuts.addRemoteShortcut(hostId, app)
              .then(() => setMessage(`${app.name} added to your Steam Library.`))
              .catch((problem: unknown) => setError(String(problem)))
              .finally(() => setBusy(false));
          }}
        >
          {saved ? "In Steam Library" : "Add to Steam Library"}
        </MenuItem>
      </Menu>, anchor, { bOverlapHorizontal: true, bPreferPopLeft: true }
    );
  };
  return (
    <PanelSection title="Remote Games" spinner={busy}>
      <PanelSectionRow>
        <DropdownItem
          layout="below"
          label="Host"
          disabled={busy}
          selectedOption={hostId}
          rgOptions={[
            { data: "", label: "Choose a host" },
            ...(catalog?.hosts ?? []).map((entry) => ({
              data: entry.id,
              label: `${entry.name} · ${{ paired: "Ready", not_paired: "Pairing required", unreachable: "Offline", client_error: "Update Pyrolight", outdated: "Update Pyrolight", wrong_host: "Host identity changed" }[entry.status] ?? "Unavailable"}`
            }))
          ]}
          onChange={(choice) => setHostId(choice.data as string)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Search games"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ActionButton onClick={() => setFiltersOpen(!filtersOpen)}>
          {filtersOpen ? "Hide Filters" : "Filter & Sort…"}
        </ActionButton>
      </PanelSectionRow>
      {filtersOpen && (
        <>
          <PanelSectionRow>
            <DropdownItem
              layout="below"
              label="Application type"
              selectedOption={kind}
              rgOptions={[
                "all",
                "steam",
                "heroic",
                "lutris",
                "desktop",
                "other"
              ].map((value) => ({
                data: value,
                label:
                  value === "all" ?
                    "All applications" :
                    value === "steam" ?
                      "Steam" :
                      value.charAt(0).toUpperCase() + value.slice(1)
              }))}
              onChange={(choice) => setKind(choice.data as string)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              layout="below"
              label="Sort"
              selectedOption={sort}
              rgOptions={[
                { data: "name", label: "Name" },
                { data: "recent", label: "Recently played on this Deck" }
              ]}
              onChange={(choice) => setSort(choice.data as string)}
            />
          </PanelSectionRow>
        </>
      )}
      <PanelSectionRow>
        <ActionButton
          disabled={busy}
          onClick={() => {
            void load(true);
          }}
        >
          Refresh Hosts & Games
        </ActionButton>
      </PanelSectionRow>
      {error && (
        <PanelSectionRow>
          <Field label="Could not complete action" description={error} />
        </PanelSectionRow>
      )}
      {message && <PanelSectionRow><Field label={message} /></PanelSectionRow>}
      {host && (
        <PanelSectionRow>
          <Field
            label={
              host.status === "paired" ?
                `${apps.length} applications · ${host.name}` :
                "Unable to read host applications"
            }
            description={
              host.status === "paired" ?
                "Available through Pyrolight. Launching uses the active Pyrolight profile." :
                  (host.error ??
                    `Host is ${host.status}. Check Hosts & Pairing in plugin settings.`)
            }
          />
        </PanelSectionRow>
      )}
      {apps.length > 8 && (
        <PanelSectionRow>
          <Field
            label={`Page ${page + 1} of ${Math.ceil(apps.length / 8)} · ${apps.length} games`}
            description="Search finds games across every page."
          />
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </ActionButton>
            <ActionButton
              disabled={(page + 1) * 8 >= apps.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </ActionButton>
          </div>
        </PanelSectionRow>
      )}
      {apps.slice(page * 8, (page + 1) * 8).map((app) => (
        <PanelSectionRow key={`${hostId}:${app.id}`}>
          <Focusable
            flow-children="row"
            role="group"
            aria-label={app.name}
            onSecondaryActionDescription="Game actions"
            onSecondaryButton={(event) => openActions(app, event.currentTarget!)}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              width: "100%"
            }}
          >
            <Artwork hostId={hostId} app={app} />
            <ActionButton
              style={{ flex: "1 1 0", textAlign: "left", padding: "10px 12px" }}
              disabled={busy || !(host?.status === "paired" || (host?.status === "unreachable" && host.validated && host.cached && host.canWake)) || (session.runnerActive && session.hostId === hostId && session.remoteAppId === app.id)}
              onClick={() => {
                setBusy(true);
                setError(null);
                void moonDeckAppLauncher
                  .launchRemote(hostId, app.id, app.name, steamSourceId(app))
                  .catch((problem: unknown) => setError(String(problem)))
                  .finally(() => { setBusy(false); void pyrolightIntegration.refreshSession(); });
              }}
            >
              <div title={app.name} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {app.name}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {appKind(app)}
                {" "}
                ·
                {" "}
                {session.hostId === hostId && session.remoteAppId === app.id && session.state !== "ended" ?
                    (session.runnerActive ? (session.state === "streaming" ? "Streaming" : session.state === "waking" ? "Waking host…" : "Connecting…") : "Resume Stream") :
                  "Stream game"}
              </div>
            </ActionButton>
            <ActionButton
              aria-label={`Actions for ${app.name}`}
              onOKActionDescription="Game actions"
              style={{ width: 40, flex: "0 0 40px", height: 44, padding: 0, display: "grid", placeItems: "center" }}
              disabled={busy}
              onClick={(event) => openActions(app, event.currentTarget!)}
            >
              <FaEllipsisH aria-hidden="true" size={16} />
            </ActionButton>
          </Focusable>
        </PanelSectionRow>
      ))}
      {host?.status === "paired" && apps.length === 0 && (
        <PanelSectionRow>
          <Field
            label="No matching applications"
            description="Only applications advertised by this host are shown. Try another search or check Pyroshine's library."
          />
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};
