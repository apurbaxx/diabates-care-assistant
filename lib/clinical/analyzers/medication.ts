import type { Insight, MedicationChange, Visit } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import {
  labValueEvidence,
  medicationEvidence,
  visitEvidence,
  computationEvidence,
} from "../evidence";
import { targetNumber } from "../derive";
import { assessCausality } from "../causality";
import { daysBetween, monthsBetween } from "../stats";

/**
 * Medication analysis.
 *
 * Two things this deliberately does NOT do:
 *  - it never says a drug caused an outcome; every drug→outcome statement goes
 *    through assessCausality() and is phrased accordingly
 *  - it never recommends a specific prescription; it surfaces that a guideline-
 *    indicated class is absent and leaves the decision with the clinician
 */
export function analyseMedication(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { visits, trends, derived, patient, activeMedications } = ctx;
  const a1cPoints = trends.hba1c?.points ?? [];
  const target = targetNumber(derived.hba1cTarget);

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
      const verdict = assessCausality({
        change: primaryChange,
        changeVisit: lastChangeVisit,
        parameter: "hba1c",
        outcomeVisit: visits.find((v) => v.id === after.visitId) ?? lastChangeVisit,
        outcomeDelta: delta,
        competingChanges: lastChangeVisit.medicationChanges,
        confounders: detectConfounders(visits, lastChangeVisit.date, after.date),
      });

      const intensified =
        primaryChange.type === "start" || primaryChange.type === "increase";
      const worsenedDespite = intensified && delta > 0.3;

      out.push(
        makeInsight({
          scope: "medication",
          kind: worsenedDespite ? "possible-significance" : "observation",
          severity: worsenedDespite ? "attention" : "info",
          title: worsenedDespite
            ? `HbA1c rose after ${describeChange(primaryChange)}`
            : `HbA1c ${delta < 0 ? "fell" : "changed"} after ${describeChange(primaryChange)}`,
          statement:
            `${describeChange(primaryChange)} at the ${lastChangeVisit.date} visit. ` +
            `HbA1c ${verdict.connective} that change: ${before.value.toFixed(1)} % (${before.date}) → ${after.value.toFixed(1)} % (${after.date}), ` +
            `a change of ${delta > 0 ? "+" : ""}${delta.toFixed(1)} percentage points over ${Math.round(daysBetween(lastChangeVisit.date, after.date))} days.` +
            (worsenedDespite
              ? " The direction is opposite to what an intensification is intended to achieve."
              : ""),
          detail:
            "Causality assessment for this pairing:\n" +
            verdict.checks
              .map((c) => `${c.passed ? "✓" : "✗"} ${c.name} — ${c.detail}`)
              .join("\n") +
            `\n\nConclusion: ${
              verdict.causalLanguageAllowed
                ? "the timing and magnitude are consistent with an effect of this change, but a single-patient observational sequence cannot establish causation."
                : "at least one criterion was not met, so this is reported as a temporal sequence only, not as an effect of the medication."
            }` +
            (worsenedDespite
              ? "\n\nWhen glycaemia worsens after intensification, adherence, diet, intercurrent illness, steroid exposure and progression of beta-cell function are all worth considering before assuming the regimen has failed."
              : ""),
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
              note: "Before the change",
            }),
            labValueEvidence("hba1c", after.value, after.date, {
              visitId: after.visitId,
              note: "After the change",
            }),
            computationEvidence(
              "Causality gate",
              after.date,
              verdict.causalLanguageAllowed ? "All criteria met" : "Not all criteria met",
              "Temporal order → plausible latency → magnitude above noise → no competing intervention → no documented confounder",
              verdict.checks.map((c) => `${c.passed ? "PASS" : "FAIL"}: ${c.name}`).join(" | "),
            ),
          ],
          guidelines: guidelines("ADA_A1C_LAG", "ADA_PHARM_INERTIA"),
          confidence: verdict.confidence,
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
          title: `${describeChange(primaryChange)} — effect not yet measurable`,
          statement: `${describeChange(primaryChange)} on ${lastChangeVisit.date}. No HbA1c has been recorded since; ${monthsSince < 1 ? "less than a month" : `${Math.round(monthsSince)} months`} have elapsed.`,
          detail:
            "HbA1c reflects roughly the preceding 3 months of glycaemia, so a therapy change needs about that long before its full effect is visible.",
          evidence: [
            medicationEvidence(lastChangeVisit, describeChange(primaryChange), undefined, primaryChange.reason),
            labValueEvidence("hba1c", before.value, before.date, {
              visitId: before.visitId,
              note: "Most recent HbA1c, predating the change",
            }),
          ],
          guidelines: guidelines("ADA_A1C_LAG"),
          parameters: ["hba1c"],
          visitIds: [lastChangeVisit.id],
        }),
      );
    }
  }

  // --- 2. Therapeutic inertia ---------------------------------------------
  const aboveTargetVisits = visits.filter(
    (v) => v.labs.hba1c !== undefined && v.labs.hba1c > target,
  );
  if (aboveTargetVisits.length >= 2) {
    const trailing = trailingRun(visits, (v) => v.labs.hba1c === undefined || v.labs.hba1c > target);
    const withoutChange = trailing.filter((v) =>
      v.medicationChanges.every((c) => c.type === "unchanged"),
    );
    if (trailing.length >= 2 && withoutChange.length === trailing.length) {
      const span = monthsBetween(trailing[0].date, trailing[trailing.length - 1].date);
      out.push(
        makeInsight({
          scope: "medication",
          kind: "possible-significance",
          severity: "attention",
          title: `HbA1c above goal at the last ${trailing.length} visits with no regimen change`,
          statement: `HbA1c has been above the individualised goal of ${derived.hba1cTarget.value} at the last ${trailing.length} visits (${trailing
            .map((v) => `${v.labs.hba1c?.toFixed(1)} % on ${v.date}`)
            .join(", ")}) with no start, stop or dose change to the glucose-lowering regimen over ${Math.round(span)} months.`,
          detail:
            "This is the pattern usually described as therapeutic inertia. It is not automatically wrong — a deliberate decision to hold, poor tolerability, patient preference, or an adherence-first approach are all legitimate reasons, and they may simply not be captured in the structured record. Flagged so the reason is explicit rather than implicit.",
          evidence: [
            ...trailing.map((v) =>
              labValueEvidence("hba1c", v.labs.hba1c!, v.date, {
                visitId: v.id,
                note: "Above individualised goal",
              }),
            ),
            ...trailing.map((v) => visitEvidence(v, `No medication change recorded at this visit. Note: ${v.clinicianNote}`)),
          ],
          guidelines: guidelines("ADA_PHARM_INERTIA"),
          confidence: "inferred",
          parameters: ["hba1c"],
          visitIds: trailing.map((v) => v.id),
        }),
      );
    }
  }

  // --- 3. Guideline-indicated class not present ----------------------------
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
        kind: "possible-significance",
        severity: "attention",
        title: "No SGLT2 inhibitor on a regimen where CKD criteria are met",
        statement: `This patient has type 2 diabetes with ${derived.ckdStage ?? "?"}${derived.albuminuriaStage ?? ""} kidney disease (eGFR ${derived.egfr?.toFixed(0)} mL/min/1.73m²${derived.albuminuriaStage !== "A1" ? `, UACR in category ${derived.albuminuriaStage}` : ""}), and no SGLT2 inhibitor appears on the current medication list.`,
        detail:
          "ADA §11 recommends an SGLT2 inhibitor in type 2 diabetes with CKD at eGFR ≥20 with albuminuria, for kidney and cardiovascular protection independent of glycaemic need. Contraindications, prior intolerance, recurrent genital mycotic infection, or a documented patient decision are all reasons this may be appropriate — the record simply does not show one.",
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
        confidence: "inferred",
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
        kind: "possible-significance",
        severity: "watch",
        title: "Albuminuria present without ACE inhibitor or ARB on the list",
        statement: `UACR is in category ${derived.albuminuriaStage} and neither an ACE inhibitor nor an ARB appears on the current medication list.`,
        detail:
          "KDIGO recommends RAS blockade titrated to the highest tolerated dose for diabetes with albuminuria and hypertension. Intolerance, hyperkalaemia, pregnancy potential, or normotension without albuminuria progression may all justify its absence.",
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
        confidence: "inferred",
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
        title: "BMI in the obesity range without a weight-preferential glucose-lowering agent",
        statement: `BMI is ${derived.bmi?.toFixed(1)} kg/m² (${derived.bmiClass}) and the current regimen contains no GLP-1 receptor agonist or dual GIP/GLP-1 agonist.`,
        detail:
          "Where weight management is a treatment goal, ADA §8 prefers agents with high weight-loss efficacy over weight-neutral or weight-gaining ones. Whether weight is a treatment goal for this patient is a clinical and shared decision.",
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
        confidence: "inferred",
        parameters: ["bmi", "weightKg"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  // --- 4. Cumulative regimen intensification without response --------------
  const allChanges = visits.flatMap((v) =>
    v.medicationChanges
      .filter((c) => c.type === "increase" || c.type === "start")
      .map((c) => ({ change: c, visit: v })),
  );
  if (allChanges.length >= 3 && a1cPoints.length >= 3) {
    const first = a1cPoints[0];
    const last = a1cPoints[a1cPoints.length - 1];
    if (last.value >= first.value - 0.3 && last.value > target) {
      out.push(
        makeInsight({
          scope: "medication",
          kind: "possible-significance",
          severity: "watch",
          title: `${allChanges.length} treatment intensifications without a net fall in HbA1c`,
          statement: `The regimen has been intensified ${allChanges.length} times since ${allChanges[0].visit.date}, while HbA1c has moved from ${first.value.toFixed(1)} % to ${last.value.toFixed(1)} % — no net improvement.`,
          detail:
            "A sequence of intensifications without response raises questions that dose escalation alone may not answer: adherence, injection technique where relevant, dietary pattern, an undiagnosed secondary condition, or progression of beta-cell function. This is an observation about the record, not a judgement about the prescribing.",
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
          guidelines: guidelines("ADA_PHARM_INERTIA", "ADA_COMPREHENSIVE_ASSESSMENT"),
          confidence: "associational",
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

function trailingRun(visits: Visit[], pred: (v: Visit) => boolean): Visit[] {
  const run: Visit[] = [];
  for (let i = visits.length - 1; i >= 0; i--) {
    if (pred(visits[i])) run.unshift(visits[i]);
    else break;
  }
  return run.filter((v) => v.labs.hba1c !== undefined);
}

const CONFOUNDER_TERMS = [
  "steroid",
  "prednis",
  "infection",
  "sepsis",
  "hospital",
  "admitted",
  "covid",
  "surgery",
  "fracture",
  "dehydrat",
  "contrast",
  "nsaid",
];

/** Scan clinician notes in the window for documented confounders. */
function detectConfounders(visits: Visit[], fromDate: string, toDate: string): string[] {
  const found: string[] = [];
  for (const v of visits) {
    if (v.date < fromDate || v.date > toDate) continue;
    const note = v.clinicianNote.toLowerCase();
    for (const term of CONFOUNDER_TERMS) {
      if (note.includes(term)) {
        found.push(`${v.date}: "${v.clinicianNote}"`);
        break;
      }
    }
  }
  return found;
}
