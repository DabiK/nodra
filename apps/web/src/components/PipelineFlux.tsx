import { useEffect, useMemo, useState } from "react";
import type { PipelineListItem, PipelineListNode } from "../types";
import type { PipelineViewMode } from "../services/pipeline-timeline-service";
import { advancePipelineRun, approveNodeTransition, publishNodeHandover, setNodeTransitionMode, startPipeline } from "../services/pipeline-service";
import {
  formatDuration,
  loadPipelineViewMode,
  nodeDurationMs,
  pipelineTotalDurationMs,
  runTimeRange,
  savePipelineViewMode,
  sortTimelineNodes
} from "../services/pipeline-timeline-service";
import { formatCostMicros } from "../services/budget-service";
import { TABLET_BREAKPOINT, useMediaQuery } from "../hooks/use-media-query";
import { deletePipelineFavorite, loadPipelineFavorites, renamePipelineFavorite, type PipelineFavorite } from "../services/pipeline-favorites-service";

const RUN_STATE_LABEL: Record<string, string> = {
  queued: "en file", active: "en cours", blocked: "à débloquer", completed: "terminé", failed: "échec", cancelled: "annulé", archived: "archivé"
};

const COLUMN_WIDTH = 250;
const ROW_HEIGHT = 150;
const NODE_WIDTH = 210;
const HALF_HEIGHT = 46;

interface GraphLayout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

function computeLevels(nodes: PipelineListNode[], edges: PipelineListItem["edges"]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.nodeKey, []);
  for (const edge of edges) incoming.get(edge.toNodeKey)?.push(edge.fromNodeKey);
  const memo = new Map<string, number>();
  const level = (key: string, seen: Set<string>): number => {
    if (memo.has(key)) return memo.get(key)!;
    if (seen.has(key)) return 0;
    seen.add(key);
    const parents = incoming.get(key) ?? [];
    const result = parents.length ? 1 + Math.max(...parents.map((parent) => level(parent, seen))) : 0;
    memo.set(key, result);
    return result;
  };
  return new Map(nodes.map((node) => [node.nodeKey, level(node.nodeKey, new Set())]));
}

function computeGraph(nodes: PipelineListNode[], edges: PipelineListItem["edges"]): GraphLayout {
  const levels = computeLevels(nodes, edges);
  const columns = new Map<number, PipelineListNode[]>();
  for (const node of nodes) {
    const column = levels.get(node.nodeKey) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [column, columnNodes] of columns) {
    columnNodes.forEach((node, row) => positions.set(node.nodeKey, { x: 20 + column * COLUMN_WIDTH, y: 18 + row * ROW_HEIGHT }));
  }
  const maxLevel = Math.max(0, ...levels.values());
  const maxRows = Math.max(1, ...[...columns.values()].map((items) => items.length));
  return {
    positions,
    width: Math.max(560, 45 + (maxLevel + 1) * COLUMN_WIDTH),
    height: Math.max(140, 40 + maxRows * ROW_HEIGHT)
  };
}

function nodeStatus(node: PipelineListNode): { stateClass: string; label: string } {
  const state = node.nodeRunState;
  if (state === "completed") return { stateClass: "succeeded", label: "✓ DONE" };
  if (state === "active") return { stateClass: "running", label: "● LIVE" };
  if (state === "ready") return { stateClass: "ready", label: "▶ READY" };
  if (state === "failed") return { stateClass: "failed", label: "✕ ÉCHEC" };
  if (state === "blocked") return { stateClass: "blocked", label: "◇ BLOQUÉ" };
  if (state === "skipped") return { stateClass: "skipped", label: "↷ IGNORÉ" };
  if (state === "pending") return { stateClass: "waiting", label: node.transitionMode === "human" ? "◇ FEU VERT" : "○ WAIT" };
  // No run yet → reflect mission state.
  if (node.missionState === "DONE") return { stateClass: "succeeded", label: "✓ DONE" };
  if (node.missionState === "ACTIVE") return { stateClass: "running", label: "● LIVE" };
  if (node.missionState === "VALIDATION") return { stateClass: "decision", label: "◇ À VALIDER" };
  if (node.missionState === "BLOCKED") return { stateClass: "blocked", label: "◇ BLOQUÉ" };
  if (node.missionState === "ABANDONED") return { stateClass: "failed", label: "✕ ABANDON" };
  if (node.missionState === "READY") return { stateClass: "ready", label: "▶ READY" };
  return { stateClass: "waiting", label: "○ WAIT" };
}

function pipelineStatus(pipeline: PipelineListItem): { tone: string; text: string } {
  if (!pipeline.runId) return { tone: "idle", text: "Non démarré · lance le pipeline pour exécuter la première étape." };
  if (pipeline.runState === "completed") return { tone: "done", text: "Pipeline terminé · toutes les étapes sont validées." };
  if (pipeline.runState === "failed") return { tone: "blocked", text: "Pipeline en échec · une étape a échoué, inspecte la fiche de mission." };
  if (pipeline.runState === "cancelled") return { tone: "blocked", text: "Pipeline annulé." };

  const validation = pipeline.nodes.find((node) => node.nodeRunState === "active" && node.missionState === "VALIDATION");
  if (validation) return { tone: "waiting", text: `L'étape « ${validation.nodeKey} » attend ta validation · ouvre sa fiche, accepte, puis « Avancer ».` };
  const humanGate = pipeline.nodes.find((node) => node.nodeRunState === "pending" && node.transitionMode === "human");
  if (pipeline.runState === "blocked" && humanGate) return { tone: "waiting", text: `Transition manuelle requise sur « ${humanGate.nodeKey} » · clique « Approuver » pour lancer cette étape.` };
  const running = pipeline.nodes.find((node) => node.nodeRunState === "active");
  if (running) return { tone: "working", text: `L'agent « ${running.nodeKey} » travaille… la validation apparaîtra ici quand il aura fini.` };
  const ready = pipeline.nodes.find((node) => node.nodeRunState === "ready");
  if (ready) return { tone: "ready", text: `L'étape « ${ready.nodeKey} » est prête · clique « Avancer » pour la démarrer.` };
  return { tone: "idle", text: "En attente…" };
}

function PipelineTimeline({ pipeline, onInspect }: { pipeline: PipelineListItem; onInspect(missionId: string): void }) {
  const rows = useMemo(() => sortTimelineNodes(pipeline.nodes), [pipeline.nodes]);
  const totalDuration = pipelineTotalDurationMs(pipeline);
  const totalCost = formatCostMicros(pipeline.totalCostMicros);
  const executed = pipeline.nodes.filter((node) => node.runStartedAt !== null || node.nodeRunState === "completed").length;

  return (
    <div className="pipeline-timeline" aria-label={`Timeline chronologique de ${pipeline.name}`}>
      {rows.length === 0 ? (
        <p className="pipeline-empty-page">Aucune étape dans ce pipeline.</p>
      ) : (
        <ol className="timeline-rows">
          {rows.map((node) => {
            const status = nodeStatus(node);
            const duration = nodeDurationMs(node);
            const range = runTimeRange(node);
            const cost = formatCostMicros(node.runCostMicros);
            const needsApproval = Boolean(pipeline.runId) && node.nodeRunState === "pending" && node.transitionMode === "human";
            return (
              <li key={node.nodeKey} className={`timeline-row ${status.stateClass}${needsApproval ? " gate-waiting" : ""}`}>
                <span className="timeline-rail" aria-hidden="true" />
                <span className={`timeline-badge ${status.stateClass}`}>{status.label}</span>
                <div className="timeline-row-body">
                  <div className="timeline-row-title">
                    <button type="button" className="node-title" onClick={() => onInspect(node.missionId)} title={node.missionTitle}>{node.missionTitle}</button>
                    {node.transitionMode === "human" && (
                      <span className={`node-gate ${needsApproval ? "waiting" : "clear"}`}>{needsApproval ? "◇ FEU VERT REQUIS" : "✋ TRANSITION MANUELLE"}</span>
                    )}
                    {node.runAttempt !== null && node.runAttempt > 1 && (
                      <span className="timeline-attempt" title={`Tentative n°${node.runAttempt}`}>essai {node.runAttempt}</span>
                    )}
                  </div>
                  <div className="timeline-row-meta">
                    <span>{node.nodeKey} · {node.missionKind === "agent" ? "Agent" : "Humain"}</span>
                    {range && <time>{range}</time>}
                    <span className={`timeline-duration${duration === null ? " empty" : ""}`}>{formatDuration(duration)}</span>
                    {cost !== null && <span className="timeline-cost" title={`Coût du run de ${node.missionTitle}`}>{cost}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <footer className="timeline-summary">
        <span>{executed}/{pipeline.nodes.length} étape{pipeline.nodes.length > 1 ? "s" : ""} exécutée{executed > 1 ? "s" : ""}</span>
        {totalDuration !== null && <span>Durée totale : <b>{formatDuration(totalDuration)}</b></span>}
        {totalCost !== null && <span>Coût total : <b>{totalCost}</b></span>}
        {pipeline.startedAt && <time>Début du run : {new Date(pipeline.startedAt).toLocaleString()}</time>}
        {pipeline.endedAt && <time>Fin du run : {new Date(pipeline.endedAt).toLocaleString()}</time>}
      </footer>
    </div>
  );
}

function PipelineCard({ pipeline, view, onViewChange, onInspect, onChanged, onSaveFavorite, favoriteBusy }: { pipeline: PipelineListItem; view: PipelineViewMode; onViewChange(mode: PipelineViewMode): void; onInspect(missionId: string): void; onChanged(): void; onSaveFavorite(pipeline: PipelineListItem): void; favoriteBusy: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const graph = useMemo(() => computeGraph(pipeline.nodes, pipeline.edges), [pipeline.nodes, pipeline.edges]);
  // Responsive : sous le breakpoint tablette, le graph SVG (largeur minimum 560px)
  // bascule sur la timeline chronologique — le choix explicite reste persisté.
  const isNarrow = useMediaQuery(TABLET_BREAKPOINT);
  const effectiveView: PipelineViewMode = isNarrow ? "timeline" : view;
  const completed = pipeline.nodes.filter((node) => node.nodeRunState === "completed" || (!pipeline.runId && node.missionState === "DONE")).length;
  const total = pipeline.nodes.length;
  const started = Boolean(pipeline.runId);
  const canStart = !started || pipeline.runState === "completed" || pipeline.runState === "cancelled" || pipeline.runState === "failed";
  const canAdvance = started && (pipeline.runState === "active" || pipeline.runState === "blocked");

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try { await action(); onChanged(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <article className={`workflow-card ${pipeline.runState ?? pipeline.state}`}>
      <div className="workflow-head">
        <span className="pipeline-mark" aria-hidden="true">⌁</span>
        <div className="workflow-head-title">
          <span className="eyebrow">HANDOVER GRAPH</span>
          <strong>{pipeline.name}</strong>
          <small>{total} étape{total > 1 ? "s" : ""} · {completed}/{total} terminée{completed > 1 ? "s" : ""}{pipeline.runState ? ` · ${RUN_STATE_LABEL[pipeline.runState] ?? pipeline.runState}` : " · non démarré"}</small>
        </div>
        <div className="workflow-head-actions">
          <div className="pipeline-view-toggle" role="group" aria-label="Vue du pipeline">
            <button type="button" className={view === "graph" ? "active" : ""} aria-pressed={view === "graph"} onClick={() => onViewChange("graph")}>Graph</button>
            <button type="button" className={view === "timeline" ? "active" : ""} aria-pressed={view === "timeline"} onClick={() => onViewChange("timeline")}>Timeline</button>
          </div>
          <button type="button" className="pipeline-action" disabled={favoriteBusy || busy !== null} onClick={() => onSaveFavorite(pipeline)}>{favoriteBusy ? "Enregistrement…" : "☆ Enregistrer comme modèle"}</button>
          {canStart && <button type="button" className="pipeline-action primary" disabled={busy !== null} onClick={() => void run("start", () => startPipeline(pipeline.id))}>{busy === "start" ? "…" : started ? "Relancer →" : "Démarrer →"}</button>}
          {canAdvance && <button type="button" className="pipeline-action" disabled={busy !== null} onClick={() => void run("advance", () => advancePipelineRun(pipeline.runId!))}>{busy === "advance" ? "…" : "↻ Avancer"}</button>}
        </div>
      </div>

      <span className="pipeline-progress" aria-hidden="true"><i style={{ width: `${total ? (completed / total) * 100 : 0}%` }} /></span>

      {(() => { const status = pipelineStatus(pipeline); return <p className={`pipeline-status ${status.tone}`}><i aria-hidden="true" />{status.text}</p>; })()}

      {effectiveView === "timeline" ? (
        <PipelineTimeline pipeline={pipeline} onInspect={onInspect} />
      ) : (
        <div className="workflow-graph">
        <div className="graph-stage" style={{ width: graph.width, height: graph.height }}>
          <svg viewBox={`0 0 ${graph.width} ${graph.height}`} aria-hidden="true">
            <defs>
              <marker id="graphArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 z" />
              </marker>
            </defs>
            <g>
              {pipeline.edges.map((edge) => {
                const from = graph.positions.get(edge.fromNodeKey);
                const to = graph.positions.get(edge.toNodeKey);
                if (!from || !to) return null;
                const x1 = from.x + NODE_WIDTH;
                const y1 = from.y + HALF_HEIGHT;
                const x2 = to.x;
                const y2 = to.y + HALF_HEIGHT;
                const bend = (x1 + x2) / 2;
                return <path key={`${edge.fromNodeKey}-${edge.toNodeKey}`} d={`M${x1} ${y1} C${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`} />;
              })}
            </g>
          </svg>
          {pipeline.nodes.map((node) => {
            const position = graph.positions.get(node.nodeKey)!;
            const status = nodeStatus(node);
            const needsApproval = started && node.nodeRunState === "pending" && node.transitionMode === "human";
            const canPublish = started && node.nodeRunState === "completed";
            return (
              <article
                className={`workflow-node ${status.stateClass}`}
                key={node.nodeKey}
                style={{ left: position.x, top: position.y, width: NODE_WIDTH }}
              >
                <span className="node-state">{status.label}</span>
                {node.transitionMode === "human" && <span className={`node-gate ${needsApproval ? "waiting" : "clear"}`}>{needsApproval ? "◇ FEU VERT REQUIS" : "✋ TRANSITION MANUELLE"}</span>}
                <button type="button" className="node-title" onClick={() => onInspect(node.missionId)} title={node.missionTitle}>{node.missionTitle}</button>
                <span className="node-agent"><i className={`node-agent-dot ${status.stateClass}`} /><small>{node.nodeKey} · {node.missionKind === "agent" ? "Agent" : "Humain"}</small></span>
                {started && (
                  <div className="node-mode" role="group" aria-label={`Mode de transition ${node.nodeKey}`}>
                    <button type="button" className={node.transitionMode === "auto" ? "active" : ""} disabled={busy !== null} onClick={() => void run(`mode-${node.nodeKey}`, () => setNodeTransitionMode(pipeline.runId!, node.nodeKey, "auto"))}>Auto</button>
                    <button type="button" className={node.transitionMode === "human" ? "active" : ""} disabled={busy !== null} onClick={() => void run(`mode-${node.nodeKey}`, () => setNodeTransitionMode(pipeline.runId!, node.nodeKey, "human"))}>Manuel</button>
                  </div>
                )}
                {(needsApproval || canPublish) && (
                  <div className="node-agent-actions">
                    {needsApproval && <button type="button" disabled={busy !== null} onClick={() => void run(`approve-${node.nodeKey}`, async () => { await approveNodeTransition(pipeline.runId!, node.nodeKey); await advancePipelineRun(pipeline.runId!); })}>{busy === `approve-${node.nodeKey}` ? "…" : "✓ Approuver"}</button>}
                    {canPublish && <button type="button" disabled={busy !== null} onClick={() => void run(`publish-${node.nodeKey}`, async () => { await publishNodeHandover(pipeline.runId!, node.nodeKey); await advancePipelineRun(pipeline.runId!); })}>{busy === `publish-${node.nodeKey}` ? "…" : "⇢ Relais"}</button>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
      )}
      {error && <p className="pipeline-error" role="alert">{error}</p>}
    </article>
  );
}

function pipelineProgress(pipeline: PipelineListItem): { completed: number; total: number } {
  const total = pipeline.nodes.length;
  const completed = pipeline.nodes.filter((node) => node.nodeRunState === "completed" || (!pipeline.runId && node.missionState === "DONE")).length;
  return { completed, total };
}

export function PipelinesPage({ pipelines, focusPipelineId, onInspect, onChanged, onCreateExample, exampleBusy, onSaveFavorite, onCreateFavorite, favoriteBusy, error }: {
  pipelines: PipelineListItem[];
  focusPipelineId?: string | null;
  onInspect(missionId: string): void;
  onChanged(): void;
  onCreateExample(): void;
  exampleBusy: boolean;
  onSaveFavorite(pipeline: PipelineListItem): Promise<PipelineFavorite | null>;
  onCreateFavorite(favorite: PipelineFavorite): void;
  favoriteBusy: string | null;
  error?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<PipelineViewMode>(() => loadPipelineViewMode());
  const [favorites, setFavorites] = useState<PipelineFavorite[]>(() => loadPipelineFavorites());
  useEffect(() => { if (focusPipelineId) { setSelectedId(focusPipelineId); setShowAll(true); } }, [focusPipelineId]);
  const isDone = (pipeline: PipelineListItem) => pipeline.state === "archived" || pipeline.runState === "completed" || pipeline.runState === "cancelled" || pipeline.runState === "archived";
  const visible = pipelines.filter((pipeline) => showAll || !isDone(pipeline));
  const active = pipelines.filter((pipeline) => pipeline.runState === "active" || pipeline.runState === "blocked").length;
  const doneCount = pipelines.filter(isDone).length;
  const selected = visible.find((pipeline) => pipeline.id === selectedId) ?? visible[0] ?? null;
  const renameFavorite = (favorite: PipelineFavorite) => {
    const name = window.prompt("Nom du modèle", favorite.name);
    if (name !== null) setFavorites(renamePipelineFavorite(favorite.id, name));
  };

  return (
    <section className="pipeline-page" aria-label="Pipelines">
      <div className="pipeline-page-head">
        <div>
          <span className="eyebrow">HANDOVER · PIPELINES</span>
          <h2>{active ? `${active} pipeline${active > 1 ? "s" : ""} en cours` : `${visible.length} pipeline${visible.length > 1 ? "s" : ""}`}</h2>
        </div>
        {doneCount > 0 && (
          <button type="button" className={`pipeline-archived-toggle${showAll ? " active" : ""}`} onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Masquer terminés" : `Voir terminés (${doneCount})`}
          </button>
        )}
      </div>

      {favorites.length > 0 && (
        <section className="pipeline-favorites" aria-label="Modèles de pipeline">
          <div><span className="eyebrow">MODÈLES SAUVEGARDÉS</span><h3>Créer depuis un modèle</h3></div>
          <div className="pipeline-favorite-list">
            {favorites.map((favorite) => <article key={favorite.id} className="pipeline-favorite">
              <div><b>{favorite.name}</b><small>{favorite.nodes.length} étapes · {favorite.nodes.filter((node) => node.kind === "agent").length} agent{favorite.nodes.filter((node) => node.kind === "agent").length > 1 ? "s" : ""}</small></div>
              <div className="pipeline-favorite-actions">
                <button type="button" className="pipeline-action primary" disabled={favoriteBusy !== null} onClick={() => onCreateFavorite(favorite)}>{favoriteBusy === favorite.id ? "Création…" : "Créer"}</button>
                <button type="button" className="pipeline-action" disabled={favoriteBusy !== null} onClick={() => renameFavorite(favorite)}>Renommer</button>
                <button type="button" className="pipeline-action danger" disabled={favoriteBusy !== null} onClick={() => setFavorites(deletePipelineFavorite(favorite.id))}>Supprimer</button>
              </div>
            </article>)}
          </div>
        </section>
      )}

      {!pipelines.length ? (
        <div className="pipeline-empty-state">
          <span className="pipeline-empty-mark" aria-hidden="true">⌁</span>
          <h3>Aucun pipeline pour l'instant</h3>
          <p>
            Un pipeline enchaîne plusieurs missions (pré-requis → étape finale). Crée un
            exemple en un clic — deux missions enchaînées, prêtes à démarrer — ou
            configure des pré-requis (séquence) dans une fiche de mission pour en créer un.
          </p>
          <button type="button" className="primary-button" disabled={exampleBusy} onClick={onCreateExample}>
            {exampleBusy ? "Création…" : "⚡ Créer un pipeline d'exemple"}
          </button>
          {error && <p className="pipeline-error" role="alert">{error}</p>}
        </div>
      ) : (
        <>
          <div className="workflow-tabs" role="tablist">
            {visible.map((pipeline) => {
              const { completed, total } = pipelineProgress(pipeline);
              return (
                <button key={pipeline.id} role="tab" aria-selected={pipeline.id === selected?.id} onClick={() => setSelectedId(pipeline.id)}>
                  <span className="workflow-tab-label">
                    <b>{pipeline.name}</b>
                    <em>{pipeline.runState ? RUN_STATE_LABEL[pipeline.runState] ?? pipeline.runState : "non démarré"}</em>
                  </span>
                  <small>{completed}/{total}</small>
                </button>
              );
            })}
          </div>
          {selected
            ? <PipelineCard
                key={selected.id}
                pipeline={selected}
                view={view}
                onViewChange={(mode) => { setView(mode); savePipelineViewMode(mode); }}
                onInspect={onInspect}
                onChanged={onChanged}
                onSaveFavorite={(pipeline) => { void onSaveFavorite(pipeline).then((favorite) => { if (favorite) setFavorites(loadPipelineFavorites()); }); }}
                favoriteBusy={favoriteBusy === selected.id}
              />
            : <p className="pipeline-empty-page">Aucun pipeline en cours. Active « Voir terminés » pour consulter l'historique.</p>}
        </>
      )}
    </section>
  );
}
