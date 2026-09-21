import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import {
  labValueEvidence,
  medicationEvidence,
  computationEvidence,
} from "../evidence";
import { yearsBetween } from "../stats";

/**
 * Safety checks — drug/organ-function mismatches and risk stacking.
 * These are the checks a clinician would run mentally; surfacing them is a
 * reminder, not an instruction.
 */
export function analyseSafety(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { activeMedications, derived, visits, patient } = ctx;
  const lastVisit = visits[visits.length - 1];
  if (!lastVisit) return out;

  const egfr = derived.egfr;
  const metformin = activeMedications.find((m) => m.medClass === "biguanide");

  // --- Metformin and eGFR --------------------------------------------------
  if (metformin && egfr !== undefined) {
    if (egfr < 30) {
      out.push(
        makeInsight({
          scope: "safety",
          kind: "flagged-for-review",
          severity: "attention",
          title: `Metformin active at eGFR ${egfr.toFixed(0)} — below the ADA guideline threshold of 30`,
          statement: `${metformin.name} ${metformin.dose} ${metformin.unit} ${metformin.frequency} is on the active list. eGFR is ${egfr.toFixed(0)} mL/min/1.73m², below the threshold ADA's metformin guidance below addresses.`,
          detail:
            "A repeat measurement distinguishes a reversible change (e.g. volume depletion, acute illness) from a sustained one.",
          evidence: [
            medicationEvidence(
              lastVisit,
              `${metformin.name} active`,
              `${metformin.dose} ${metformin.unit} ${metformin.frequency}`,
              `Started ${metformin.startDate}`,
            ),
            labValueEvidence("egfr", egfr, lastVisit.date, {
              visitId: lastVisit.id,
              note: derived.egfrSource === "computed-ckd-epi-2021" ? "Computed via CKD-EPI 2021" : "Reported by lab",
            }),
          ],
          guidelines: guidelines("ADA_METFORMIN_EGFR"),
          confidence: "inferred",
          parameters: ["egfr"],
          visitIds: [lastVisit.id],
        }),
      );
    } else if (egfr < 45) {
      const maxDose = metformin.dose > 1000;
      out.push(
        makeInsight({
          scope: "safety",
          kind: "flagged-for-review",
          severity: maxDose ? "attention" : "watch",
          title: `Metformin at eGFR ${egfr.toFixed(0)} — within the ADA 30–44 dosing band`,
          statement: `${metformin.name} is dosed at ${metformin.dose} ${metformin.unit} ${metformin.frequency} while eGFR is ${egfr.toFixed(0)} mL/min/1.73m².${maxDose ? " This dose is above what ADA's guidance associates with this eGFR band." : ""}`,
          detail:
            "This eGFR band (30–44) is the range ADA's metformin-dosing guidance specifically addresses (see citation), including a more frequent eGFR-monitoring interval than the annual default.",
          evidence: [
            medicationEvidence(
              lastVisit,
              `${metformin.name} dose`,
              `${metformin.dose} ${metformin.unit} ${metformin.frequency}`,
            ),
            labValueEvidence("egfr", egfr, lastVisit.date, { visitId: lastVisit.id }),
          ],
          guidelines: guidelines("ADA_METFORMIN_EGFR"),
          confidence: "inferred",
          parameters: ["egfr"],
          visitIds: [lastVisit.id],
        }),
      );
    }

    // Long-term metformin and B12
    const yearsOn = yearsBetween(metformin.startDate, lastVisit.date);
    const b12 = lastVisit.labs.vitaminB12;
    const hasNeuropathy = patient.comorbidities.includes("neuropathy");
    const anaemic =
      lastVisit.labs.hemoglobin !== undefined &&
      lastVisit.labs.hemoglobin < (patient.sex === "female" ? 12 : 13.5);
    if (yearsOn >= 4 && b12 === undefined && (hasNeuropathy || anaemic || yearsOn >= 6)) {
      out.push(
        makeInsight({
          scope: "screening",
          kind: "observation",
          severity: "watch",
          title: "No vitamin B12 on record despite long-term metformin",
          statement: `${metformin.name} has been prescribed for ${yearsOn.toFixed(1)} years and no vitamin B12 measurement appears in the record${hasNeuropathy ? ", in a patient with documented neuropathy" : anaemic ? ", in a patient with a low haemoglobin" : ""}.`,
          evidence: [
            medicationEvidence(lastVisit, `${metformin.name} duration`, `${yearsOn.toFixed(1)} years`, `Started ${metformin.startDate}`),
            ...(anaemic && lastVisit.labs.hemoglobin !== undefined
              ? [labValueEvidence("hemoglobin", lastVisit.labs.hemoglobin, lastVisit.date, { visitId: lastVisit.id })]
              : []),
          ],
          guidelines: guidelines("ADA_METFORMIN_B12"),
          parameters: ["vitaminB12"],
          visitIds: [lastVisit.id],
        }),
      );
    }
  }

  // --- SGLT2i and very low eGFR -------------------------------------------
  const sglt2 = activeMedications.find((m) => m.medClass === "sglt2-inhibitor");
  if (sglt2 && egfr !== undefined && egfr < 20) {
    out.push(
      makeInsight({
        scope: "safety",
        kind: "flagged-for-review",
        severity: "watch",
        title: `SGLT2 inhibitor active at eGFR ${egfr.toFixed(0)}`,
        statement: `${sglt2.name} is on the active list at an eGFR of ${egfr.toFixed(0)} mL/min/1.73m², below the ≥20 mL/min/1.73m² threshold referenced in ADA's SGLT2i-in-CKD guidance (cited below).`,
        detail:
          "The ADA-cited initiation threshold for this class is ≥20 mL/min/1.73m² (see citation); the glucose-lowering effect of this class is reported to be minimal at this eGFR.",
        evidence: [
          medicationEvidence(lastVisit, `${sglt2.name} active`, `${sglt2.dose} ${sglt2.unit}`),
          labValueEvidence("egfr", egfr, lastVisit.date, { visitId: lastVisit.id }),
        ],
        guidelines: guidelines("ADA_SGLT2_CKD"),
        confidence: "inferred",
        parameters: ["egfr"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  // --- Hypoglycaemia risk stacking ----------------------------------------
  const su = activeMedications.find((m) => m.medClass === "sulfonylurea");
  const insulin = activeMedications.find((m) =>
    ["basal-insulin", "bolus-insulin", "premix-insulin"].includes(m.medClass),
  );
  if (su && insulin) {
    out.push(
      makeInsight({
        scope: "safety",
        kind: "flagged-for-review",
        severity: "watch",
        title: "Sulfonylurea and insulin prescribed together",
        statement: `${su.name} and ${insulin.name} are both on the active list. Combining a secretagogue with insulin stacks the two highest hypoglycaemia-risk classes.`,
        detail:
          "ADA's guidance discusses hypoglycaemia risk when a secretagogue and insulin are both active (see citation).",
        evidence: [
          medicationEvidence(lastVisit, `${su.name}`, `${su.dose} ${su.unit} ${su.frequency}`),
          medicationEvidence(lastVisit, `${insulin.name}`, `${insulin.dose} ${insulin.unit} ${insulin.frequency}`),
          ...(lastVisit.labs.hba1c !== undefined
            ? [labValueEvidence("hba1c", lastVisit.labs.hba1c, lastVisit.date, { visitId: lastVisit.id })]
            : []),
        ],
        guidelines: guidelines("ADA_HYPO_RISK"),
        confidence: "inferred",
        parameters: ["hba1c"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  // --- Hyperkalaemia watch on RAS blockade --------------------------------
  const ras = activeMedications.find((m) => m.medClass === "acei" || m.medClass === "arb");
  const potassium = lastVisit.labs.potassium;
  if (ras && potassium !== undefined && potassium >= 5.2) {
    out.push(
      makeInsight({
        scope: "safety",
        kind: "flagged-for-review",
        severity: potassium >= 5.5 ? "attention" : "watch",
        title: `Potassium ${potassium.toFixed(1)} mmol/L on ${ras.name}`,
        statement: `Serum potassium is ${potassium.toFixed(1)} mmol/L (${lastVisit.date}) while ${ras.name} is active${egfr !== undefined && egfr < 45 ? ` and eGFR is ${egfr.toFixed(0)}` : ""}.`,
        detail:
          "KDIGO's cited guidance calls for checking creatinine and potassium 2–4 weeks after initiating or up-titrating RAS blockade, and periodically thereafter.",
        evidence: [
          labValueEvidence("potassium", potassium, lastVisit.date, { visitId: lastVisit.id }),
          medicationEvidence(lastVisit, `${ras.name} active`, `${ras.dose} ${ras.unit}`),
          ...(egfr !== undefined
            ? [labValueEvidence("egfr", egfr, lastVisit.date, { visitId: lastVisit.id })]
            : []),
        ],
        guidelines: guidelines("KDIGO_RAS_BLOCKADE"),
        confidence: "inferred",
        parameters: ["potassium", "egfr"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  // --- Duplicate therapeutic class ----------------------------------------
  const classCounts = new Map<string, string[]>();
  for (const m of activeMedications) {
    const names = classCounts.get(m.medClass) ?? [];
    names.push(m.name);
    classCounts.set(m.medClass, names);
  }
  for (const [cls, names] of classCounts) {
    if (names.length > 1 && !["bolus-insulin", "other"].includes(cls)) {
      out.push(
        makeInsight({
          scope: "safety",
          kind: "observation",
          severity: "watch",
          title: `Two agents of the same class active: ${names.join(" + ")}`,
          statement: `${names.join(" and ")} are both on the active medication list and belong to the same therapeutic class (${cls.replace(/-/g, " ")}).`,
          evidence: names.map((n) => medicationEvidence(lastVisit, `${n} active`, undefined, `Class: ${cls}`)),
          parameters: [],
          visitIds: [lastVisit.id],
        }),
      );
    }
  }

  // --- Statin gap ----------------------------------------------------------
  const statin = activeMedications.find((m) => m.medClass === "statin");
  const ldl = lastVisit.labs.ldl;
  if (!statin && derived.ageYears >= 40 && derived.ageYears <= 75) {
    out.push(
      makeInsight({
        scope: "medication",
        kind: "observation",
        severity: "watch",
        title: "No statin on the active list in the 40–75 age band",
        statement: `Patient is ${derived.ageYears} years old with diabetes and no statin appears on the current medication list${ldl !== undefined ? `; most recent LDL-C is ${ldl.toFixed(0)} mg/dL` : ""}.`,
        evidence: [
          computationEvidence("Age at latest visit", lastVisit.date, `${derived.ageYears} years`, `Derived from date of birth ${patient.dob}`),
          ...(ldl !== undefined
            ? [labValueEvidence("ldl", ldl, lastVisit.date, { visitId: lastVisit.id })]
            : []),
          medicationEvidence(
            lastVisit,
            "Lipid-lowering therapy",
            activeMedications.filter((m) => m.medClass === "statin").map((m) => m.name).join(", ") || "none recorded",
          ),
        ],
        guidelines: guidelines("ADA_STATIN"),
        confidence: "inferred",
        parameters: ["ldl"],
        visitIds: [lastVisit.id],
      }),
    );
  }

  return out;
}
