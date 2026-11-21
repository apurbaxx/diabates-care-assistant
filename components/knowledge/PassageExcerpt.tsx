import type { ReactNode } from "react";
import type { PassageResult } from "../../lib/knowledge/search";

export function PassageExcerpt({ passage, className }: {
  passage: Pick<PassageResult, "text" | "citation_superscripts">;
  className?: string;
}) {
  const { text, citation_superscripts: citations = [] } = passage;
  if (!text) return null;

  let paragraphStart = 0;
  return [...text.matchAll(/\n{2,}|\r\n\r\n/g), { index: text.length, 0: "" }].map(separator => {
    const paragraphEnd = separator.index;
    const nodes: ReactNode[] = [];
    let cursor = paragraphStart;
    for (const [start, end] of citations) {
      if (start < cursor || end > paragraphEnd || start >= end) continue;
      nodes.push(text.slice(cursor, start), <sup key={start}>{text.slice(start, end)}</sup>);
      cursor = end;
    }
    nodes.push(text.slice(cursor, paragraphEnd));
    const paragraph = <p key={paragraphStart} className={className}>{nodes}</p>;
    paragraphStart = paragraphEnd + separator[0].length;
    return paragraph;
  });
}
