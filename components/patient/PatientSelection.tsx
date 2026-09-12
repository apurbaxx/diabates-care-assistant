"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, PlusCircle, Search, Sparkles, Stethoscope } from "lucide-react";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { ageAt } from "@/lib/clinical/derive";
import { GeneratePatientDialog } from "./GeneratePatientDialog";
import { SafetyFooter } from "@/components/shared/SafetyFooter";

export function PatientSelection() {
  const router = useRouter();
  const patients = useAppStore((s) => s.patients);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const [query, setQuery] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);

  useEffect(() => {
    if (hasHydrated) ensureSeeded();
  }, [hasHydrated]);

  const rows = useMemo(() => {
    return patients.map((p) => {
      const engine = runEngine(p);
      const attentionCount = engine.insights.filter((i) => i.severity === "attention").length;
      const watchCount = engine.insights.filter((i) => i.severity === "watch").length;
      return { patient: p, engine, attentionCount, watchCount };
    });
  }, [patients]);

  const filtered = rows.filter(({ patient }) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      patient.name.toLowerCase().includes(q) ||
      patient.mrn.toLowerCase().includes(q) ||
      patient.diabetesType.toLowerCase().includes(q)
    );
  });

  if (!hasHydrated) {
    return <div className="p-8 text-sm text-muted">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gridline bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-6 w-6 text-brand-500" />
            <div>
              <h1 className="text-lg font-semibold text-ink">Diabetes Care Assistant</h1>
              <p className="text-xs text-muted">Clinical decision support for doctors</p>
            </div>
          </div>
          <button
            onClick={() => setShowGenerate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <PlusCircle className="h-4 w-4" /> Generate synthetic patient
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <div className="relative mb-5 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, MRN, or diabetes type…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            No patients match your search.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(({ patient, engine, attentionCount, watchCount }) => {
              const latest = engine.derived.latestVisit;
              return (
                <button
                  key={patient.id}
                  onClick={() => router.push(`/patient/${patient.id}`)}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left transition hover:border-brand-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-semibold text-ink">{patient.name}</div>
                      <div className="text-xs text-muted">
                        {patient.mrn} · {ageAt(patient.dob, new Date().toISOString().slice(0, 10))} · {patient.sex}
                      </div>
                    </div>
                    {attentionCount > 0 ? (
                      <span className="flex items-center gap-1 rounded-full bg-status-critical/10 px-2 py-0.5 text-[11px] font-semibold text-status-critical">
                        <AlertTriangle className="h-3 w-3" /> {attentionCount}
                      </span>
                    ) : watchCount > 0 ? (
                      <span className="rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a5c00]">
                        {watchCount} to watch
                      </span>
                    ) : (
                      <span className="rounded-full bg-status-good/10 px-2 py-0.5 text-[11px] font-semibold text-status-good">
                        Stable
                      </span>
                    )}
                  </div>

                  <div className="text-xs capitalize text-ink-secondary">
                    {patient.diabetesType.replace("-", " ")} · {engine.derived.diabetesDurationYears.toFixed(1)} y
                  </div>

                  <div className="flex gap-3 text-xs">
                    <span className="text-ink-secondary">
                      HbA1c <span className="font-semibold text-ink">{latest?.labs.hba1c?.toFixed(1) ?? "—"}%</span>
                    </span>
                    {engine.derived.ckdStage && (
                      <span className="text-ink-secondary">
                        Kidney <span className="font-semibold text-ink">{engine.derived.ckdStage}</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-start gap-1.5 border-t border-gridline pt-2">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand-400" />
                    <p className="line-clamp-2 text-xs text-ink-secondary">{engine.summary.headline}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <SafetyFooter />

      {showGenerate && (
        <GeneratePatientDialog
          onClose={() => setShowGenerate(false)}
          onCreated={(id) => {
            setShowGenerate(false);
            router.push(`/patient/${id}`);
          }}
        />
      )}
    </div>
  );
}
