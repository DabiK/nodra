import type { ActivityItem, ActivityView } from "../services/activity-service";

/**
 * Hub d'activité (issue #13) : liste les items du relay qui attendent une
 * décision humaine — missions en VALIDATION/BLOCKED, deliveries à accepter,
 * approbations en attente, transitions de pipeline à approuver. Chaque item
 * ouvre la fiche mission (ou la pipeline), et peut être marqué lu.
 */

const REASON_ICONS: Record<string, string> = {
  mission_decision_required: "✋",
  agent_result_requires_validation: "🤖",
  delivery_pending: "📦",
  approval_pending: "🔏",
  pipeline_waiting_human_validation: "⑃",
  pipeline_transition_requires_human: "⑃",
  pipeline_node_failed: "✕",
  run_failed: "✕",
  run_cancelled: "◌"
};

export const REASON_LABELS: Record<string, string> = {
  mission_decision_required: "Soumise pour validation",
  agent_result_requires_validation: "Résultat d'agent à valider",
  delivery_pending: "Delivery à accepter",
  approval_pending: "Approbation à rendre",
  pipeline_waiting_human_validation: "Résultat de pipeline à valider",
  pipeline_transition_requires_human: "Transition à approuver",
  pipeline_node_failed: "Nœud de pipeline en échec",
  run_failed: "Run en échec",
  run_cancelled: "Run annulé"
};

export function reasonLabel(item: ActivityItem): string {
  const known = REASON_LABELS[item.reasonCode];
  if (known) return known;
  // Les missions bloquées portent la raison du blocage en texte libre.
  return item.queue === "blocked" ? `Bloquée — ${item.reasonCode}` : item.reasonCode;
}

export function formatActivityTime(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  const deltaMs = now.getTime() - date.getTime();
  if (deltaMs < 60_000) return "à l'instant";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function ActivityItemRow({
  item,
  onOpen,
  onMarkRead
}: {
  item: ActivityItem;
  onOpen(item: ActivityItem): void;
  onMarkRead(item: ActivityItem): void;
}) {
  const title = item.subject.kind === "mission" ? item.subject.mission.title : item.subject.pipelineName;
  return (
    <li>
      <article
        className={`activity-item${item.state === "unread" ? " unread" : ""}`}
        onClick={() => onOpen(item)}
      >
        <span className="activity-item-icon" aria-hidden="true">
          {REASON_ICONS[item.reasonCode] ?? (item.queue === "blocked" ? "◇" : "●")}
        </span>
        <span className="activity-item-body">
          <strong className="activity-item-title">{title}</strong>
          <small className="activity-item-reason">{reasonLabel(item)}</small>
          <small className="activity-item-time">
            {item.subject.kind === "mission" ? `${item.subject.mission.state} · ` : ""}
            {formatActivityTime(item.createdAt)}
            {item.state === "unread" ? " · non lu" : " · lu"}
          </small>
        </span>
        {item.state === "unread" && (
          <button
            type="button"
            className="activity-mark-read"
            aria-label={`Marquer comme lu : ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              onMarkRead(item);
            }}
          >
            Lu
          </button>
        )}
      </article>
    </li>
  );
}

export function ActivityHub({
  open,
  activity,
  onClose,
  onOpenMission,
  onOpenPipeline,
  onMarkRead,
  onMarkAllRead
}: {
  open: boolean;
  activity: ActivityView | null;
  onClose(): void;
  onOpenMission(missionId: string): void;
  onOpenPipeline(pipelineId: string): void;
  onMarkRead(relayId: string): void;
  onMarkAllRead(): void;
}) {
  if (!open) return null;

  const items = activity?.items ?? [];
  const unread = items.filter((item) => item.state === "unread");
  const decisionItems = items.filter((item) => item.queue === "decision_required");
  const blockedItems = items.filter((item) => item.queue === "blocked");

  const openItem = (item: ActivityItem) => {
    if (item.subject.kind === "mission") onOpenMission(item.subject.mission.id);
    else onOpenPipeline(item.subject.pipelineId);
  };

  const section = (label: string, sectionItems: ActivityItem[]) => (
    <section className="activity-group" aria-label={label}>
      <h3 className="activity-section-label">{label} · {sectionItems.length}</h3>
      <ul className="activity-list">
        {sectionItems.map((item) => (
          <ActivityItemRow key={item.relayId} item={item} onOpen={openItem} onMarkRead={(read) => onMarkRead(read.relayId)} />
        ))}
      </ul>
    </section>
  );

  return (
    <div
      className="activity-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <aside className="activity-drawer" role="dialog" aria-modal="true" aria-label="Hub d'activité">
        <header className="activity-header">
          <div>
            <span className="eyebrow">NOTIFICATIONS</span>
            <h2>Activité</h2>
            <p className="activity-summary">
              {activity === null
                ? "Chargement…"
                : unread.length === 0
                  ? "Aucune décision en attente."
                  : `${unread.length} décision${unread.length > 1 ? "s" : ""} humaine${unread.length > 1 ? "s" : ""} à traiter.`}
            </p>
          </div>
          <button type="button" className="activity-close" aria-label="Fermer le hub d'activité" onClick={onClose}>×</button>
        </header>

        {unread.length > 0 && (
          <button type="button" className="activity-mark-all" onClick={onMarkAllRead}>
            ✓ Tout marquer lu
          </button>
        )}

        {activity === null ? (
          <p className="empty">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="empty activity-empty">Rien à traiter — aucune décision humaine en attente.</p>
        ) : (
          <div className="activity-groups">
            {decisionItems.length > 0 && section("Décision requise", decisionItems)}
            {blockedItems.length > 0 && section("Bloquées", blockedItems)}
          </div>
        )}
      </aside>
    </div>
  );
}
