import {
  UserSearch,
  History,
  BrainCircuit,
  ArrowLeftRight,
  Sparkles,
  BookMarked,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

export interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  icon: LucideIcon;
}

export type SectionId = "overview" | "history" | "trends" | "comparison" | "medications" | "labs" | "assistant";

/** Single source of truth for the sidebar nav and the section headings it drives. */
export const SECTIONS: SectionDef[] = [
  { id: "overview", label: "Patient data", description: "Demographics, status and AI summary", icon: UserSearch },
  { id: "history", label: "Patient history", description: "Longitudinal visit record", icon: History },
  { id: "trends", label: "Trends & patterns", description: "Parameter trajectories over time", icon: BrainCircuit },
  { id: "comparison", label: "Test comparison", description: "Previous visit vs. most recent results", icon: ArrowLeftRight },
  { id: "medications", label: "Medication insights", description: "Drug therapy timeline", icon: Sparkles },
  { id: "labs", label: "New labs & evidence", description: "Upload and compare a new report", icon: BookMarked },
  { id: "assistant", label: "AI Assistant", description: "Grounded Q&A assistant", icon: Stethoscope },
];
