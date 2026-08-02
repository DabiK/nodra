import type { ProviderSessionDetailView } from "../types";
import { providerLabel } from "../services/provider-label";

function itemRoleLabel(role: string, kind: string, providerId: string) {
  const label = providerLabel(providerId);
  if (role === "user") return "Vous";
  if (role === "assistant") return kind === "message" ? label : `${label} · activité`;
  if (role === "system") return "Système";
  return role === "unknown" || !role ? "Activité" : role;
}

function SnapshotItem({ item, providerId }: { item: ProviderSessionDetailView["snapshot"]["items"][number]; providerId: string }) {
  const isUser = item.role === "user";
  const isTool = item.kind !== "message";
  const avatarLetter = providerLabel(providerId).charAt(0).toUpperCase();
  return (
    <article className={`provider-session-item ${isUser ? "from-user" : "from-provider"} ${isTool ? "is-tool" : ""}`}>
      <header><span className="provider-session-item-author"><i aria-hidden="true">{isUser ? "U" : isTool ? "›_" : avatarLetter}</i>{itemRoleLabel(item.role, item.kind, providerId)}</span><small>{item.kind} · #{item.order}</small></header>
      {item.name ? <strong>{item.name}</strong> : null}
      <p>{item.text ?? "—"}</p>
    </article>
  );
}

export function ProviderSessionDetail({ detail, refreshing, onRefresh, onAttach, onOpenMission }: { detail: ProviderSessionDetailView | null; refreshing: boolean; onRefresh(): void; onAttach(): void; onOpenMission(missionId: string): void }) {
  if (!detail) return <p className="empty">Sélectionne une session pour voir son snapshot.</p>;
  const { snapshot } = detail;
  const label = providerLabel(detail.identity.providerId);
  return (
    <section className="provider-session-detail" aria-label="Snapshot de session">
      <header className="provider-session-detail-head">
        <div><span className="eyebrow">SNAPSHOT · LECTURE SEULE</span><h2>Session {label}</h2><div className="provider-session-context"><span className={`provider-session-state ${snapshot.session.state}`}>{snapshot.session.state}</span><small>{snapshot.session.cwd ?? "Répertoire non renseigné"}</small></div></div>
        <div className="provider-session-actions"><button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Rafraîchissement…" : "Rafraîchir"}</button>{detail.link ? <button type="button" className="secondary provider-session-linked" onClick={() => onOpenMission(detail.link!.missionId)}>Ouvrir la conversation</button> : <button type="button" className="secondary" onClick={onAttach}>Lier à une mission</button>}</div>
      </header>
      <div className="provider-session-readonly-note"><span aria-hidden="true">◌</span><p>Instantané consultable uniquement. Pas de streaming, ni historique paginé, ni contrôle de la session fournisseur.</p></div>
      <div className="provider-session-feed-wrap"><div className="provider-session-timeline" aria-live="polite">
        {snapshot.turns.map((turn) => <section className="provider-session-turn" key={turn.externalTurnId}><header><strong>Tour {turn.order}</strong><span>{turn.state}</span></header><div className="provider-session-turn-items">{snapshot.items.filter((item) => item.externalTurnId === turn.externalTurnId).map((item) => <SnapshotItem key={item.externalItemId} item={item} providerId={detail.identity.providerId} />)}</div></section>)}
        {snapshot.items.filter((item) => item.externalTurnId === null).map((item) => <SnapshotItem key={item.externalItemId} item={item} providerId={detail.identity.providerId} />)}
        {!snapshot.turns.length && !snapshot.items.length ? <p className="empty">Ce snapshot ne contient encore aucun élément.</p> : null}
      </div></div>
    </section>
  );
}
