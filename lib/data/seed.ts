import type { Patient } from "@/lib/types";
import { generatePatient } from "./generator";

/**
 * A fixed demo cohort so the app is useful on first load without the doctor
 * having to generate anything. One patient per archetype, fixed seeds so the
 * data is stable across sessions (until the doctor resets it).
 */
const SEED_SPECS: { archetypeId: string; seed: number; name: string; years: number; interval: number }[] = [
  { archetypeId: "well-controlled-t2d", seed: 1001, name: "Margaret Chen", years: 3, interval: 4 },
  { archetypeId: "worsening-control", seed: 1002, name: "Robert Alonso", years: 3, interval: 3 },
  { archetypeId: "diabetic-nephropathy-progression", seed: 1003, name: "David Okafor", years: 4, interval: 4 },
  { archetypeId: "newly-diagnosed-t2d", seed: 1004, name: "Priya Sharma", years: 1.5, interval: 2 },
  { archetypeId: "t1d-variable", seed: 1005, name: "Sarah Nilsson", years: 3, interval: 3 },
  { archetypeId: "elderly-deintensification", seed: 1006, name: "George Papadopoulos", years: 3, interval: 4 },
  { archetypeId: "obesity-glp1-responder", seed: 1007, name: "Elena Rossi", years: 2, interval: 3 },
  { archetypeId: "therapeutic-inertia", seed: 1008, name: "Ahmed Hassan", years: 2.5, interval: 4 },
];

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
