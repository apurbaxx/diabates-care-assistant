"use client";

import { useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import sources from "@/lib/knowledge/sources.json";
import styles from "./KnowledgeExplorer.module.css";

// Titles and original URLs copied from the indexed ml-service/data/passages.json.
const groups = [
  { title: "RSSDI Guidelines", prefix: "rssdi-" },
  { title: "ADA Standards of Care", prefix: "ada-" },
];

export function KnowledgeSources() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  return (
    <div className={styles.sources} onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        panel.current?.hidePopover();
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" popoverTarget="knowledge-source-documents"
        aria-expanded={open} aria-controls="knowledge-source-documents" className={styles.sourcesTrigger}>
        Sources ({sources.length}) <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div ref={panel} id="knowledge-source-documents" popover="auto"
        className={styles.sourcesPanel} aria-label="Knowledge Assistant source documents"
        onToggle={event => setOpen(event.newState === "open")}>
        <p className={styles.sourcesIntro}>Original guidelines · Links open in a new tab</p>
        {groups.map(group => (
          <section key={group.prefix} aria-labelledby={`source-group-${group.prefix}`}>
            <h2 id={`source-group-${group.prefix}`}>{group.title}</h2>
            <ul>
              {sources.filter(source => source.id.startsWith(group.prefix)).map(source => (
                <li key={source.id}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    <span>{source.title}</span><ExternalLink size={14} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
