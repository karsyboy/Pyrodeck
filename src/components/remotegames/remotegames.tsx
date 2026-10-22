import { ButtonItem, DropdownItem, Field, Focusable, PanelSection, PanelSectionRow, TextField } from "@decky/ui";
import { Catalog, RemoteApp, appKind, pyrolightIntegration, steamArtwork } from "../../lib/pyrolightintegration";
import { FC, useContext, useEffect, useState } from "react";
import { MoonDeckContext } from "../../contexts";
import { call } from "@decky/api";

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
          style={{ width: 84, height: 112, objectFit: "cover", borderRadius: 4 }}
          onError={() => setImage(undefined)}
        />
      ) :
      (
        <div
          aria-hidden="true"
          style={{
            width: 84,
            height: 112,
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
  const { moonDeckAppLauncher } = useContext(MoonDeckContext);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [hostId, setHostId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState("name");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (refresh = false): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await pyrolightIntegration.catalog(refresh);
      setCatalog(result);
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
  const apps = (host?.apps ?? [])
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
    );
  useEffect(() => {
    setPage(0);
  }, [hostId, query, kind, sort]);
  return (
    <PanelSection title="Remote Games" spinner={busy}>
      <PanelSectionRow>
        <DropdownItem
          label="Host"
          disabled={busy}
          selectedOption={hostId}
          rgOptions={[
            { data: "", label: "Choose a host" },
            ...(catalog?.hosts ?? []).map((entry) => ({
              data: entry.id,
              label: `${entry.name} · ${entry.status}`
            }))
          ]}
          onChange={(choice) => setHostId(choice.data as string)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Search applications"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DropdownItem
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
            label: value === "all" ? "All applications" : value
          }))}
          onChange={(choice) => setKind(choice.data as string)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DropdownItem
          label="Sort"
          selectedOption={sort}
          rgOptions={[
            { data: "name", label: "Name" },
            { data: "recent", label: "Recently played on this Deck" }
          ]}
          onChange={(choice) => setSort(choice.data as string)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          disabled={busy}
          onClick={() => {
            void load(true);
          }}
        >
          Refresh Hosts & Games
        </ButtonItem>
      </PanelSectionRow>
      {error && (
        <PanelSectionRow>
          <Field label="Could not load games" description={error} />
        </PanelSectionRow>
      )}
      {host && (
        <PanelSectionRow>
          <Field
            label={`${apps.length} applications · ${host.name}`}
            description={
              host.status === "paired" ?
                "Available through Pyrolight. Launching uses the active Pyrolight profile." :
                  (host.error ??
                    `Host is ${host.status}. Check pairing in Host Selection.`)
            }
          />
        </PanelSectionRow>
      )}
      {apps.slice(page * 8, (page + 1) * 8).map((app) => (
        <PanelSectionRow key={`${hostId}:${app.id}`}>
          <Focusable
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              width: "100%"
            }}
          >
            <Artwork hostId={hostId} app={app} />
            <ButtonItem
              layout="below"
              disabled={busy || host?.status !== "paired"}
              description={`${appKind(app)} · Available`}
              onClick={() => {
                setBusy(true);
                setError(null);
                void moonDeckAppLauncher
                  .launchRemote(hostId, app.id, app.name)
                  .catch((problem: unknown) => setError(String(problem)))
                  .finally(() => setBusy(false));
              }}
            >
              {app.name}
            </ButtonItem>
          </Focusable>
        </PanelSectionRow>
      ))}
      {page > 0 && (
        <PanelSectionRow>
          <ButtonItem onClick={() => setPage(page - 1)}>
            Previous Games
          </ButtonItem>
        </PanelSectionRow>
      )}
      {(page + 1) * 8 < apps.length && (
        <PanelSectionRow>
          <ButtonItem onClick={() => setPage(page + 1)}>More Games</ButtonItem>
        </PanelSectionRow>
      )}
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
