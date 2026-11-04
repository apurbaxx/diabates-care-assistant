import type { EvidenceRef, Insight, MedicationChange } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { medicationEvidence } from "../evidence";
import { pointEvidence } from "../record";
import { formatWithUnit, parameterMeta } from "../units";

const RECORD_GROUPS = [
  { title: "Glucose measurements & medication history", keys: ["hba1c", "fastingGlucose", "postprandialGlucose", "randomGlucose"] },
  { title: "Kidney measurements & medication history", keys: ["egfr", "creatinine", "uacr", "potassium"] },
  { title: "Weight measurements & medication history", keys: ["weightKg", "bmi"] },
  { title: "Lipid measurements & medication history", keys: ["ldl", "hdl", "triglycerides"] },
];

/** Deterministic record summaries; no treatment criteria or effectiveness thresholds. */
export function analyseMedication(ctx: AnalysisContext): Insight[] {
  const { visits, series, activeMedications } = ctx;
  if (!visits.length) return [];

  const changes = visits.flatMap(visit => visit.medicationChanges
    .filter(change => change.type !== "unchanged")
    .map(change => ({ visit, change })));
  // A report-only visit cannot establish a medication list.
  const medicationVisit = [...visits].reverse().find(visit => !visit.sourceReportId && !visit.id.includes("-v-report-"));
  const latestChange = changes.at(-1);
  const medicationSummary = activeMedications.length && medicationVisit
    ? `Medication list (${medicationVisit.date}): ${activeMedications.map(m => `${m.name} ${m.dose} ${m.unit} ${m.frequency}`).join("; ")}.`
    : medicationVisit
      ? `Medication list (${medicationVisit.date}): no active medications recorded.`
      : "No medication list documented in the available visits.";
  const changeSummary = latestChange
    ? `Latest documented medication changes (${latestChange.visit.date}): ${changes.filter(c => c.visit.id === latestChange.visit.id).map(c => describeChange(c.change)).join("; ")}.`
    : "No medication changes documented in the available visits.";
  const history = changes.map(({ visit, change }) => `${visit.date}: ${describeChange(change)}`).join("\n");
  const detail = "Medication history and measurements are separate record summaries. Timing alone does not establish causation or treatment effectiveness."
    + (history ? `\n\nDocumented medication history:\n${history}` : "");
  const medicationSources = (): EvidenceRef[] => [
    ...(medicationVisit ? [medicationEvidence(medicationVisit, "Documented medication list", activeMedications
      .map(m => `${m.name} ${m.dose} ${m.unit} ${m.frequency}`).join("; ") || "No active medications recorded")] : []),
    ...changes.map(({ visit, change }) => medicationEvidence(visit, describeChange(change))),
  ];

  const observations: Insight[] = [];
  for (const group of RECORD_GROUPS) {
    const recorded = group.keys.filter(key => series[key]?.length);
    if (!recorded.length) continue;
    const measurements = recorded.flatMap(key => series[key]);
    const laboratorySummary = recorded.map(key => {
      const points = series[key];
      const first = points[0];
      const last = points[points.length - 1];
      return points.length > 1
        ? `${parameterMeta(key).label} changed from ${formatWithUnit(key, first.value)} (${first.date}) to ${formatWithUnit(key, last.value)} (${last.date}); ${points.length} measurements recorded.`
        : `${parameterMeta(key).label}: ${formatWithUnit(key, last.value)} (${last.date}); one measurement recorded.`;
    }).join(" ");
    observations.push(makeInsight({
      scope: "medication", kind: "observation", severity: "info", confidence: "observed",
      title: group.title,
      statement: `Recorded measurements: ${laboratorySummary}\n\n${medicationSummary}\n${changeSummary}`,
      detail,
      evidence: [
        ...recorded.flatMap(key => series[key].map(point => pointEvidence(key, point))),
        ...medicationSources(),
      ],
      parameters: recorded,
      visitIds: [...new Set([...measurements.map(p => p.visitId), medicationVisit?.id, ...changes.map(c => c.visit.id)].filter((id): id is string => !!id))],
    }));
  }
  if (!observations.length && (medicationVisit || changes.length)) {
    observations.push(makeInsight({
      scope: "medication", kind: "observation", severity: "info", confidence: "observed",
      title: "Documented medication history",
      statement: `${medicationSummary}\n${changeSummary}\n\nNo laboratory or weight measurements recorded for comparison.`,
      detail, evidence: medicationSources(),
      visitIds: [...new Set([medicationVisit?.id, ...changes.map(c => c.visit.id)].filter((id): id is string => !!id))],
    }));
  }
  return observations;
}

export function describeChange(c: MedicationChange): string {
  const unit = c.unit ?? "";
  switch (c.type) {
    case "start":
      return `${c.medicationName} started${c.toDose !== undefined ? ` at ${c.toDose} ${unit}`.trimEnd() : ""}`;
    case "stop":
      return `${c.medicationName} stopped`;
    case "increase":
    case "decrease": {
      const action = c.type === "increase" ? "increased" : "reduced";
      const dose = c.fromDose !== undefined && c.toDose !== undefined
        ? ` ${c.fromDose} → ${c.toDose} ${unit}`
        : c.toDose !== undefined ? ` to ${c.toDose} ${unit}` : " (dose not recorded)";
      return `${c.medicationName} ${action}${dose}`.trimEnd();
    }
    case "switch":
      return `switched to ${c.medicationName}${c.toDose !== undefined ? ` at ${c.toDose} ${unit}`.trimEnd() : ""}`;
    default:
      return `${c.medicationName} unchanged`;
  }
}
