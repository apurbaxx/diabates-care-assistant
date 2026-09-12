import type { EvidenceRef, LabKey, Visit } from "@/lib/types";
import { parameterMeta } from "./units";

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Reset between engine runs so ids are stable for a given patient render. */
export function resetEvidenceIds() {
  counter = 0;
}

export function measurementEvidence(
  visit: Visit,
  key: LabKey | "weightKg" | "systolic" | "diastolic" | "bmi",
  value: number,
  note?: string,
): EvidenceRef {
  const meta = parameterMeta(key);
  return {
    id: nextId("E"),
    kind: "measurement",
    label: meta.label,
    date: visit.date,
    value: value.toFixed(meta.decimals),
    unit: meta.unit,
    visitId: visit.id,
    note,
  };
}

export function labValueEvidence(
  key: string,
  value: number,
  date: string,
  opts: { visitId?: string; reportId?: string; note?: string } = {},
): EvidenceRef {
  const meta = parameterMeta(key);
  return {
    id: nextId("E"),
    kind: opts.reportId ? "report" : "measurement",
    label: meta.label,
    date,
    value: value.toFixed(meta.decimals),
    unit: meta.unit,
    visitId: opts.visitId,
    reportId: opts.reportId,
    note: opts.note,
  };
}

export function visitEvidence(visit: Visit, note?: string): EvidenceRef {
  return {
    id: nextId("E"),
    kind: "visit",
    label: `Visit — ${visit.reason}`,
    date: visit.date,
    visitId: visit.id,
    note: note ?? visit.clinicianNote,
  };
}

export function medicationEvidence(
  visit: Visit,
  label: string,
  value?: string,
  note?: string,
): EvidenceRef {
  return {
    id: nextId("E"),
    kind: "medication",
    label,
    date: visit.date,
    value,
    visitId: visit.id,
    note,
  };
}

export function computationEvidence(
  label: string,
  date: string,
  value: string,
  method: string,
  note?: string,
): EvidenceRef {
  return {
    id: nextId("E"),
    kind: "computation",
    label,
    date,
    value,
    method,
    note,
  };
}
