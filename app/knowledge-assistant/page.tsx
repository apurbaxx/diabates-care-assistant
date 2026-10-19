import type { Metadata } from "next";
import { KnowledgeExplorer } from "@/components/knowledge/KnowledgeExplorer";

export const metadata: Metadata = {
  title: "Medical Guideline Knowledge Explorer | ClinIQ",
  description:
    "Evidence-based guideline retrieval engine for diabetes care — surfaces original text, verified citations, and official links from ADA and RSSDI standards of care.",
};

export default function KnowledgeAssistantPage() {
  return <KnowledgeExplorer />;
}
