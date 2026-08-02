/**
 * Formatage et agrégation des coûts et usages de runs.
 *
 * Le coût est stocké en `costMicros` (micro-dollars) tel que rapporté par le
 * provider ; les helpers convertissent et formatent pour l'affichage, et
 * agrègent les coûts partiels d'une mission ou d'un pipeline.
 */

export type RunUsageKind = "reported" | "estimated" | "unavailable";

const USAGE_KIND_LABEL: Record<RunUsageKind, string> = {
  reported: "rapporté par le provider",
  estimated: "estimé",
  unavailable: "indisponible"
};

/** Libellé français de la provenance d'un coût/tokens. */
export function usageKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return USAGE_KIND_LABEL[kind as RunUsageKind] ?? null;
}

/** Convertit des micro-dollars en dollars. */
export function microsToUsd(costMicros: number | null | undefined): number | null {
  if (costMicros == null) return null;
  return costMicros / 1_000_000;
}

/**
 * Formate un coût en micro-dollars : "$0.0123" sous le dollar, "$12.34" au-delà.
 * Retourne null quand le coût est inconnu.
 */
export function formatCostMicros(costMicros: number | null | undefined): string | null {
  if (costMicros == null) return null;
  const usd = costMicros / 1_000_000;
  const precision = usd >= 1 ? 2 : 4;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision })}`;
}

/** Somme des coûts connus ; null si aucun élément n'a de coût renseigné. */
export function sumCostMicros(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let known = 0;
  for (const value of values) {
    if (value != null) {
      total += value;
      known += 1;
    }
  }
  return known > 0 ? total : null;
}

/** Somme des coûts connus puis formatage "$…" ; null si inconnu. */
export function formatTotalCostMicros(values: Array<number | null | undefined>): string | null {
  return formatCostMicros(sumCostMicros(values));
}

/**
 * Formate un nombre de tokens à la française : "1 234", "12,3 k", "1,2 M".
 * Retourne null quand le compteur est inconnu.
 */
export function formatTokenCount(tokens: number | null | undefined): string | null {
  if (tokens == null) return null;
  if (tokens < 1_000) return tokens.toLocaleString("fr-FR");
  if (tokens < 1_000_000) {
    const rounded = Math.round(tokens / 100) / 10;
    if (rounded >= 1_000) return `${formatMillion(tokens)} M`;
    return `${formatDecimal(rounded)} k`;
  }
  return `${formatMillion(tokens)} M`;
}

function formatDecimal(value: number): string {
  return String(value).replace(".", ",");
}

function formatMillion(tokens: number): string {
  return formatDecimal(Math.round(tokens / 100_000) / 10);
}

/** Somme des tokens d'un run : entrée + sortie + cache (lu et écrit). */
export function runTokenTotal(run: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}): number | null {
  const values = [run.inputTokens, run.outputTokens, run.cacheReadTokens, run.cacheWriteTokens];
  if (values.every((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
