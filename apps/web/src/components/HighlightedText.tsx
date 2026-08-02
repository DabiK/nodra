import { highlightParts } from "../services/conversation-search-service";

interface HighlightedTextProps {
  text: string;
  query: string;
}

/** Texte dont les occurrences de `query` sont enveloppées dans des <mark>. */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  const parts = highlightParts(text, query);
  return (
    <>
      {parts.map((part, index) => part.hit
        ? <mark className="conversation-search-hit" key={index}>{part.text}</mark>
        : <span key={index}>{part.text}</span>)}
    </>
  );
}
