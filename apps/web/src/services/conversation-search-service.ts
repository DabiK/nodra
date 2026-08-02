/**
 * Recherche client dans les fils de conversation (issue #9).
 *
 * Chaque élément du fil expose une liste de champs recherchables (texte du
 * message, nom d'outil, sortie de tool call, événements…). Les correspondances
 * sont calculées littéralement — insensible à la casse, sans expression
 * régulière — pour accepter n'importe quelle saisie, puis découpées en
 * segments (hit / non-hit) pour le surlignage.
 */

export interface SearchableMessage {
  /** Identifiant stable de l'élément (permet de cibler son nœud DOM). */
  id: string;
  /** Champs textuels recherchables (null / undefined / "" ignorés). */
  fields: Array<string | null | undefined>;
}

export interface SearchMatch {
  messageId: string;
  /** Texte complet du champ où la correspondance a été trouvée. */
  text: string;
  start: number;
  end: number;
}

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** Toutes les occurrences (par message, par champ) de la requête. */
export function findMatches(query: string, messages: SearchableMessage[]): SearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches: SearchMatch[] = [];
  for (const message of messages) {
    for (const field of message.fields) {
      if (!field) continue;
      const haystack = field.toLocaleLowerCase();
      let from = 0;
      while (from < haystack.length) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) break;
        matches.push({ messageId: message.id, text: field, start: index, end: index + needle.length });
        from = index + needle.length;
      }
    }
  }
  return matches;
}

/** Découpe un texte en segments surlignables autour des occurrences. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !text) return [{ text, hit: false }];
  const haystack = text.toLocaleLowerCase();
  const parts: HighlightPart[] = [];
  let from = 0;
  while (from < text.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    if (index > from) parts.push({ text: text.slice(from, index), hit: false });
    parts.push({ text: text.slice(index, index + needle.length), hit: true });
    from = index + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}
