import { useRef, useState, type RefObject } from "react";
import type { MissionRunView } from "../types";
import { formatCostMicros, formatTokenCount, runTokenTotal } from "../services/budget-service";
import { formatDuration } from "../services/pipeline-timeline-service";

function displayPayload(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function RunPane({ run, side, eventRef, onScroll }: { run: MissionRunView; side: "left" | "right"; eventRef: RefObject<HTMLDivElement | null>; onScroll(scrollTop: number, source: "left" | "right"): void }) {
  const tokens = runTokenTotal(run);
  return (
    <article className="run-comparator-pane" aria-label={`Run essai ${run.attempt}`}>
      <header>
        <strong>Essai {run.attempt}</strong>
        <span className={`run-comparator-state state-${run.state.toLowerCase()}`}>{run.state}</span>
      </header>
      <dl className="run-comparator-metrics">
        <div><dt>Durée</dt><dd>{run.durationMs == null ? "—" : formatDuration(run.durationMs)}</dd></div>
        <div><dt>Tokens</dt><dd>{tokens == null ? "—" : formatTokenCount(tokens)}</dd></div>
        <div><dt>Coût</dt><dd>{formatCostMicros(run.costMicros) ?? "—"}</dd></div>
        <div><dt>Modèle</dt><dd>{run.modelId} · {run.providerId}</dd></div>
        <div><dt>Effort</dt><dd>{run.reasoningEffort ?? "—"}</dd></div>
        <div><dt>Permission</dt><dd>{run.permissionPreset ?? "—"}</dd></div>
      </dl>
      <section><h4>Prompt</h4><pre>{run.promptEffective || "Snapshot non disponible"}</pre></section>
      <section><h4>Options agent</h4><pre>{run.providerOptions == null ? "—" : displayPayload(run.providerOptions)}</pre></section>
      <section><h4>Gates</h4>{run.gates?.length ? <ul className="run-comparator-gates">{run.gates.map((gate) => <li key={`${gate.name}/${gate.evaluatedAt}`}><b>{gate.state}</b> {gate.name}{gate.rationale ? ` — ${gate.rationale}` : ""}</li>)}</ul> : <p>Aucun gate évalué.</p>}</section>
      <section><h4>Événements provider ({run.events?.length ?? 0})</h4><div ref={eventRef} className="run-comparator-events" onScroll={(event) => onScroll(event.currentTarget.scrollTop, side)}>{run.events?.length ? run.events.map((event) => <pre key={event.sequence}><b>#{event.sequence} · {event.type}</b>{"\n"}{displayPayload(event.payload)}</pre>) : <p>Aucun événement provider.</p>}</div></section>
    </article>
  );
}

/** Comparaison locale de deux tentatives d'une même mission. */
export function MissionRunComparator({ runs }: { runs: MissionRunView[] }) {
  const [leftId, setLeftId] = useState(runs.at(-2)?.id ?? runs[0]?.id ?? "");
  const [rightId, setRightId] = useState(runs.at(-1)?.id ?? runs[1]?.id ?? "");
  const leftEvents = useRef<HTMLDivElement | null>(null);
  const rightEvents = useRef<HTMLDivElement | null>(null);
  const left = runs.find((run) => run.id === leftId) ?? runs[0];
  const right = runs.find((run) => run.id === rightId) ?? runs[1];
  if (!left || !right || runs.length < 2) return null;
  const sync = (top: number, source: "left" | "right") => {
    const target = source === "left" ? rightEvents.current : leftEvents.current;
    if (target && Math.abs(target.scrollTop - top) > 1) target.scrollTop = top;
  };
  return (
    <section className="mission-run-comparator" aria-label="Comparateur de runs">
      <header><div><span className="eyebrow">COMPARATEUR</span><strong>Comparer deux exécutions</strong></div><small>Les événements défilent ensemble.</small></header>
      <div className="run-comparator-selectors">
        <label>Gauche<select value={left.id} onChange={(event) => setLeftId(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>Essai {run.attempt} · {run.state}</option>)}</select></label>
        <label>Droite<select value={right.id} onChange={(event) => setRightId(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>Essai {run.attempt} · {run.state}</option>)}</select></label>
      </div>
      <div className="run-comparator-grid">
        <RunPane run={left} side="left" eventRef={leftEvents} onScroll={sync} />
        <RunPane run={right} side="right" eventRef={rightEvents} onScroll={sync} />
      </div>
    </section>
  );
}
