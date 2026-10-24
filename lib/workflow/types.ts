import type { EvidenceRef } from "@/lib/types";

export interface Appointment {
  id: string;
  patientId: string;
  startsAt: string;
  reason: string;
  status: "scheduled" | "arrived" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowTask {
  id: string;
  patientId: string;
  sourceId: string;
  kind: "report" | "summary" | "documentation";
  title: string;
  status: "pending" | "in-progress" | "completed";
  createdAt: string;
  updatedAt: string;
}
export interface SummarySection {
  id: string;
  title: string;
  text: string;
  origin: "recorded" | "computed" | "clinician";
  sources: EvidenceRef[];
}
export interface VisitSummary {
  id: string;
  patientId: string;
  visitId: string;
  visitDate: string;
  status: "draft" | "pending-review" | "approved";
  sections: SummarySection[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  approvedAt?: string;
  approvedBy?: string;
  audit: { at: string; actor: string; action: string }[];
}
export type TimelineType = "visit" | "laboratory" | "medication" | "report-upload" | "report-verified" | "note" | "observation" | "summary";
export interface ClinicalEvent {
  id: string;
  patientId: string;
  type: TimelineType;
  timestamp: string;
  title: string;
  details: string;
  source: { kind: "visit" | "report" | "medication" | "observation" | "summary"; id: string; visitId?: string; parameter?: string };
}
