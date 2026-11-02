import type { Patient } from "@/lib/types";
import { generatePatient, localizeGeneratedPatientName } from "./generator";

/**
 * A fixed demo cohort so the app is useful on first load without the doctor
 * having to generate anything. One patient per archetype, fixed seeds so the
 * data is stable across sessions (until the doctor resets it).
 */
const SEED_SPECS: { archetypeId: string; seed: number; name: string; legacyName?: string; years: number; interval: number }[] = [
  { archetypeId: "well-controlled-t2d", seed: 1001, name: "Meera Iyer", legacyName: "Margaret Chen", years: 3, interval: 4 },
  { archetypeId: "worsening-control", seed: 1002, name: "Sunita Mehta", legacyName: "Robert Alonso", years: 3, interval: 3 },
  { archetypeId: "diabetic-nephropathy-progression", seed: 1003, name: "Lakshmi Nair", legacyName: "David Okafor", years: 4, interval: 4 },
  { archetypeId: "newly-diagnosed-t2d", seed: 1004, name: "Priya Sharma", years: 1.5, interval: 2 },
  { archetypeId: "t1d-variable", seed: 1005, name: "Ananya Rao", legacyName: "Sarah Nilsson", years: 3, interval: 3 },
  { archetypeId: "elderly-deintensification", seed: 1006, name: "Savitri Deshmukh", legacyName: "George Papadopoulos", years: 3, interval: 4 },
  { archetypeId: "obesity-glp1-responder", seed: 1007, name: "Vikram Reddy", legacyName: "Elena Rossi", years: 2, interval: 3 },
  { archetypeId: "therapeutic-inertia", seed: 1008, name: "Arjun Patel", legacyName: "Ahmed Hassan", years: 2.5, interval: 4 },
];

export function localizeStoredPatientName(patient: Patient): Patient {
  const spec=SEED_SPECS.find(s=>patient.archetype===s.archetypeId && patient.seed===s.seed && patient.id===`p-${s.archetypeId}-${s.seed}` && patient.name===s.legacyName);
  return spec ? {...patient,name:spec.name} : localizeGeneratedPatientName(patient);
}

export function buildSeedCohort(): Patient[] {
  return SEED_SPECS.map((s) =>
    generatePatient({
      archetypeId: s.archetypeId,
      years: s.years,
      visitIntervalMonths: s.interval,
      seed: s.seed,
      name: s.name,
    }),
  );
}
