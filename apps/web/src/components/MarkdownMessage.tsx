import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children: linkChildren }) => <a href={href} target="_blank" rel="noreferrer">{linkChildren}</a>
      }}
    >
      {children}
    </Markdown>
  );
}
