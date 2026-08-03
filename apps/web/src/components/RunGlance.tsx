import { useEffect, useState } from "react";
import { formatGlanceElapsed, type RunGlanceItem } from "../services/run-glance-service";

/** Tic de rafraîchissement des temps écoulés (le SSE rafraîchit les données, pas l'horloge). */
const TICK_MS = 30_000;

const KIND_LABEL: Record<RunGlanceItem["kind"], string> = {
  mission: "MISSION",
  pipeline: "PIPELINE",
  manager: "MANAGER"
};

/**
 * Barre horizontale « Glance » en haut du board : tous les runs actifs
 * (missions en run, pipelines en run, managers actifs) avec dernière action,
 * temps écoulé et état. Clic → ouvre la conversation correspondante.
 *
 * Données déjà chargées par le board (rafraîchies par SSE, aucun polling) —
 * seule l'horloge du temps écoulé est locale.
 */
export function RunGlance({ items, onOpen }: { items: RunGlanceItem[]; onOpen(item: RunGlanceItem): void }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (items.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <section className="run-glance" aria-label="Runs actifs">
      <header className="run-glance-head">
        <div>
          <span className="eyebrow">GLANCE</span>
          <h2>{items.length} run{items.length > 1 ? "s" : ""} actif{items.length > 1 ? "s" : ""}</h2>
        </div>
        <small>Où en est chaque run ?</small>
      </header>
      <div className="run-glance-track">
        {items.map((item) => (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            className={`run-glance-item tone-${item.tone}`}
            onClick={() => onOpen(item)}
            aria-label={`Ouvrir la conversation ${KIND_LABEL[item.kind].toLowerCase()} ${item.title}`}
          >
            <i className="run-glance-dot" aria-hidden="true" />
            <span className="run-glance-kind">{KIND_LABEL[item.kind]}</span>
            <strong className="run-glance-title">{item.title}</strong>
            <span className="run-glance-detail" title={item.detail}>{item.detail}</span>
            <span className="run-glance-meta">
              <time>{formatGlanceElapsed(item.startedAt, now)}</time>
              <b className="run-glance-state">{item.stateLabel}</b>
            </span>
            <em className="run-glance-open" aria-hidden="true">↗</em>
          </button>
        ))}
      </div>
    </section>
  );
}
