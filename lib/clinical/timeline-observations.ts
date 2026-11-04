import type { EvidenceRef, Insight, ParameterSeriesPoint, Visit } from "@/lib/types";
import { albuminuriaStage } from "./derive";
import { describeChange } from "./analyzers/medication";
import { pointEvidence } from "./record";
import { formatWithUnit, parameterMeta } from "./units";

const TOPICS: { id: string; title: string; parameters: string[] }[] = [
  { id: "hba1c", title: "HbA1c trend", parameters: ["hba1c"] },
  { id: "glucose", title: "Blood glucose observations", parameters: ["fastingGlucose", "postprandialGlucose", "randomGlucose"] },
  { id: "kidney", title: "Kidney measurements", parameters: ["egfr", "creatinine", "potassium", "sodium"] },
  { id: "uacr", title: "UACR observations", parameters: ["uacr"] },
  { id: "weight", title: "Weight & BMI observations", parameters: ["weightKg", "bmi", "heightCm"] },
  { id: "bp", title: "Blood pressure observations", parameters: ["systolic", "diastolic"] },
  { id: "lipids", title: "Lipid measurements", parameters: ["ldl", "hdl", "triglycerides"] },
];

/** Analyzer scope and title are not identities: several analyzers cover the same record data. */
function groupSources(insights: Insight[]): Insight[] {
  const groups = new Map<string, Insight>();
  function collect(id: string, title: string, source: Insight, parameters: string[], medication = false) {
    let group = groups.get(id);
    if (!group) {
      group = { ...source, id: `timeline:${id}`, title, scope: medication ? "medication" : "trend", parameters: [], visitIds: [], evidence: [] };
      groups.set(id, group);
    }
    group.parameters = [...new Set([...group.parameters, ...parameters])].sort();
    group.visitIds = [...new Set([...group.visitIds, ...source.visitIds])].sort();
    // Only the presence of medication evidence is needed; record data is rebuilt below.
    if (medication && !group.evidence.length) group.evidence = source.evidence.filter(e => e.kind === "medication").slice(0, 1);
  }
  for (const insight of insights) {
    for (const key of insight.parameters) {
      const topic = TOPICS.find(topic => topic.parameters.includes(key));
      collect(topic?.id ?? `parameter:${key}`, topic?.title ?? `${parameterMeta(key).label} observations`, insight, [key]);
    }
    const medication = insight.evidence.some(e => e.kind === "medication");
    if (medication) collect("medications", "Documented medication history", insight, [], true);
    if (!insight.parameters.length && !medication) collect("visits", "Documented visit dates", insight, []);
  }
  return [...groups.values()];
}

/** Timeline presentation uses source data, never an analyzer's clinical interpretation. */
export function timelineObservations(
  insights: Insight[],
  visits: Visit[],
  series: Record<string, ParameterSeriesPoint[]>,
): Insight[] {
  return groupSources(insights).flatMap(insight => {
    const linkedVisits = visits.filter(v => insight.visitIds.includes(v.id)).sort((a, b) => a.date.localeCompare(b.date));
    const statements: string[] = [];
    const evidence: EvidenceRef[] = [];
    const recorded: string[] = [];
    let uacrChange: string | undefined;

    for (const key of insight.parameters) {
      const seen = new Set<string>();
      const points = (series[key] ?? []).filter(p => {
        if (!p.visitId || !insight.visitIds.includes(p.visitId)) return false;
        const identity = JSON.stringify([p.visitId, p.reportId, p.date, p.value, p.method]);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!points.length) continue;
      recorded.push(key);
      const first = points[0];
      const last = points[points.length - 1];
      const label = parameterMeta(key).label;
      statements.push(points.length > 1
        ? `${label} changed from ${formatWithUnit(key, first.value)} (${first.date}) to ${formatWithUnit(key, last.value)} (${last.date}) across ${points.length} recorded measurements.`
        : `${label}: ${formatWithUnit(key, last.value)} (${last.date}).`);
      evidence.push(...points.map(point => pointEvidence(key, point)));
      // Category codes describe the two recorded values; no confirmation or management rule.
      if (key === "uacr" && points.length > 1) {
        const previous = points[points.length - 2];
        const from = albuminuriaStage(previous.value);
        const to = albuminuriaStage(last.value);
        if (from !== to) uacrChange = `UACR category change: ${from} → ${to}`;
      }
    }

    if (insight.evidence.some(e => e.kind === "medication")) {
      const medicationVisits = linkedVisits.filter(v => !v.sourceReportId && !v.id.includes("-v-report-"));
      const latest = medicationVisits.at(-1);
      if (latest) {
        const medications = latest.medications.filter(m => m.startDate <= latest.date && (!m.endDate || m.endDate > latest.date));
        const list = medications.map(m => `${m.name} ${m.dose} ${m.unit} ${m.frequency}`).join("; ") || "No active medications recorded";
        statements.push(`Documented medication list (${latest.date}): ${list}.`);
        // Retain every dated snapshot, even if no explicit dose-change event was recorded.
        evidence.push(...medicationVisits.map(visit => ({
          id: `${insight.id}:medications:${visit.id}`, kind: "medication" as const, label: "Documented medication list", date: visit.date, visitId: visit.id,
          value: visit.medications.filter(m => m.startDate <= visit.date && (!m.endDate || m.endDate > visit.date))
            .map(m => `${m.name} ${m.dose} ${m.unit} ${m.frequency}`).join("; ") || "No active medications recorded",
        })));
      }
      for (const visit of medicationVisits) {
        for (const change of visit.medicationChanges.filter(c => c.type !== "unchanged")) {
          const description = describeChange(change);
          statements.push(`Medication history (${visit.date}): ${description}.`);
          evidence.push({ id: `${insight.id}:change:${visit.id}:${change.id}`, kind: "medication", label: description, date: visit.date, visitId: visit.id });
        }
      }
    }

    if (!statements.length && linkedVisits.length && insight.id === "timeline:visits") {
      const dates = linkedVisits.map(v => v.date);
      statements.push(`Recorded visit dates: ${dates.join(", ")}.`);
      evidence.push(...linkedVisits.map(v => ({ id: `${insight.id}:visit:${v.id}`, kind: "visit" as const, label: "Visit record", date: v.date, visitId: v.id })));
    }
    if (!evidence.length) return [];

    const title = uacrChange ?? insight.title;
    return [{
      ...insight,
      title,
      statement: statements.join("\n\n"),
      detail: undefined,
      evidence,
      guidelines: [],
      kind: "observation" as const,
      severity: "info" as const,
      confidence: "observed" as const,
      parameters: recorded,
    }];
  });
}
