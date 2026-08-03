import { useCallback, useEffect, useState } from "react";
import type { ManagerTimelineItemView, ManagerTimelineView, ManagerView, MissionView } from "../types";
import {
  TIMELINE_KIND_LABELS,
  TIMELINE_PERIODS,
  loadManagerTimeline,
  timelineSince,
  type TimelinePeriod
} from "../services/manager-timeline-service";
import { formatActivityTime } from "./ActivityHub";
import { PixelAvatar } from "./PixelAvatar";
import { useSseRefresh } from "../hooks/useSseRefresh";

const DEFAULT_LIMIT = 200;

/** Clé de jour (YYYY-MM-DD) d'un horodatage ISO. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Regroupe les items chronologiques (déjà triés DESC) par jour. */
export function groupTimelineByDay(items: ManagerTimelineItemView[]): Array<{ day: string; items: ManagerTimelineItemView[] }> {
  const groups: Array<{ day: string; items: ManagerTimelineItemView[] }> = [];
  for (const item of items) {
    const key = dayKey(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === key) last.items.push(item);
    else groups.push({ day: key, items: [item] });
  }
  return groups;
}

export function dayLabel(day: string, now: Date = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  if (day === today) return "Aujourd'hui";
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (day === yesterday) return "Hier";
  // Midi UTC : évite les décalages de fuseau horaire sur la date affichée.
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${day}T12:00:00.000Z`));
}

export function truncateTimelineBody(body: string | null, max = 280): string {
  if (!body) return "—";
  return body.length <= max ? body : `${body.slice(0, max)}…`;
}

export function ManagerTimelinePanel({
  open,
  managers,
  missions,
  onClose,
  onOpenThread
}: {
  open: boolean;
  managers: ManagerView[];
  missions: MissionView[];
  onClose(): void;
  onOpenThread(managerId: string, threadId: string): void;
}) {
  const [view, setView] = useState<ManagerTimelineView>({ items: [], truncated: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [managerId, setManagerId] = useState("");
  const [missionId, setMissionId] = useState("");
  const [period, setPeriod] = useState<TimelinePeriod>("");
  const [query, setQuery] = useState("");

  const loadTimeline = useCallback(() => {
    if (!open) return;
    setLoading(true);
    void loadManagerTimeline({
      managerId: managerId || null,
      missionId: missionId || null,
      query: query.trim() || null,
      since: timelineSince(period),
      limit: DEFAULT_LIMIT
    })
      .then((next) => { setView(next); setError(""); })
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoading(false));
  }, [open, managerId, missionId, period, query]);

  // Chargement (débouncé pour la recherche) à l'ouverture et à chaque filtre.
  useEffect(() => {
    const handle = setTimeout(loadTimeline, 200);
    return () => clearTimeout(handle);
  }, [loadTimeline]);

  // Temps réel : le flux SSE rafraîchit la timeline quand elle est ouverte.
  useSseRefresh(loadTimeline);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupTimelineByDay(view.items);
  const sortedMissions = [...missions].sort((left, right) => left.title.localeCompare(right.title));

  return (
    <div
      className="manager-timeline-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <aside className="manager-timeline-drawer" role="dialog" aria-modal="true" aria-label="Historique des conversations">
        <header className="manager-timeline-header">
          <div>
            <span className="eyebrow">GUILD LOG</span>
            <h2>Historique des managers</h2>
            <p className="manager-timeline-summary">
              {loading
                ? "Chargement…"
                : view.items.length === 0
                  ? "Aucun message de manager."
                  : `${view.items.length} message${view.items.length > 1 ? "s" : ""}${view.truncated ? ` (${DEFAULT_LIMIT} plus récents)` : ""}.`}
            </p>
          </div>
          <button type="button" className="manager-timeline-close" aria-label="Fermer l'historique" onClick={onClose}>×</button>
        </header>

        <div className="manager-timeline-filters">
          <label>
            <span>Manager</span>
            <select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
              <option value="">Tous les managers</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Mission mentionnée</span>
            <select value={missionId} onChange={(event) => setMissionId(event.target.value)}>
              <option value="">Toutes les missions</option>
              {sortedMissions.map((mission) => (
                <option key={mission.id} value={mission.id}>{mission.title}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Période</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value as TimelinePeriod)}>
              {TIMELINE_PERIODS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="manager-timeline-search">
            <span>Recherche</span>
            <input
              type="search"
              role="searchbox"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="mot-clé dans les messages…"
              aria-label="Rechercher dans les messages des managers"
            />
          </label>
        </div>

        {error && <p className="manager-timeline-error" role="alert">{error}</p>}

        {view.items.length === 0 && !loading ? (
          <p className="empty manager-timeline-empty">Rien ici — ajuste les filtres pour retrouver une décision passée.</p>
        ) : (
          <div className="manager-timeline-groups">
            {groups.map((group) => (
              <section className="manager-timeline-group" key={group.day} aria-label={dayLabel(group.day)}>
                <h3 className="manager-timeline-day">{dayLabel(group.day)}</h3>
                <ul className="manager-timeline-list">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <article
                        className="manager-timeline-item"
                        onClick={() => onOpenThread(item.managerId, item.conversationId)}
                      >
                        <PixelAvatar id={item.managerId} title={item.managerName} mini />
                        <span className="manager-timeline-body">
                          <strong className="manager-timeline-title">
                            {item.managerName}
                            <i className={`dot dot-${item.managerState}`} title={`État : ${item.managerState}`} />
                            <em>{TIMELINE_KIND_LABELS[item.kind] ?? item.kind}</em>
                          </strong>
                          <p title={item.body ?? undefined}>{truncateTimelineBody(item.body)}</p>
                          <small className="manager-timeline-time">
                            {formatActivityTime(item.createdAt)} · {item.conversationId.slice(0, 8)}…
                          </small>
                        </span>
                        <span className="manager-timeline-open" aria-hidden="true">→</span>
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
