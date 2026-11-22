import type { GeneticHistory } from "./types";

export function hasGeneticHistory(history: GeneticHistory | undefined): history is GeneticHistory {
  return !!history && (
    history.status === "none-known" ||
    !!history.familyHistory?.length ||
    !!history.knownGeneticConditions?.some(condition => condition.trim()) ||
    !!history.notes?.trim()
  );
}
