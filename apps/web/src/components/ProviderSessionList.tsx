import type { ProviderSessionListItem } from "../types";
import { providerLabel } from "../services/provider-label";

/** État vide de l'observatoire : aucune conversation observée, CTA de rechargement. */
export function ProviderSessionsEmpty({ onReload }: { onReload(): void }) {
  return (
    <div className="provider-sessions-empty">
      <span className="provider-sessions-empty-mark" aria-hidden="true">◫</span>
      <h3>Aucune conversation observée</h3>
      <p>
        Les conversations apparaissent ici dès qu'un agent (Codex ou OpenCode) travaille avec
        le serveur d'application — le snapshot est ensuite mis à jour en temps réel. Vérifie
        l'état des capacités ci-dessus, puis recharge.
      </p>
      <button type="button" className="primary-button" onClick={onReload}>⟳ Recharger</button>
    </div>
  );
}

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
