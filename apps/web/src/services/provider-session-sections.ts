import type { ProviderSessionDetailView } from "../types";

export interface ProviderSessionSection {
  turn: ProviderSessionDetailView["snapshot"]["turns"][number] | null;
  items: ProviderSessionDetailView["snapshot"]["items"][number][];
}

export function providerSessionSections(
  turns: ProviderSessionDetailView["snapshot"]["turns"],
  items: ProviderSessionDetailView["snapshot"]["items"]
): ProviderSessionSection[] {
  const turnsById = new Map(turns.map((turn) => [turn.externalTurnId, turn]));
  const ordered = [...items].sort((a, b) => a.order - b.order);
  const sections: ProviderSessionSection[] = [];
  const seenTurns = new Set<string>();
  for (const item of ordered) {
    if (item.externalTurnId) seenTurns.add(item.externalTurnId);
    const current = sections[sections.length - 1];
    if (!current || current.turn?.externalTurnId !== item.externalTurnId) {
      sections.push({ turn: item.externalTurnId ? turnsById.get(item.externalTurnId) ?? null : null, items: [item] });
    } else {
      current.items.push(item);
    }
  }
  for (const turn of turns) {
    if (!seenTurns.has(turn.externalTurnId)) sections.push({ turn, items: [] });
  }
  return sections;
}
