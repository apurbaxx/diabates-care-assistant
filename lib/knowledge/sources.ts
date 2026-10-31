import { readFile } from "node:fs/promises";
import path from "node:path";

export interface KnowledgeSource {
  title: string;
  url: string;
  organisation: string;
}

export async function getKnowledgeSources(): Promise<KnowledgeSource[]> {
  const manifest = await readFile(path.join(process.cwd(), "files_needed_for_rag.txt"), "utf8");
  return manifest.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(.*?)\s*:\s*(https?:\/\/\S+)\s*$/);
    if (!match) return [];
    const title = match[1].replace(/^\d+\.\s*/, "").trim();
    const url = new URL(match[2]);
    return [{ title, url: url.href, organisation: url.hostname.endsWith("rssdi.in") ? "RSSDI" : "ADA" }];
  });
}
