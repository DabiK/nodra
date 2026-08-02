import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import type { MissionState, MissionView } from "../types";
import { hasMissionNotes } from "../services/mission-notes-service";
import { findDragTransition } from "../services/mission-drag-transitions";
import { PixelAvatar } from "./PixelAvatar";

const COLUMN_ORDER: MissionState[] = ["DRAFT", "BACKLOG", "READY", "ACTIVE", "BLOCKED", "VALIDATION", "DONE", "ABANDONED"];

interface ColumnDef {
  label: string;
  hint: string;
  tone: string;
  signal: string;
}

const COLUMN_LIBRARY: Record<MissionState, ColumnDef> = {
  DRAFT: { label: "Brouillons", hint: "En préparation.", tone: "draft", signal: "✎" },
  BACKLOG: { label: "Backlog", hint: "En attente de tri.", tone: "backlog", signal: "≡" },
  READY: { label: "Prêtes", hint: "Prêtes à lancer.", tone: "ready", signal: "☀" },
  ACTIVE: { label: "Ça bosse", hint: "Les agents au travail.", tone: "working", signal: "◆" },
  BLOCKED: { label: "Bloquées", hint: "Besoin de ton aide.", tone: "blocked", signal: "!" },
  VALIDATION: { label: "À valider", hint: "Attendent ta décision.", tone: "waiting", signal: "✓" },
  DONE: { label: "Terminées", hint: "Missions bouclées.", tone: "done", signal: "●" },
  ABANDONED: { label: "Abandonnées", hint: "Mises de côté.", tone: "abandoned", signal: "×" }
};

const DEFAULT_COLUMNS: MissionState[] = ["READY", "ACTIVE", "VALIDATION"];
const STORAGE_KEY = "nodra.board.columns";

function loadColumns(): MissionState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
    const valid = parsed.filter((value): value is MissionState => COLUMN_ORDER.includes(value as MissionState));
    return valid.length ? valid : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function cardHint(mission: MissionView): string {
  const isAgent = mission.executionKind === "agent";
  switch (mission.state) {
    case "READY": return isAgent ? "Prête à lancer" : "En attente de prise en charge";
    case "ACTIVE": return isAgent ? "Travaille maintenant" : "Prise en charge";
    case "VALIDATION": return "A rendu la main · attend ta décision";
    case "BLOCKED": return "Bloquée · attend ton aide";
    case "DRAFT": return "En configuration";
    case "DONE": return "Terminée";
    case "ABANDONED": return "Abandonnée";
    case "BACKLOG": return "Dans le backlog";
    default: return mission.state;
  }
}

function relativeTime(value: string): string {
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

function MissionCard({ mission, tone, pipeline, dragging, disabled, onInspect, onOpenPipeline, onDragStart, onDragEnd }: { mission: MissionView; tone: string; pipeline?: { id: string; name: string; hue: number }; dragging: boolean; disabled: boolean; onInspect(id: string): void; onOpenPipeline?(pipelineId: string): void; onDragStart(id: string): void; onDragEnd(): void }) {
  const style: CSSProperties = pipeline
    ? { borderLeft: `4px solid hsl(${pipeline.hue} 55% 55%)`, background: `hsl(${pipeline.hue} 68% 97%)` }
    : {};
  return (
    <button
      className={`relay-task ${tone}${pipeline ? " in-pipeline" : ""}${dragging ? " dragging" : ""}`}
      style={style}
      onClick={() => onInspect(mission.id)}
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", mission.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(mission.id);
      }}
      onDragEnd={onDragEnd}
      aria-label={`Ouvrir ${mission.title}`}
    >
      <PixelAvatar id={mission.id} title={mission.title} mini />
      <span className="relay-task-copy">
        <small><i /> {mission.executionKind === "agent" ? "Agent" : "Humain"} · {relativeTime(mission.updatedAt)}{hasMissionNotes(mission.id) ? " · 📝 notes" : ""}</small>
        <strong>{mission.title}</strong>
        <em>{cardHint(mission)}</em>
        {pipeline && (
          <span
            className="relay-task-pipeline"
            role="button"
            tabIndex={0}
            title={`Ouvrir la pipeline « ${pipeline.name} »`}
            style={{ color: `hsl(${pipeline.hue} 55% 40%)`, background: `hsl(${pipeline.hue} 60% 92%)` }}
            onClick={(event) => { event.stopPropagation(); onOpenPipeline?.(pipeline.id); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onOpenPipeline?.(pipeline.id); } }}
          >⌁ {pipeline.name} <b>↗</b></span>
        )}
      </span>
      <span className="relay-arrow" aria-hidden="true">→</span>
    </button>
  );
}

type PipelineIndex = Map<string, { pipelineId: string; pipelineName: string; nodeKey: string }>;

function pipelineHue(pipelineId: string): number {
  let hash = 0;
  for (let index = 0; index < pipelineId.length; index += 1) {
    hash = (hash * 31 + pipelineId.charCodeAt(index)) % 360;
  }
  return hash;
}

function pipelineGroupStyle(pipelineId: string): CSSProperties {
  const hue = pipelineHue(pipelineId);
  return {
    background: `hsl(${hue} 66% 93%)`,
    borderColor: `hsl(${hue} 50% 68%)`,
    ["--pipeline-accent" as string]: `hsl(${hue} 55% 40%)`
  };
}

function Lane({ state, missions, pipelineIndex, draggingId, transitioningId, getMission, onInspect, onOpenPipeline, onDragStart, onDragEnd, onTransition }: { state: MissionState; missions: MissionView[]; pipelineIndex?: PipelineIndex; draggingId: string | null; transitioningId: string | null; getMission(id: string): MissionView | undefined; onInspect(id: string): void; onOpenPipeline?(pipelineId: string): void; onDragStart(id: string): void; onDragEnd(): void; onTransition(mission: MissionView, targetState: MissionState): void }) {
  const column = COLUMN_LIBRARY[state];
  const [dropState, setDropState] = useState<"idle" | "allowed" | "forbidden">("idle");
  const items = missions
    .filter((mission) => mission.state === state)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  const groups = new Map<string, { name: string; missions: MissionView[] }>();
  const standalone: MissionView[] = [];
  for (const mission of items) {
    const info = pipelineIndex?.get(mission.id);
    if (info) {
      const group = groups.get(info.pipelineId) ?? { name: info.pipelineName, missions: [] };
      group.missions.push(mission);
      groups.set(info.pipelineId, group);
    } else {
      standalone.push(mission);
    }
  }
  const visibleStandalone = standalone.slice(0, 12);

  const draggedMission = draggingId ? getMission(draggingId) : null;
  const dropAllowed = draggedMission ? findDragTransition(draggedMission, state) !== null : false;

  const handleDragOver = (event: DragEvent) => {
    if (!draggedMission) return;
    if (dropAllowed) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropState("allowed");
    } else {
      setDropState("forbidden");
    }
  };
  const handleDragLeave = () => setDropState("idle");
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropState("idle");
    if (!draggedMission || !dropAllowed) return;
    onTransition(draggedMission, state);
  };

  return (
    <section
      className={`relay-lane ${column.tone}${dropState === "allowed" ? " drop-allowed" : ""}${dropState === "forbidden" ? " drop-forbidden" : ""}`}
      aria-label={column.label}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header>
        <span className="relay-signal" aria-hidden="true">{state === "ACTIVE" ? <i /> : column.signal}</span>
        <div>
          <h3>{column.label}</h3>
          <p>{column.hint}</p>
        </div>
        <b>{items.length}</b>
      </header>
      <div className="relay-list">
        {!items.length && <p className="relay-empty"><span aria-hidden="true">·</span>Rien ici pour l'instant.</p>}
        {[...groups.entries()].map(([pipelineId, group]) => (
          <div className="relay-pipeline-group" key={pipelineId} style={pipelineGroupStyle(pipelineId)}>
            <span className="relay-pipeline-tag"><i aria-hidden="true">⌁</i>{group.name}<b>{group.missions.length}</b></span>
            {group.missions.map((mission) => <MissionCard key={mission.id} mission={mission} tone={column.tone} pipeline={{ id: pipelineId, name: group.name, hue: pipelineHue(pipelineId) }} dragging={draggingId === mission.id} disabled={transitioningId === mission.id} onInspect={onInspect} onOpenPipeline={onOpenPipeline} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}
          </div>
        ))}
        {visibleStandalone.map((mission) => <MissionCard key={mission.id} mission={mission} tone={column.tone} dragging={draggingId === mission.id} disabled={transitioningId === mission.id} onInspect={onInspect} onOpenPipeline={onOpenPipeline} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}
      </div>
      {standalone.length > visibleStandalone.length && <p className="relay-overflow">+ {standalone.length - visibleStandalone.length} autre(s)</p>}
    </section>
  );
}

export function MissionRelay({ missions, missionPipelineIndex, kindFilter, stateFilter, onInspect, onOpenPipeline, onNewTask, onTransition }: { missions: MissionView[]; missionPipelineIndex?: PipelineIndex; kindFilter?: string; stateFilter?: string; onInspect(id: string): void; onOpenPipeline?(pipelineId: string): void; onNewTask?(): void; onTransition?(mission: MissionView, targetState: MissionState): Promise<void> | void }) {
  const [columns, setColumns] = useState<MissionState[]>(loadColumns);
  const [configOpen, setConfigOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState("");

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(columns)); } catch { /* ignore */ }
  }, [columns]);

  const orderedColumns = useMemo(
    () => COLUMN_ORDER.filter((state) => columns.includes(state)),
    [columns]
  );
  const visibleColumns = useMemo(
    () => (stateFilter && stateFilter !== "all" && COLUMN_ORDER.includes(stateFilter as MissionState)
      ? [stateFilter as MissionState]
      : orderedColumns),
    [stateFilter, orderedColumns]
  );
  const filteredMissions = useMemo(
    () => kindFilter && kindFilter !== "all"
      ? missions.filter((mission) => mission.executionKind === kindFilter)
      : missions,
    [missions, kindFilter]
  );
  const inFlux = useMemo(
    () => filteredMissions.filter((mission) => visibleColumns.includes(mission.state)).length,
    [filteredMissions, visibleColumns]
  );
  const getMission = (missionId: string) => filteredMissions.find((mission) => mission.id === missionId);

  const toggleColumn = (state: MissionState) => {
    setColumns((current) => current.includes(state) ? current.filter((value) => value !== state) : [...current, state]);
  };

  const handleTransition = async (mission: MissionView, targetState: MissionState) => {
    if (!onTransition) return;
    setTransitioningId(mission.id);
    setTransitionError("");
    setDraggingId(null);
    try {
      await onTransition(mission, targetState);
    } catch (reason) {
      setTransitionError((reason as Error).message);
    } finally {
      setTransitioningId(null);
    }
  };

  return (
    <section className="task-relay" aria-labelledby="relayTitle">
      <header className="relay-head">
        <div>
          <span className="eyebrow">EN DIRECT</span>
          <h2 id="relayTitle">{inFlux ? `${inFlux} mission${inFlux > 1 ? "s" : ""} dans le flux` : "Le flux est calme"}</h2>
        </div>
        <div className="relay-head-actions">
          <button type="button" className={`relay-config-button${configOpen ? " active" : ""}`} onClick={() => setConfigOpen((open) => !open)} aria-expanded={configOpen}>
            ⚙ Colonnes <span>{visibleColumns.length}</span>
          </button>
          {onNewTask && <button type="button" className="relay-new-task-button" onClick={onNewTask}>+ Confier une tâche</button>}
        </div>
      </header>

      {transitionError && (
        <p className="relay-error" role="alert">⚠ {transitionError}</p>
      )}

      {configOpen && (
        <div className="relay-config" role="group" aria-label="Choisir les colonnes du flux">
          {COLUMN_ORDER.map((state) => {
            const active = columns.includes(state);
            const count = filteredMissions.filter((mission) => mission.state === state).length;
            return (
              <button
                key={state}
                type="button"
                className={`relay-config-chip ${COLUMN_LIBRARY[state].tone}${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => toggleColumn(state)}
              >
                <i aria-hidden="true">{active ? "✓" : "+"}</i>
                {COLUMN_LIBRARY[state].label}
                <b>{count}</b>
              </button>
            );
          })}
        </div>
      )}

      <div className="relay-lanes" style={{ ["--relay-columns" as string]: String(visibleColumns.length || 1) }}>
        {visibleColumns.length
          ? visibleColumns.map((state) => <Lane key={state} state={state} missions={filteredMissions} pipelineIndex={missionPipelineIndex} draggingId={draggingId} transitioningId={transitioningId} getMission={getMission} onInspect={onInspect} onOpenPipeline={onOpenPipeline} onDragStart={setDraggingId} onDragEnd={() => setDraggingId(null)} onTransition={(mission, target) => void handleTransition(mission, target)} />)
          : <p className="relay-empty board-empty"><span aria-hidden="true">·</span>Aucune colonne sélectionnée. Ajoute un état via ⚙ Colonnes.</p>}
      </div>
    </section>
  );
}
