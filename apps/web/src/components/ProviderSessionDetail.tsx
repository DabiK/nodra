import type { ProviderSessionDetailView } from "../types";
import { providerLabel } from "../services/provider-label";
import { providerSessionSections } from "../services/provider-session-sections";
import { subagentStatusLabel, subagentToolLabel } from "../services/subagent-labels";
import { SubagentExecution } from "./SubagentExecution";

function itemRoleLabel(role: string, kind: string, providerId: string) {
  const label = providerLabel(providerId);
  if (role === "user") return "Vous";
  if (kind === "subagent") return "Sous-agent";
  if (role === "assistant") return kind === "message" ? label : `${label} · activité`;
  if (role === "system") return "Système";
  return role === "unknown" || !role ? "Activité" : role;
}

function SnapshotItem({ item, providerId }: { item: ProviderSessionDetailView["snapshot"]["items"][number]; providerId: string }) {
  const isUser = item.role === "user";
  const isSubagent = item.kind === "subagent";
  const isTool = item.kind !== "message" && !isSubagent;
  const avatarLetter = isUser ? "U" : isTool ? "›_" : isSubagent ? "◈" : providerLabel(providerId).charAt(0).toUpperCase();
  const statusLabel = isSubagent ? subagentStatusLabel(item.text) : null;
  return (
    <article className={`provider-session-item ${isUser ? "from-user" : "from-provider"} ${isTool ? "is-tool" : ""} ${isSubagent ? "is-subagent" : ""}`}>
      <header><span className="provider-session-item-author"><i aria-hidden="true">{avatarLetter}</i>{itemRoleLabel(item.role, item.kind, providerId)}</span><small>{item.kind} · #{item.order}</small></header>
      {item.name ? <strong>{subagentToolLabel(item.name) ?? item.name}</strong> : null}
      {statusLabel ? <span className="subagent-chip">{statusLabel}</span> : <p>{item.text ?? "—"}</p>}
      {isSubagent && item.subagent ? <SubagentExecution execution={item.subagent} /> : null}
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
        {providerSessionSections(snapshot.turns, snapshot.items).map((section) => section.turn ? <section className="provider-session-turn" key={section.turn.externalTurnId}><header><strong>Tour {section.turn.order}</strong><span>{section.turn.state}</span></header><div className="provider-session-turn-items">{section.items.map((item) => <SnapshotItem key={item.externalItemId} item={item} providerId={detail.identity.providerId} />)}</div></section> : <section className="provider-session-turn" key={section.items[0]?.externalItemId}><div className="provider-session-turn-items">{section.items.map((item) => <SnapshotItem key={item.externalItemId} item={item} providerId={detail.identity.providerId} />)}</div></section>)}
        {!snapshot.turns.length && !snapshot.items.length ? <p className="empty">Ce snapshot ne contient encore aucun élément.</p> : null}
      </div></div>
    </section>
  );
}
