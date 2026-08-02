import type { ConversationContextRisk } from "../services/conversation-context-service";
import { formatTokenCount } from "../services/budget-service";

/**
 * Bannière "conversation longue" : affichée dans les chats quand l'heuristique
 * détecte un risque de perte de contexte. Montre les métriques (tours, tokens
 * estimés, événements tronqués) et propose une action de remédiation
 * (nouveau fil ou compaction), si fournie.
 */
export function ConversationContextBanner({
  risk,
  actionLabel,
  onAction,
  busy
}: {
  risk: ConversationContextRisk | null;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  if (!risk || risk.level === "ok") return null;
  const critical = risk.level === "critical";
  const tokens = formatTokenCount(risk.estimatedTokens) ?? "—";
  return (
    <div className={`context-risk-banner${critical ? " critical" : ""}`} role="status">
      <div className="context-risk-banner-text">
        <strong>
          {critical
            ? "⚠ Conversation très longue — risque élevé de perte de contexte"
            : "⚠ Conversation longue — risque de perte de contexte"}
        </strong>
        <p className="context-risk-metrics">
          {risk.turnCount} tour{risk.turnCount > 1 ? "s" : ""} · ≈ {tokens} tokens{" "}
          {risk.tokenSource === "estimated" ? "estimés" : "rapportés"}
          {risk.truncatedEventCount > 0 ? ` · ${Math.round(risk.truncationRate * 100)} % d'événements tronqués` : ""}
        </p>
        {risk.reasons.length > 0 ? <small className="context-risk-reasons">{risk.reasons.join(" · ")}</small> : null}
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="context-risk-action" disabled={busy} onClick={onAction}>
          {busy ? "…" : actionLabel}
        </button>
      ) : null}
    </div>
  );
}
