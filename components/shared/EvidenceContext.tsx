"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Insight } from "@/lib/types";
import { EvidenceDrawer } from "./EvidenceDrawer";

interface EvidenceContextValue {
  openInsight: (insight: Insight) => void;
  close: () => void;
}

const EvidenceContext = createContext<EvidenceContextValue | undefined>(undefined);

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [insight, setInsight] = useState<Insight | undefined>(undefined);

  const value = useMemo<EvidenceContextValue>(
    () => ({
      openInsight: (i) => setInsight(i),
      close: () => setInsight(undefined),
    }),
    [],
  );

  return (
    <EvidenceContext.Provider value={value}>
      {children}
      <EvidenceDrawer insight={insight} onClose={() => setInsight(undefined)} />
    </EvidenceContext.Provider>
  );
}

export function useEvidence(): EvidenceContextValue {
  const ctx = useContext(EvidenceContext);
  if (!ctx) throw new Error("useEvidence must be used within an EvidenceProvider");
  return ctx;
}
