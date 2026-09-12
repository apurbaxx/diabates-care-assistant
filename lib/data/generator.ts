import type {
  Comorbidity,
  Medication,
  MedicationChange,
  Patient,
  Sex,
  Visit,
} from "@/lib/types";
import { ARCHETYPES, type Checkpoint } from "./archetypes";
import { mulberry32, randInt, randRange, gaussian, clamp, pick, hashSeedFromString, type Rng } from "./rng";
import { ckdEpi2021, ageAt } from "@/lib/clinical/derive";

const FIRST_NAMES_M = ["James", "Robert", "Michael", "David", "Arun", "Wei", "Carlos", "Ahmed", "Peter", "George"];
const FIRST_NAMES_F = ["Mary", "Patricia", "Linda", "Priya", "Fatima", "Elena", "Sarah", "Grace", "Nina", "Olivia"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Kumar", "Chen", "Garcia", "Khan", "Rossi", "Mueller", "Okafor"];

export interface GenerateOptions {
  archetypeId: string;
  years: number;
  visitIntervalMonths: number;
  seed: number;
  name?: string;
  patientIndex?: number;
}

function interpolateCheckpoints(checkpoints: Checkpoint[], t: number): Checkpoint {
  const sorted = [...checkpoints].sort((a, b) => a.at - b.at);
  if (t <= sorted[0].at) return sorted[0];
  if (t >= sorted[sorted.length - 1].at) return sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.at && t <= b.at) {
      const frac = (t - a.at) / (b.at - a.at || 1);
      const lerp = (ka?: number, kb?: number) =>
        ka !== undefined && kb !== undefined ? ka + (kb - ka) * frac : ka ?? kb;
      return {
        at: t,
        hba1c: lerp(a.hba1c, b.hba1c),
        weightKg: lerp(a.weightKg, b.weightKg),
        sbp: lerp(a.sbp, b.sbp),
        dbp: lerp(a.dbp, b.dbp),
        creatinine: lerp(a.creatinine, b.creatinine),
        uacr: lerp(a.uacr, b.uacr),
        ldl: lerp(a.ldl, b.ldl),
      };
    }
  }
  return sorted[sorted.length - 1];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function generatePatient(opts: GenerateOptions): Patient {
  const archetype = ARCHETYPES[opts.archetypeId];
  if (!archetype) throw new Error(`Unknown archetype: ${opts.archetypeId}`);
  const rng = mulberry32(opts.seed);

  const sex: Sex = archetype.sexBias ?? (rng() > 0.5 ? "male" : "female");
  const name = opts.name ?? generateName(rng, sex, opts.patientIndex);
  const age = randInt(rng, archetype.ageRange[0], archetype.ageRange[1]);
  const diagnosisYearsAgo = randRange(rng, archetype.diagnosisYearsAgoRange[0], archetype.diagnosisYearsAgoRange[1]);

  const now = new Date();
  const dob = new Date(now);
  dob.setFullYear(dob.getFullYear() - age);
  dob.setMonth(randInt(rng, 0, 11));
  dob.setDate(randInt(rng, 1, 28));

  const diagnosisDate = new Date(now);
  diagnosisDate.setFullYear(diagnosisDate.getFullYear() - Math.floor(diagnosisYearsAgo));

  const heightCm = randRange(rng, archetype.baseHeightRange[0], archetype.baseHeightRange[1]);

  const totalVisits = Math.max(3, Math.round((opts.years * 12) / opts.visitIntervalMonths) + 1);

  // Timeline start = totalVisits back from "today", with jitter per interval.
  const visitDates: Date[] = [];
  const start = new Date(now);
  start.setMonth(start.getMonth() - opts.visitIntervalMonths * (totalVisits - 1));
  for (let i = 0; i < totalVisits; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + opts.visitIntervalMonths * i);
    d.setDate(d.getDate() + randInt(rng, -6, 6));
    visitDates.push(d);
  }

  const patientId = `p-${opts.archetypeId}-${opts.seed}`;

  const visits: Visit[] = [];
  const activeMeds = new Map<string, Medication>();
  let medIdCounter = 0;

  for (let i = 0; i < totalVisits; i++) {
    const t = i / (totalVisits - 1);
    const cp = interpolateCheckpoints(archetype.checkpoints, t);
    const visitDate = isoDate(visitDates[i]);

    // Per-visit noise, correlated with archetype-specific variance.
    const hba1c = cp.hba1c !== undefined ? clamp(gaussian(rng, cp.hba1c, 0.15), 5, 14) : undefined;
    const weightKg = cp.weightKg !== undefined ? clamp(gaussian(rng, cp.weightKg, 0.8), 40, 200) : undefined;
    const sbp = cp.sbp !== undefined ? clamp(Math.round(gaussian(rng, cp.sbp, 4)), 90, 200) : undefined;
    const dbp = cp.dbp !== undefined ? clamp(Math.round(gaussian(rng, cp.dbp, 3)), 55, 120) : undefined;
    const creatinine = cp.creatinine !== undefined ? clamp(gaussian(rng, cp.creatinine, 0.03), 0.4, 6) : undefined;
    const uacr = cp.uacr !== undefined ? clamp(Math.round(gaussian(rng, cp.uacr, cp.uacr * 0.15)), 3, 3000) : undefined;
    const ldl = cp.ldl !== undefined ? clamp(Math.round(gaussian(rng, cp.ldl, 6)), 30, 220) : undefined;

    // Glucose derived from HbA1c (via eAG) with plausible fasting-vs-mean offset + noise.
    const fastingGlucose = hba1c !== undefined
      ? clamp(Math.round((28.7 * hba1c - 46.7) * randRange(rng, 0.75, 0.95) + gaussian(rng, 0, 8)), 65, 350)
      : undefined;

    const hemoglobin = clamp(gaussian(rng, sex === "female" ? 13.2 : 14.5, 0.6), 9, 17);
    const potassium = clamp(gaussian(rng, 4.3, 0.25), 3.2, 5.8);
    const hdl = clamp(Math.round(gaussian(rng, sex === "female" ? 55 : 45, 6)), 25, 90);
    const triglycerides = clamp(Math.round(gaussian(rng, 140, 30)), 50, 500);

    // eGFR computed from creatinine using the same method the app uses elsewhere,
    // so the synthetic record is internally consistent with the derivation logic.
    const egfr = creatinine !== undefined
      ? ckdEpi2021(creatinine, ageAt(isoDate(dob), visitDate), sex)
      : undefined;

    // Apply scripted medication events for this visit index.
    const changes: MedicationChange[] = [];
    const eventsHere = archetype.medEvents.filter((e) => e.atVisit === i);
    for (const ev of eventsHere) {
      if (ev.type === "start") {
        medIdCounter += 1;
        const med: Medication = {
          id: `${patientId}-med-${medIdCounter}`,
          name: ev.name,
          medClass: ev.medClass,
          dose: ev.dose,
          unit: ev.unit,
          frequency: ev.frequency,
          startDate: visitDate,
          indication: ev.reason,
        };
        activeMeds.set(ev.name, med);
        changes.push({
          id: `${patientId}-chg-${medIdCounter}`,
          medicationName: ev.name,
          medClass: ev.medClass,
          type: "start",
          toDose: ev.dose,
          unit: ev.unit,
          reason: ev.reason,
        });
      } else if (ev.type === "stop") {
        const existing = activeMeds.get(ev.name);
        if (existing) {
          existing.endDate = visitDate;
          activeMeds.delete(ev.name);
        }
        changes.push({
          id: `${patientId}-chg-${medIdCounter}-${ev.name}`,
          medicationName: ev.name,
          medClass: ev.medClass,
          type: "stop",
          reason: ev.reason,
        });
      } else if (ev.type === "increase" || ev.type === "decrease") {
        const existing = activeMeds.get(ev.name);
        const fromDose = existing?.dose ?? ev.dose;
        if (existing) existing.dose = ev.dose;
        changes.push({
          id: `${patientId}-chg-${medIdCounter}-${ev.name}-${i}`,
          medicationName: ev.name,
          medClass: ev.medClass,
          type: ev.type,
          fromDose,
          toDose: ev.dose,
          unit: ev.unit,
          reason: ev.reason,
        });
      } else if (ev.type === "switch") {
        medIdCounter += 1;
        const med: Medication = {
          id: `${patientId}-med-${medIdCounter}`,
          name: ev.name,
          medClass: ev.medClass,
          dose: ev.dose,
          unit: ev.unit,
          frequency: ev.frequency,
          startDate: visitDate,
          indication: ev.reason,
        };
        activeMeds.set(ev.name, med);
        changes.push({
          id: `${patientId}-chg-${medIdCounter}`,
          medicationName: ev.name,
          medClass: ev.medClass,
          type: "switch",
          toDose: ev.dose,
          unit: ev.unit,
          reason: ev.reason,
        });
      }
    }

    visits.push({
      id: `${patientId}-v${i}`,
      patientId,
      date: visitDate,
      reason: i === 0 ? "Initial visit" : "Routine diabetes follow-up",
      vitals: { weightKg, heightCm, systolic: sbp, diastolic: dbp },
      labs: {
        hba1c: hba1c !== undefined ? Math.round(hba1c * 10) / 10 : undefined,
        fastingGlucose,
        creatinine: creatinine !== undefined ? Math.round(creatinine * 100) / 100 : undefined,
        egfr: egfr !== undefined ? Math.round(egfr) : undefined,
        uacr,
        potassium: Math.round(potassium * 10) / 10,
        ldl,
        hdl,
        triglycerides,
        hemoglobin: Math.round(hemoglobin * 10) / 10,
      },
      medications: Array.from(activeMeds.values()).map((m) => ({ ...m })),
      medicationChanges: changes,
      clinicianNote: pick(rng, archetype.noteTemplates),
    });
  }

  return {
    id: patientId,
    mrn: `MRN-${(opts.seed % 900000) + 100000}`,
    name,
    sex,
    dob: isoDate(dob),
    diabetesType: archetype.diabetesType,
    diagnosisDate: isoDate(diagnosisDate),
    comorbidities: archetype.comorbidities as Comorbidity[],
    allergies: [],
    smoking: pick(rng, ["never", "never", "never", "former", "current"] as const),
    background: `Synthetic patient generated from archetype "${archetype.label}".`,
    hypoglycemiaHistory: !!archetype.hypoglycemiaHistory,
    limitedLifeExpectancy: !!archetype.limitedLifeExpectancy,
    visits,
    labReports: [],
    archetype: archetype.id,
    seed: opts.seed,
  };
}

function generateName(rng: Rng, sex: Sex, index?: number): string {
  const first = pick(rng, sex === "female" ? FIRST_NAMES_F : FIRST_NAMES_M);
  const last = pick(rng, LAST_NAMES);
  return index !== undefined ? `${first} ${last}` : `${first} ${last}`;
}

export function generatePatientFromLabel(
  archetypeId: string,
  years: number,
  visitIntervalMonths: number,
  seedInput: string | number,
  name?: string,
): Patient {
  const seed = typeof seedInput === "number" ? seedInput : hashSeedFromString(seedInput);
  return generatePatient({ archetypeId, years, visitIntervalMonths, seed, name });
}
