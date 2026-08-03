import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MissionInspector } from "./components/MissionInspector";
import { ManagerDock } from "./components/ManagerDock";
import { ManagersPage } from "./components/ManagersPage";
import { MissionRelay } from "./components/MissionRelay";
import { PipelinesPage } from "./components/PipelineFlux";
import { PixelAvatar } from "./components/PixelAvatar";
import { TaskIntakeCard } from "./components/TaskIntakeCard";
import type { FolderBrowseResult, ManagerView, MissionIntakeDraft, MissionState, MissionView, PipelineListItem, ProviderOptionsCatalog } from "./types";
import { filterMissions } from "./services/mission-filters";
import { selectActiveSidebarMissions } from "./services/sidebar-missions";
import { createInitialDraft, loadMissionIntake, submitMissionIntake } from "./services/mission-intake-service";
import { loadServerConfig } from "./services/config-service";
import { appShellClassName, loadSidebarCollapsed, saveSidebarCollapsed } from "./services/sidebar-preference-service";
import { AppSidebar } from "./components/AppSidebar";
import type { AppPage } from "./components/AppSidebar";
import { ProviderSessionsPage } from "./components/ProviderSessionsPage";
import { listManagers } from "./services/manager-service";
import { listMissions } from "./services/mission-service";
import { loadSchedule, rescheduleToday, scheduledDay, todayKey, type MissionSchedule } from "./services/mission-schedule-service";
import { listPipelines } from "./services/pipeline-service";
import { probeProvider, selectDefaultModel } from "./services/provider-service";
import { browseFolders } from "./services/workspace-service";
import { loadViewMode, saveViewMode, type MissionViewMode } from "./services/view-mode-service";
import { loadSavedMissionFilters, saveMissionFilters } from "./services/mission-filter-service";
import { loadActivity, markActivityRead, type ActivityView } from "./services/activity-service";
import { dragActionId, findDragTransition } from "./services/mission-drag-transitions";
import { performMissionAction } from "./services/mission-action-service";
import { loadMissionResult } from "./services/mission-result-service";
import { advancePipelineRun, startPipeline } from "./services/pipeline-service";
import { buildPaletteCommands, type PaletteCommand } from "./services/palette-service";
import { applyTheme, initTheme, saveTheme, type Theme } from "./services/theme-service";
import { useSseRefresh } from "./hooks/useSseRefresh";
import { TABLET_BREAKPOINT, useMediaQuery } from "./hooks/use-media-query";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ActivityHub } from "./components/ActivityHub";
import { BoardEmptyState } from "./components/BoardEmptyState";
import { MISSION_TEMPLATES, templateDraft, type MissionTemplate } from "./services/mission-template-service";
import { createExamplePipeline } from "./services/pipeline-template-service";
import { dismissWelcomeBanner, loadWelcomeDismissed } from "./services/onboarding-service";

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

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function App() {
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [managers, setManagers] = useState<ManagerView[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOptionsCatalog | null>(null);
  const [draft, setDraft] = useState<MissionIntakeDraft | null>(null);
  const [savedFilters] = useState(() => loadSavedMissionFilters());
  const [query, setQuery] = useState(savedFilters.query);
  const [stateFilter, setStateFilter] = useState(savedFilters.state);
  const [kindFilter, setKindFilter] = useState(savedFilters.kind);
  const [sort, setSort] = useState(savedFilters.sort);
  const [viewMode, setViewMode] = useState<MissionViewMode>(() => loadViewMode());
  const [createExpanded, setCreateExpanded] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderBrowse, setFolderBrowse] = useState<FolderBrowseResult | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [probingProviderId, setProbingProviderId] = useState<string | null>(null);
  const [inspectedMissionId, setInspectedMissionId] = useState<string | null>(null);
  const [page, setPage] = useState<AppPage>(() => {
    const value = new URLSearchParams(location.search).get("page");
    return value === "pipelines" || value === "managers" || value === "provider-sessions" ? value : "tasks";
  });
  const [focusPipelineId, setFocusPipelineId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<MissionSchedule>(() => loadSchedule());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  const [theme, setTheme] = useState<Theme>(() => initTheme());
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteStatus, setPaletteStatus] = useState("");
  const [activity, setActivity] = useState<ActivityView | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [templateBusyId, setTemplateBusyId] = useState<string | null>(null);
  const [examplePipelineBusy, setExamplePipelineBusy] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState<boolean>(() => !loadWelcomeDismissed());

  // Responsive : en deçà du breakpoint tablette, le board bascule en liste (fallback)
  // et la sidebar devient un drawer piloté par `sidebarOpen`.
  const isNarrow = useMediaQuery(TABLET_BREAKPOINT);
  const effectiveViewMode: MissionViewMode = isNarrow ? "list" : viewMode;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // En passant au-dessus du breakpoint, le drawer n'a plus de sens : on le referme.
  useEffect(() => {
    if (!isNarrow) setSidebarOpen(false);
  }, [isNarrow]);

  // Raccourcis globaux : ⌘K / Ctrl+K ouvre la palette, « ? » ouvre l'aide, Esc ferme.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setHelpOpen(false);
        setPaletteStatus("");
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setHelpOpen(false);
        setPaletteOpen(false);
        setActivityOpen(false);
        setSidebarOpen(false);
        return;
      }
      if (event.key === "?" && !isTypingTarget(event.target)) {
        setPaletteOpen(false);
        setHelpOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void loadServerConfig().catch(() => undefined);
    void loadMissionIntake()
      .then((result) => {
        setMissions(result.missions);
        setProviderOptions(result.providerOptions);
        setDraft(result.draft);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refreshBoard = useCallback(() => {
    void listMissions().then((next) => { if (mountedRef.current) setMissions(next); }).catch(() => undefined);
    void listPipelines().then((next) => { if (mountedRef.current) setPipelines(next); }).catch(() => undefined);
    void listManagers().then((next) => { if (mountedRef.current) setManagers(next); }).catch(() => undefined);
    void loadActivity().then((next) => { if (mountedRef.current) setActivity(next); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshBoard();
    const onFocus = () => refreshBoard();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshBoard]);

  // Temps réel : le flux SSE remplace le polling toutes les 2 s.
  useSseRefresh(refreshBoard);

  const refreshPipelines = () => void listPipelines().then(setPipelines).catch(() => undefined);
  const refreshManagers = () => void listManagers().then(setManagers).catch(() => undefined);

  const moveMissionOnBoard = async (mission: MissionView, targetState: MissionState) => {
    const transition = findDragTransition(mission, targetState);
    if (!transition) throw new Error(`Transition vers ${targetState} interdite`);
    await performMissionAction({ actionId: dragActionId(transition), mission, latestRunId: null });
    setMissions(await listMissions());
  };

  useEffect(() => {
    const onPopState = () => {
      const value = new URLSearchParams(location.search).get("page");
      setPage(value === "pipelines" || value === "managers" || value === "provider-sessions" ? value : "tasks");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (next: AppPage) => {
    setSidebarOpen(false);
    const url = new URL(location.href);
    if (next === "tasks") url.searchParams.delete("page");
    else url.searchParams.set("page", next);
    if (next !== "provider-sessions") url.searchParams.delete("session");
    history.pushState({}, "", `${url.pathname}${url.search}`);
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openPipeline = (pipelineId: string) => {
    setFocusPipelineId(pipelineId);
    navigate("pipelines");
  };

  const activePipelineCount = useMemo(() => pipelines.filter((pipeline) => pipeline.runState === "active" || pipeline.runState === "blocked").length, [pipelines]);

  const overdueMissions = useMemo(() => {
    const today = todayKey();
    return missions.filter((mission) =>
      mission.state !== "DONE"
      && mission.state !== "ABANDONED"
      && scheduledDay(schedule, mission.id, mission.createdAt) < today
    );
  }, [missions, schedule]);

  const moveOverdueToToday = () => {
    setSchedule((current) => rescheduleToday(current, overdueMissions.map((mission) => mission.id)));
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      saveSidebarCollapsed(next);
      return next;
    });
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      saveTheme(next);
      applyTheme(next);
      return next;
    });
  };

  const changeViewMode = (mode: MissionViewMode) => {
    setViewMode(mode);
    saveViewMode(mode);
  };

  const missionPipelineIndex = useMemo(() => {
    const index = new Map<string, { pipelineId: string; pipelineName: string; nodeKey: string }>();
    for (const pipeline of pipelines) {
      for (const node of pipeline.nodes) {
        if (!index.has(node.missionId)) index.set(node.missionId, { pipelineId: pipeline.id, pipelineName: pipeline.name, nodeKey: node.nodeKey });
      }
    }
    return index;
  }, [pipelines]);

  const filtered = useMemo(
    () => filterMissions(missions, { query, state: stateFilter, kind: kindFilter, sort }),
    [missions, query, stateFilter, kindFilter, sort]
  );

  // Filtres sauvegardés : le board rouvre avec la même configuration.
  useEffect(() => {
    saveMissionFilters({ query, state: stateFilter, kind: kindFilter, sort });
  }, [query, stateFilter, kindFilter, sort]);
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

  // Onboarding : créer une mission en 1 clic depuis un modèle pré-rempli.
  const createMissionFromTemplate = async (template: MissionTemplate) => {
    if (!providerOptions) return;
    setTemplateBusyId(template.id);
    setError("");
    setNotice("");
    try {
      const mission = await submitMissionIntake(templateDraft(template, providerOptions), providerOptions);
      setDraft(createInitialDraft(providerOptions));
      setCreateExpanded(false);
      setNotice(`Mission créée depuis le modèle « ${template.label} » : ${mission.title}`);
      setMissions(await listMissions());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setTemplateBusyId(null);
    }
  };

  // Onboarding : pipeline d'exemple en 1 clic (2 missions enchaînées).
  const createExamplePipelineHandler = async () => {
    if (!providerOptions) return;
    setExamplePipelineBusy(true);
    setError("");
    setNotice("");
    try {
      const pipeline = await createExamplePipeline(providerOptions);
      refreshPipelines();
      setFocusPipelineId(pipeline.id);
      setNotice(`Pipeline d'exemple créé : ${pipeline.name}`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setExamplePipelineBusy(false);
    }
  };

  const activeSidebarMissions = useMemo(() => selectActiveSidebarMissions(missions), [missions]);

  const selectMission = (missionId: string) => {
    setInspectedMissionId(missionId);
    navigate("tasks");
  };

  const refreshActivity = useCallback(() => {
    void loadActivity().then((next) => { if (mountedRef.current) setActivity(next); }).catch(() => undefined);
  }, []);

  const markActivityItemRead = (relayId: string) => {
    void markActivityRead(relayId).catch(() => undefined).then(refreshActivity);
  };

  const markAllActivityRead = () => {
    const unread = activity?.items.filter((item) => item.state === "unread") ?? [];
    if (unread.length === 0) return;
    void Promise.all(unread.map((item) => markActivityRead(item.relayId).catch(() => undefined)))
      .then(refreshActivity);
  };

  const openMissionFromActivity = (missionId: string) => {
    setActivityOpen(false);
    selectMission(missionId);
  };

  const paletteCommands = useMemo(
    () => buildPaletteCommands({ page, missions, pipelines }),
    [page, missions, pipelines]
  );

  const runPaletteCommand = async (command: PaletteCommand) => {
    setPaletteStatus("");
    switch (command.action.kind) {
      case "navigate":
        navigate(command.action.page);
        setPaletteOpen(false);
        break;
      case "create-mission":
        setCreateExpanded(true);
        setPaletteOpen(false);
        requestAnimationFrame(() => {
          document.getElementById("create")?.scrollIntoView({ behavior: "smooth" });
          document.querySelector<HTMLInputElement>("#create input")?.focus();
        });
        break;
      case "start-pipeline": {
        const { pipelineId } = command.action;
        try {
          await startPipeline(pipelineId);
          refreshPipelines();
          const name = pipelines.find((pipeline) => pipeline.id === pipelineId)?.name ?? "pipeline";
          setPaletteStatus(`✓ Run démarré · ${name}`);
        } catch (reason) {
          setPaletteStatus(`✕ ${(reason as Error).message}`);
        }
        break;
      }
      case "advance-pipeline": {
        const { runId } = command.action;
        try {
          await advancePipelineRun(runId);
          refreshPipelines();
          setPaletteStatus("✓ Run avancé d'une étape");
        } catch (reason) {
          setPaletteStatus(`✕ ${(reason as Error).message}`);
        }
        break;
      }
      case "accept-delivery": {
        const { missionId } = command.action;
        const mission = missions.find((item) => item.id === missionId);
        if (!mission) return;
        try {
          const result = await loadMissionResult(mission.id);
          const actionId = result?.delivery ? "accept-result" : "validate";
          await performMissionAction({ actionId, mission, latestRunId: result?.latestRunId ?? null });
          setMissions(await listMissions());
          setPaletteStatus(`✓ Delivery acceptée · ${mission.title}`);
        } catch (reason) {
          setPaletteStatus(`✕ ${(reason as Error).message}`);
        }
        break;
      }
      case "open-mission": {
        const { missionId } = command.action;
        selectMission(missionId);
        setPaletteOpen(false);
        break;
      }
    }
  };

  return (
    <main className={`${appShellClassName(sidebarCollapsed)}${sidebarOpen ? " sidebar-open" : ""}`}>
      {isNarrow && (
        <button
          type="button"
          className="sidebar-burger"
          aria-label={sidebarOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar-nav"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <span aria-hidden="true">{sidebarOpen ? "×" : "☰"}</span>
        </button>
      )}
      {isNarrow && sidebarOpen && (
        <div className="sidebar-backdrop" aria-hidden="true" onClick={closeSidebar} />
      )}
      <AppSidebar
        page={page}
        collapsed={sidebarCollapsed}
        theme={theme}
        activePipelineCount={activePipelineCount}
        hasActiveManager={managers.some((manager) => manager.state === "active")}
        activityCount={activity?.unreadCount ?? 0}
        missions={activeSidebarMissions}
        query={query}
        onQueryChange={setQuery}
        onToggle={toggleSidebar}
        onNavigate={navigate}
        onSelectMission={selectMission}
        onOpenActivity={() => { setSidebarOpen(false); setActivityOpen((open) => !open); }}
        onThemeToggle={toggleTheme}
        onHelp={() => setHelpOpen((open) => !open)}
      />

      <section className="workspace">
        {page === "provider-sessions" ? (
          <ProviderSessionsPage
            missions={missions}
            initialSessionId={new URLSearchParams(location.search).get("session")}
            onSessionChange={(sessionId) => {
              const url = new URL(location.href);
              url.searchParams.set("session", sessionId);
              history.replaceState({}, "", `${url.pathname}${url.search}`);
            }}
            onOpenMission={(missionId) => {
              location.assign(`/agent.html?missionId=${encodeURIComponent(missionId)}`);
            }}
          />
        ) : page === "pipelines" ? (
          <>
            <header className="hero-row">
              <div>
                <p className="date-label">HANDOVER</p>
                <h1>Pipelines</h1>
                <p className="subtitle">Suis tes workflows multi-missions, étape par étape.</p>
              </div>
              <div className="focus-score">
                <span>{activePipelineCount}</span>
                <small>en cours</small>
              </div>
            </header>
            <PipelinesPage
              pipelines={pipelines}
              focusPipelineId={focusPipelineId}
              onInspect={setInspectedMissionId}
              onChanged={refreshPipelines}
              onCreateExample={() => void createExamplePipelineHandler()}
              exampleBusy={examplePipelineBusy}
              error={error}
            />
          </>
        ) : page === "managers" ? (
          <>
            <header className="hero-row">
              <div>
                <p className="date-label">THE GUILD DESK</p>
                <h1>Managers</h1>
                <p className="subtitle">Des agents méta qui orchestrent DevFlow à ta place.</p>
              </div>
              <div className="focus-score">
                <span>{managers.filter((manager) => manager.state !== "archived").length}</span>
                <small>managers</small>
              </div>
            </header>
            <ManagersPage managers={managers} providerOptions={providerOptions} onChanged={refreshManagers} />
          </>
        ) : (
          <>
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

            {welcomeVisible && (
              <div className="welcome-banner" role="status">
                <div className="welcome-banner-text">
                  <strong>👋 Bienvenue dans Nodra</strong>
                  <small>
                    Confie une mission à un agent, suis des pipelines, observe les conversations
                    des agents… Appuie sur « ? » pour découvrir les raccourcis.
                  </small>
                </div>
                <div className="welcome-banner-actions">
                  <button
                    type="button"
                    className="welcome-banner-cta"
                    onClick={() => { setCreateExpanded(true); document.getElementById("create")?.scrollIntoView({ behavior: "smooth" }); document.querySelector<HTMLInputElement>("#create input")?.focus(); }}
                  >
                    Confier une première mission →
                  </button>
                  <button
                    type="button"
                    className="welcome-banner-close"
                    aria-label="Masquer le message de bienvenue"
                    onClick={() => { setWelcomeVisible(false); dismissWelcomeBanner(); }}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            {overdueMissions.length > 0 && (
              <div className="overdue-banner" role="status">
                <div className="overdue-banner-text">
                  <strong>⏰ {overdueMissions.length} tâche{overdueMissions.length > 1 ? "s" : ""} en retard</strong>
                  <small>
                    Datent d'un jour précédent et ne sont pas terminées.
                    {overdueMissions.length <= 3 ? ` (${overdueMissions.map((mission) => mission.title).join(", ")})` : ""}
                  </small>
                </div>
                <button className="overdue-banner-button" onClick={moveOverdueToToday}>
                  Déplacer à aujourd'hui →
                </button>
              </div>
            )}

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
          onViewModeChange={changeViewMode}
          viewMode={viewMode}
          onFolderOpen={() => void openFolderBrowser(draft?.workspacePath || undefined)}
          onFolderClose={() => setFolderOpen(false)}
          onFolderBrowse={(path) => void openFolderBrowser(path)}
          onFolderSelect={(path) => {
            patchDraft({ workspacePath: path });
            setFolderOpen(false);
          }}
        />

        {effectiveViewMode === "board" ? (
          missions.length === 0 ? (
            <BoardEmptyState
              templates={MISSION_TEMPLATES}
              busyTemplateId={templateBusyId}
              onTemplate={(template) => void createMissionFromTemplate(template)}
              onCreateMission={() => { setCreateExpanded(true); document.getElementById("create")?.scrollIntoView({ behavior: "smooth" }); document.querySelector<HTMLInputElement>("#create input")?.focus(); }}
            />
          ) : (
            <MissionRelay
              missions={missions}
              missionPipelineIndex={missionPipelineIndex}
              kindFilter={kindFilter}
              stateFilter={stateFilter}
              onInspect={setInspectedMissionId}
              onOpenPipeline={openPipeline}
              onTransition={moveMissionOnBoard}
              onNewTask={() => { setCreateExpanded(true); document.getElementById("create")?.scrollIntoView({ behavior: "smooth" }); }}
            />
          )
        ) : (
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher par titre, id, notes, statut…" />
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
        )}
          </>
        )}

        {inspectedMissionId && (
          <MissionInspector
            missionId={inspectedMissionId}
            missions={missions}
            providerOptions={providerOptions}
            onClose={() => setInspectedMissionId(null)}
            onSaved={() => void listMissions().then(setMissions)}
          />
        )}

        <CommandPalette
          open={paletteOpen}
          commands={paletteCommands}
          status={paletteStatus}
          onClose={() => setPaletteOpen(false)}
          onSelect={(command) => void runPaletteCommand(command)}
        />

        <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

        <ActivityHub
          open={activityOpen}
          activity={activity}
          onClose={() => setActivityOpen(false)}
          onOpenMission={openMissionFromActivity}
          onOpenPipeline={(pipelineId) => {
            setActivityOpen(false);
            openPipeline(pipelineId);
          }}
          onMarkRead={markActivityItemRead}
          onMarkAllRead={markAllActivityRead}
        />

        <ManagerDock
          managers={managers}
          onManage={() => navigate("managers")}
          onOpen={() => navigate("managers")}
          onChanged={refreshManagers}
        />
      </section>
    </main>
  );
}
