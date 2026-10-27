"use client";

import { BookOpen, CircleCheck, Compass, FileText, Search } from "lucide-react";
import { WorkspaceTour, hasSeenWorkspaceTour, type TourStep } from "./WorkspaceTour";

const STORAGE_KEY = "cliniq:knowledge-assistant-tour:v1";

export function hasSeenKnowledgeAssistantTour() {
  return hasSeenWorkspaceTour(STORAGE_KEY);
}

const STEPS: TourStep[] = [
  {
    id: "welcome", icon: Compass, art: "welcome",
    title: "Welcome to Knowledge Assistant",
    description: "Explore how to find relevant information from ClinIQ's medical knowledge resources.",
  },
  {
    id: "question", target: "knowledge-question", icon: BookOpen,
    title: "Ask your question",
    description: "Enter your question here to search the available medical knowledge resources. Answers depend on the information available in the connected sources.",
  },
  {
    id: "search", target: "knowledge-search", icon: Search,
    title: "Find relevant information",
    description: "Use the search action to submit your question and review the information returned by the system.",
  },
  {
    id: "response", target: "knowledge-results", icon: FileText,
    title: "Review the response",
    description: "Read the returned answer carefully. If the service is unavailable, you may see an error instead.",
  },
  {
    id: "sources", target: "knowledge-sources", icon: BookOpen,
    title: "Review the sources",
    description: "When source references are available, use them to check the original material and verify the context.",
  },
  {
    id: "complete", icon: CircleCheck, art: "done",
    title: "You're ready to explore",
    description: "You can reopen this tour whenever you need a reminder of how Knowledge Assistant works.",
  },
];

export function KnowledgeAssistantTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <WorkspaceTour open={open} onClose={onClose} tourSteps={STEPS} storageKey={STORAGE_KEY} keepMissingTargets />;
}
