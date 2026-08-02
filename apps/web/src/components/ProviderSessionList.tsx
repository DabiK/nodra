import type { ProviderSessionListItem } from "../types";
import { providerLabel } from "../services/provider-label";

export function ProviderSessionList({ sessions, selectedId, onSelect }: { sessions: ProviderSessionListItem[]; selectedId: string | null; onSelect(id: string): void }) {
  if (!sessions.length) return <p className="empty">Aucune session observée.</p>;
  return (
    <div className="provider-session-list" aria-label="Sessions observées">
      {sessions.map((session) => {
        const providerId = session.summary.ref.providerId;
        return (
          <button key={session.id} type="button" className={session.id === selectedId ? "active" : ""} onClick={() => onSelect(session.id)} aria-pressed={session.id === selectedId}>
            <span className={`provider-badge ${providerId}`} aria-hidden="true">{providerId === "opencode" ? "◫" : "⌁"}</span>
            <span className="provider-session-list-copy"><strong>{session.summary.title ?? "Session sans titre"}</strong><small>{providerLabel(providerId)} · {session.summary.cwd ?? session.summary.ref.externalSessionId}</small></span>
            <span className="provider-session-list-meta"><span className={`provider-session-state ${session.summary.state}`}>{session.summary.state}</span>{session.link ? <em>Liée</em> : null}</span>
          </button>
        );
      })}
    </div>
  );
}
