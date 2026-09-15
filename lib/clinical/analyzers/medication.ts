import type { Insight, MedicationChange } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import {
  labValueEvidence,
  medicationEvidence,
  computationEvidence,
} from "../evidence";
import { monthsBetween } from "../stats";

/**
 * Medication record-review analysis.
 *
 * Two things this deliberately does NOT do:
 *  - it never pairs a medication change with a lab movement as cause and effect —
 *    it states both facts and their dates, nothing more
 *  - it never recommends a specific prescription; it surfaces that a guideline-
 *    indicated class is absent from the current list and leaves the decision with
 *    the clinician
 */
export function analyseMedication(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { visits, trends, derived, patient, activeMedications } = ctx;
  const a1cPoints = trends.hba1c?.points ?? [];

  // --- 1. Response to the most recent dose change -------------------------
  const changeVisits = visits.filter((v) =>
    v.medicationChanges.some((c) => c.type !== "unchanged"),
  );
  const lastChangeVisit = changeVisits[changeVisits.length - 1];

  if (lastChangeVisit) {
    const primaryChange = pickPrimaryChange(lastChangeVisit.medicationChanges);
    const followUps = a1cPoints.filter((p) => p.date > lastChangeVisit.date);
    const before = lastVisitAtOrBefore(a1cPoints, lastChangeVisit.date);
    const after = followUps[followUps.length - 1];

    if (primaryChange && before && after) {
      const delta = after.value - before.value;

      out.push(
        makeInsight({
          scope: "medication",
          kind: "observation",
          severity: "info",
          title: "HbA1c & Medication Record",
          statement:
            `${describeChange(primaryChange)} (${lastChangeVisit.date}). ` +
            `HbA1c: ${before.value.toFixed(1)}% (${before.date}) → ${after.value.toFixed(1)}% (${after.date}) ` +
            `(${delta > 0 ? "+" : ""}${delta.toFixed(1)} percentage points).`,
          evidence: [
            medicationEvidence(
              lastChangeVisit,
              describeChange(primaryChange),
              primaryChange.toDose !== undefined
                ? `${primaryChange.toDose} ${primaryChange.unit ?? ""}`.trim()
                : undefined,
              primaryChange.reason,
            ),
            labValueEvidence("hba1c", before.value, before.date, {
              visitId: before.visitId,
              note: "Recorded before this medication change",
            }),
            labValueEvidence("hba1c", after.value, after.date, {
              visitId: after.visitId,
              note: "Recorded after this medication change",
            }),
          ],
          confidence: "observed",
          parameters: ["hba1c"],
          visitIds: [lastChangeVisit.id, after.visitId].filter(Boolean) as string[],
        }),
      );
    } else if (primaryChange && before && followUps.length === 0) {
      const monthsSince = monthsBetween(lastChangeVisit.date, visits[visits.length - 1].date);
      out.push(
        makeInsight({
          scope: "medication",
          kind: "observation",
          severity: "info",
          title: "Medication & HbA1c Record",
          statement: `${describeChange(primaryChange)} (${lastChangeVisit.date}). No HbA1c has been recorded since; ${monthsSince < 1 ? "less than a month" : `${Math.round(monthsSince)} months`} have elapsed.`,
          evidence: [
            medicationEvidence(lastChangeVisit, describeChange(primaryChange), undefined, primaryChange.reason),
            labValueEvidence("hba1c", before.value, before.date, {
              visitId: before.visitId,
              note: "Most recent HbA1c on record, predating this change",
            }),
          ],
          confidence: "observed",
          parameters: ["hba1c"],
          visitIds: [lastChangeVisit.id],
        }),
      );
    }
  }

  // --- 2. Guideline-indicated class not present ----------------------------
  const hasClass = (c: string) => activeMedications.some((m) => m.medClass === c);
  const lastVisit = visits[visits.length - 1];

  const ckdIndication =
    patient.diabetesType === "type-2" &&
    derived.egfr !== undefined &&
    derived.egfr >= 20 &&
    ((derived.albuminuriaStage && derived.albuminuriaStage !== "A1") ||
      (derived.ckdStage && ["G3a", "G3b", "G4"].includes(derived.ckdStage)));

  if (ckdIndication && !hasClass("sglt2-inhibitor") && lastVisit) {
    out.push(
      makeInsight({
        scope: "medication",
        kind: "flagged-for-review",
        severity: "attention",
        title: "Kidney & Medication Record",
        statement: `eGFR: ${derived.egfr?.toFixed(0)} mL/min/1.73m² (${derived.ckdStage ?? "—"})${derived.albuminuriaStage !== "A1" ? `. UACR: category ${derived.albuminuriaStage}` : ""}. No SGLT2 inhibitor recorded on current medication list.`,
        evidence: [
          ...(derived.egfr !== undefined
            ? [
                labValueEvidence("egfr", derived.egfr, lastVisit.date, {
                  visitId: lastVisit.id,
                  note: `GFR category ${derived.ckdStage}`,
                }),
              ]
            : []),
          ...(lastVisit.labs.uacr !== undefined
            ? [
                labValueEvidence("uacr", lastVisit.labs.uacr, lastVisit.date, {
                  visitId: lastVisit.id,
                  note: `Albuminuria category ${derived.albuminuriaStage}`,
                }),
              ]
            : []),
          medicationEvidence(
            lastVisit,
            "Current glucose-lowering regimen",
            activeMedications
              .filter((m) => isGlucoseLowering(m.medClass))
              .map((m) => `${m.name} ${m.dose}${m.unit}`)
              .join(", ") || "none recorded",
            "No SGLT2 inhibitor present",
          ),
        ],
        guidelines: guidelines("ADA_SGLT2_CKD", "KDIGO_STAGING"),
        confidence: "observed",
        parameters: ["egfr", "uacr"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  const albuminuricNoRas =
    derived.albuminuriaStage &&
    derived.albuminuriaStage !== "A1" &&
    !hasClass("acei") &&
    !hasClass("arb");
  if (albuminuricNoRas && lastVisit) {
    out.push(
      makeInsight({
        scope: "medication",
        kind: "flagged-for-review",
        severity: "watch",
        title: "Kidney & Medication Record",
        statement: `UACR: category ${derived.albuminuriaStage}. No ACE inhibitor or ARB recorded on current medication list.`,
        evidence: [
          ...(lastVisit.labs.uacr !== undefined
            ? [labValueEvidence("uacr", lastVisit.labs.uacr, lastVisit.date, { visitId: lastVisit.id })]
            : []),
          medicationEvidence(
            lastVisit,
            "Current antihypertensive cover",
            activeMedications
              .filter((m) => ["acei", "arb", "ccb", "diuretic", "beta-blocker"].includes(m.medClass))
              .map((m) => m.name)
              .join(", ") || "none recorded",
          ),
        ],
        guidelines: guidelines("KDIGO_RAS_BLOCKADE"),
        confidence: "observed",
        parameters: ["uacr", "systolic"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  const obesityIndication =
    derived.bmi !== undefined &&
    derived.bmi >= 30 &&
    patient.diabetesType === "type-2" &&
    !hasClass("glp1-receptor-agonist");
  if (obesityIndication && lastVisit) {
    out.push(
      makeInsight({
        scope: "medication",
        kind: "observation",
        severity: "watch",
        title: "Weight & Medication Record",
        statement: `BMI: ${derived.bmi?.toFixed(1)} kg/m². No GLP-1 receptor agonist or dual GIP/GLP-1 agonist recorded on current medication list.`,
        evidence: [
          computationEvidence(
            "BMI",
            lastVisit.date,
            `${derived.bmi?.toFixed(1)} kg/m²`,
            `weight ÷ height² = ${lastVisit.vitals.weightKg} kg ÷ (${((lastVisit.vitals.heightCm ?? 0) / 100).toFixed(2)} m)²`,
          ),
          medicationEvidence(
            lastVisit,
            "Current glucose-lowering regimen",
            activeMedications
              .filter((m) => isGlucoseLowering(m.medClass))
              .map((m) => m.name)
              .join(", ") || "none recorded",
          ),
        ],
        guidelines: guidelines("ADA_GLP1_WEIGHT", "ADA_WEIGHT_TARGET"),
        confidence: "observed",
        parameters: ["bmi", "weightKg"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  // --- 4. Cumulative regimen intensification, paired with HbA1c record ----
  const allChanges = visits.flatMap((v) =>
    v.medicationChanges
      .filter((c) => c.type === "increase" || c.type === "start")
      .map((c) => ({ change: c, visit: v })),
  );
  if (allChanges.length >= 3 && a1cPoints.length >= 3) {
    const first = a1cPoints[0];
    const last = a1cPoints[a1cPoints.length - 1];
    if (last.value >= first.value - 0.3) {
      out.push(
        makeInsight({
          scope: "medication",
          kind: "flagged-for-review",
          severity: "watch",
          title: "Medication & HbA1c Record",
          statement: `${allChanges.length} medication changes (start/increase) recorded since ${allChanges[0].visit.date}: ${allChanges.map((c) => describeChange(c.change)).join("; ")}. HbA1c: ${first.value.toFixed(1)}% (${first.date}) → ${last.value.toFixed(1)}% (${last.date}).`,
          evidence: [
            ...allChanges.map((c) =>
              medicationEvidence(
                c.visit,
                describeChange(c.change),
                c.change.toDose !== undefined ? `${c.change.toDose} ${c.change.unit ?? ""}`.trim() : undefined,
                c.change.reason,
              ),
            ),
            labValueEvidence("hba1c", first.value, first.date, { visitId: first.visitId, note: "Earliest in series" }),
            labValueEvidence("hba1c", last.value, last.date, { visitId: last.visitId, note: "Most recent" }),
          ],
          confidence: "observed",
          parameters: ["hba1c"],
          visitIds: allChanges.map((c) => c.visit.id),
        }),
      );
    }
  }

  return out;
}

export function describeChange(c: MedicationChange): string {
  const unit = c.unit ?? "";
  switch (c.type) {
    case "start":
      return `${c.medicationName} started${c.toDose !== undefined ? ` at ${c.toDose} ${unit}`.trimEnd() : ""}`;
    case "stop":
      return `${c.medicationName} stopped`;
    case "increase":
      return `${c.medicationName} increased ${c.fromDose} → ${c.toDose} ${unit}`.trimEnd();
    case "decrease":
      return `${c.medicationName} reduced ${c.fromDose} → ${c.toDose} ${unit}`.trimEnd();
    case "switch":
      return `switched to ${c.medicationName}`;
    default:
      return `${c.medicationName} unchanged`;
  }
}

/** Prefer a glucose-lowering change; otherwise the first non-trivial change. */
function pickPrimaryChange(changes: MedicationChange[]): MedicationChange | undefined {
  const real = changes.filter((c) => c.type !== "unchanged");
  return real.find((c) => isGlucoseLowering(c.medClass)) ?? real[0];
}

const GLUCOSE_LOWERING = new Set([
  "biguanide",
  "sglt2-inhibitor",
  "glp1-receptor-agonist",
  "dpp4-inhibitor",
  "sulfonylurea",
  "thiazolidinedione",
  "basal-insulin",
  "bolus-insulin",
  "premix-insulin",
]);

export function isGlucoseLowering(medClass: string): boolean {
  return GLUCOSE_LOWERING.has(medClass);
}

function lastVisitAtOrBefore<T extends { date: string }>(points: T[], date: string): T | undefined {
  const eligible = points.filter((p) => p.date <= date);
  return eligible[eligible.length - 1];
}

