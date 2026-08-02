/**
 * Détection du risque de perte de contexte dans une conversation longue.
 *
 * Heuristique côté client (issue #10) : une conversation devient risquée quand
 * elle accumule des tours, un volume de tokens important (rapporté par le
 * provider quand disponible, sinon estimé ~4 caractères/token) ou des
 * événements provider tronqués. Le résultat alimente une bannière dans les
 * chats (fil provider et chat manager).
 */

import { formatTokenCount } from "./budget-service";

export type ContextRiskLevel = "ok" | "warn" | "critical";

/** Seuils de déclenchement de l'avertissement (exportés pour tests/tuning). */
export const CONTEXT_RISK_THRESHOLDS = {
  warnTokens: 80_000,
  criticalTokens: 160_000,
  warnTurns: 25,
  criticalTurns: 50,
  warnTruncationRate: 0.2,
  criticalTruncationRate: 0.4
} as const;

export interface ConversationContextInput {
  /** Nombre de tours humains de la conversation. */
  turnCount: number;
  /** Longueur totale approximative du contenu visible en caractères. */
  charCount: number;
  /** Tokens réels connus du run (cumulés), si disponibles. */
  totalTokens?: number | null;
  /** Événements provider bruts, scannés pour des marqueurs de troncature. */
  events?: unknown[];
}

export interface ConversationContextRisk {
  level: ContextRiskLevel;
  turnCount: number;
  /** Tokens affichés : réels si rapportés, sinon estimation par le texte. */
  estimatedTokens: number;
  tokenSource: "reported" | "estimated";
  /** Part des événements provider portant un marqueur de troncature (0..1). */
  truncationRate: number;
  truncatedEventCount: number;
  /** Libellés FR des critères qui ont déclenché l'avertissement. */
  reasons: string[];
}

const LEVEL_RANK: Record<ContextRiskLevel, number> = { ok: 0, warn: 1, critical: 2 };

function maxLevel(left: ContextRiskLevel, right: ContextRiskLevel): ContextRiskLevel {
  return LEVEL_RANK[left] >= LEVEL_RANK[right] ? left : right;
}

/** Approximation standard : ~4 caractères par token. */
export function estimateTokensFromText(charCount: number): number {
  return Math.max(1, Math.round(charCount / 4));
}

/**
 * Compte les événements dont le payload contient un marqueur de troncature
 * (clé contenant "truncat" avec une valeur véridique, à n'importe quel niveau
 * de profondeur — ex. `truncated: true`, `outputTruncated`, `isTruncated`).
 * Les clés sans valeur véridique (ex. `truncated: false`) ne comptent pas.
 */
export function countTruncatedEvents(events: unknown[]): number {
  let count = 0;
  for (const event of events) {
    if (hasTruncationMarker(event)) count += 1;
  }
  return count;
}

function hasTruncationMarker(value: unknown, seen = new Set<unknown>()): boolean {
  if (value == null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((child) => hasTruncationMarker(child, seen));
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (/truncat/i.test(key) && Boolean(child)) return true;
    if (hasTruncationMarker(child, seen)) return true;
  }
  return false;
}

/** Évalue le risque de perte de contexte d'une conversation (pur, testable). */
export function assessConversationContext(input: ConversationContextInput): ConversationContextRisk {
  const totalEventCount = input.events?.length ?? 0;
  const truncatedEventCount = totalEventCount > 0 ? countTruncatedEvents(input.events ?? []) : 0;
  const truncationRate = totalEventCount > 0 ? truncatedEventCount / totalEventCount : 0;
  const tokenSource: ConversationContextRisk["tokenSource"] = input.totalTokens != null ? "reported" : "estimated";
  const estimatedTokens = input.totalTokens ?? estimateTokensFromText(input.charCount);

  let level: ContextRiskLevel = "ok";
  const reasons: string[] = [];

  const { warnTokens, criticalTokens, warnTurns, criticalTurns, warnTruncationRate, criticalTruncationRate } = CONTEXT_RISK_THRESHOLDS;

  if (input.turnCount >= criticalTurns) {
    level = maxLevel(level, "critical");
    reasons.push("Nombre de tours très élevé");
  } else if (input.turnCount >= warnTurns) {
    level = maxLevel(level, "warn");
    reasons.push("Nombre de tours élevé");
  }

  if (estimatedTokens >= criticalTokens) {
    level = maxLevel(level, "critical");
    reasons.push(`Volume très élevé (≈ ${formatTokenCount(estimatedTokens)} tokens)`);
  } else if (estimatedTokens >= warnTokens) {
    level = maxLevel(level, "warn");
    reasons.push(`Volume élevé (≈ ${formatTokenCount(estimatedTokens)} tokens)`);
  }

  if (truncationRate >= criticalTruncationRate) {
    level = maxLevel(level, "critical");
    reasons.push(`Beaucoup d'événements tronqués (${Math.round(truncationRate * 100)} %)`);
  } else if (truncationRate >= warnTruncationRate) {
    level = maxLevel(level, "warn");
    reasons.push(`Événements tronqués (${Math.round(truncationRate * 100)} %)`);
  }

  return {
    level,
    turnCount: input.turnCount,
    estimatedTokens,
    tokenSource,
    truncationRate,
    truncatedEventCount,
    reasons
  };
}
