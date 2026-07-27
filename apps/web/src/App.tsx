import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MissionInspector } from "./components/MissionInspector";
import { MissionRelay } from "./components/MissionRelay";
import { PixelAvatar } from "./components/PixelAvatar";
import { TaskIntakeCard } from "./components/TaskIntakeCard";
import type { FolderBrowseResult, MissionIntakeDraft, MissionState, MissionView, ProviderOptionsCatalog } from "./types";
import { filterMissions } from "./services/mission-filters";
import { createInitialDraft, loadMissionIntake, submitMissionIntake } from "./services/mission-intake-service";
import { listMissions } from "./services/mission-service";
import { probeProvider, selectDefaultModel } from "./services/provider-service";
import { browseFolders } from "./services/workspace-service";

const missionStates: MissionState[] = ["BACKLOG", "READY", "ACTIVE", "BLOCKED", "VALIDATION", "DONE", "ABANDONED"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function updateDraft(draft: MissionIntakeDraft, patch: Partial<MissionIntakeDraft>) {
  return { ...draft, ...patch };
}

export function App() {
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOptionsCatalog | null>(null);
  const [draft, setDraft] = useState<MissionIntakeDraft | null>(null);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [createExpanded, setCreateExpanded] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderBrowse, setFolderBrowse] = useState<FolderBrowseResult | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [probingProviderId, setProbingProviderId] = useState<string | null>(null);
  const [inspectedMissionId, setInspectedMissionId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadMissionIntake()
      .then((result) => {
        setMissions(result.missions);
        setProviderOptions(result.providerOptions);
        setDraft(result.draft);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => void listMissions().then((next) => { if (!cancelled) setMissions(next); }).catch(() => undefined);
    const timer = window.setInterval(tick, 2000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);

  const filtered = useMemo(
    () => filterMissions(missions, { query, state: stateFilter, kind: kindFilter, sort }),
    [missions, query, stateFilter, kindFilter, sort]
  );
  const stateCounts = useMemo(
    () => missions.reduce<Partial<Record<MissionState, number>>>((counts, mission) => {
      counts[mission.state] = (counts[mission.state] ?? 0) + 1;
      return counts;
    }, {}),
    [missions]
  );
  const missionGroups = useMemo(() => {
    const groups = filtered.reduce<Record<string, MissionView[]>>((accumulator, mission) => {
      const key = stateFilter === "all" ? mission.state : mission.executionKind;
      accumulator[key] = [...(accumulator[key] ?? []), mission];
      return accumulator;
    }, {});
    return Object.entries(groups);
  }, [filtered, stateFilter]);

  const selectedProvider = providerOptions?.providers.find((item) => item.id === draft?.providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.id === draft?.modelId);
  const reasoningOptions = selectedModel?.supportedReasoningEfforts.length
    ? selectedModel.supportedReasoningEfforts
    : providerOptions?.reasoningEfforts ?? [];

  const setProvider = (providerId: string) => {
    if (!draft || !providerOptions) return;
    const modelId = selectDefaultModel(providerOptions, providerId);
    const model = providerOptions.providers.find((item) => item.id === providerId)?.models.find((item) => item.id === modelId);
    setDraft(updateDraft(draft, {
      providerId,
      modelId,
      reasoningEffort: model?.defaultReasoningEffort ?? providerOptions.defaults.reasoningEffort
    }));
  };

  const patchDraft = (patch: Partial<MissionIntakeDraft>) => {
    setDraft((current) => current ? updateDraft(current, patch) : current);
  };

  const refreshProviderOptions = async (providerId: string) => {
    setProbingProviderId(providerId);
    setError("");
    try {
      const next = await probeProvider(providerId);
      setProviderOptions(next);
      setDraft((current) => current ? updateDraft(current, {
        providerId,
        modelId: selectDefaultModel(next, providerId)
      }) : createInitialDraft(next));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setProbingProviderId(null);
    }
  };

  const openFolderBrowser = async (path?: string) => {
    setFolderOpen(true);
    setFolderLoading(true);
    setError("");
    try {
      setFolderBrowse(await browseFolders(path));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setFolderLoading(false);
    }
  };

  const createMission = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    if (draft.kind !== "human" && !providerOptions) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const mission = await submitMissionIntake(draft, providerOptions!);
      setDraft(providerOptions ? createInitialDraft(providerOptions) : { ...draft, title: "", prompt: "" });
      setCreateExpanded(false);
      setNotice(`Mission créée : ${mission.title}`);
      setMissions(await listMissions());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Navigation">
        <div className="brand">
          <span>N</span>
          <div>
            <strong>Nodra</strong>
            <small>Mission control</small>
          </div>
        </div>
        <nav>
          <a className="active" href="#create">Créer</a>
          <a href="#missions">Missions</a>
          <a href="#providers">Providers</a>
          <a href="#pipelines">Pipelines</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="hero-row">
          <div>
            <p className="date-label">TASK INTAKE</p>
            <h1>Mes tâches</h1>
            <p className="subtitle">Capture, configure et fais avancer ce qui compte.</p>
          </div>
          <div className="focus-score">
            <span>{missions.filter((mission) => mission.state !== "DONE" && mission.state !== "ABANDONED").length}</span>
            <small>missions ouvertes</small>
          </div>
        </header>

        <TaskIntakeCard
          draft={draft}
          providerOptions={providerOptions}
          selectedProvider={selectedProvider}
          selectedModelId={draft?.modelId ?? providerOptions?.defaults.modelId ?? "default"}
          reasoningOptions={reasoningOptions}
          expanded={createExpanded}
          creating={creating}
          probingProviderId={probingProviderId}
          folderOpen={folderOpen}
          folderBrowse={folderBrowse}
          folderLoading={folderLoading}
          error={error}
          notice={notice}
          missionCount={missions.length}
          stateCounts={stateCounts}
          stateFilter={stateFilter}
          kindFilter={kindFilter}
          onSubmit={createMission}
          onDraftChange={patchDraft}
          onExpandedChange={setCreateExpanded}
          onProviderChange={setProvider}
          onProbeProvider={(providerId) => void refreshProviderOptions(providerId)}
          onStateFilterChange={setStateFilter}
          onKindFilterChange={setKindFilter}
          onFolderOpen={() => void openFolderBrowser(draft?.workspacePath || undefined)}
          onFolderClose={() => setFolderOpen(false)}
          onFolderBrowse={(path) => void openFolderBrowser(path)}
          onFolderSelect={(path) => {
            patchDraft({ workspacePath: path });
            setFolderOpen(false);
          }}
        />

        <MissionRelay
          missions={missions}
          onInspect={setInspectedMissionId}
          onNewTask={() => { setCreateExpanded(true); document.getElementById("create")?.scrollIntoView({ behavior: "smooth" }); }}
        />

        <section className="panel missions-panel" id="missions">
          <div className="panel-head">
            <div>
              <span className="eyebrow">RECHERCHE</span>
              <h2>Missions existantes</h2>
            </div>
            <span className="count">{filtered.length} résultat{filtered.length > 1 ? "s" : ""}</span>
          </div>

          <div className="filter-row">
            <span className="filter-context">Missions</span>
            <span className="filter-context">{stateFilter === "all" ? "Tous statuts" : stateFilter}</span>
            <span className="task-total">{filtered.length} mission{filtered.length > 1 ? "s" : ""}</span>
          </div>

          <div className="filters">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher par titre ou id" />
            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
              <option value="all">Tous les états</option>
              {missionStates.map((state) => <option value={state} key={state}>{state}</option>)}
            </select>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">Human + agent</option>
              <option value="agent">Agent</option>
              <option value="human">Humain</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="recent">Récent</option>
              <option value="title">Titre</option>
              <option value="state">État</option>
            </select>
          </div>

          <div className="mission-list task-list">
            {missionGroups.map(([group, groupMissions]) => (
              <section className="task-folder-group" aria-label={`Dossier ${group}`} key={group}>
                <header>
                  <span aria-hidden="true">▰</span>
                  <strong>{stateFilter === "all" ? group : `#${group}`}</strong>
                  <small>{groupMissions.length}</small>
                </header>
                {groupMissions.map((mission) => (
                  <article className="mission-row" key={mission.id} onClick={() => setInspectedMissionId(mission.id)}>
                    <PixelAvatar id={mission.id} title={mission.title} mini />
                    <div>
                      <strong>{mission.title}</strong>
                      <small>{mission.id}</small>
                    </div>
                    <span className={`state state-${mission.state.toLowerCase()}`}>{mission.state}</span>
                    <span>{mission.executionKind}</span>
                    <time>{formatDate(mission.updatedAt)}</time>
                  </article>
                ))}
              </section>
            ))}
            {!filtered.length && <p className="empty">Aucune mission ne correspond aux filtres.</p>}
          </div>
        </section>

        {inspectedMissionId && (
          <MissionInspector
            missionId={inspectedMissionId}
            missions={missions}
            providerOptions={providerOptions}
            onClose={() => setInspectedMissionId(null)}
            onSaved={() => void listMissions().then(setMissions)}
          />
        )}
      </section>
    </main>
  );
}
