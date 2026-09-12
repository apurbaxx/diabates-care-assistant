"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ARCHETYPE_LIST } from "@/lib/data/archetypes";
import { useAppStore } from "@/lib/store";
import { hashSeedFromString } from "@/lib/data/rng";

export function GeneratePatientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [archetypeId, setArchetypeId] = useState(ARCHETYPE_LIST[0].id);
  const [years, setYears] = useState(3);
  const [interval, setInterval_] = useState(3);
  const [seedText, setSeedText] = useState("");
  const [name, setName] = useState("");
  const addGeneratedPatient = useAppStore((s) => s.addGeneratedPatient);

  function create() {
    const seed = seedText.trim() ? hashSeedFromString(seedText.trim()) : Math.floor(Math.random() * 1_000_000);
    const patient = addGeneratedPatient({
      archetypeId,
      years,
      visitIntervalMonths: interval,
      seed,
      name: name.trim() || undefined,
    });
    onCreated(patient.id);
  }

  const selected = ARCHETYPE_LIST.find((a) => a.id === archetypeId)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Generate a synthetic patient</h2>
            <p className="text-sm text-muted">
              For demonstration and testing only. Reproducible from the same seed.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted hover:bg-page">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Clinical archetype</label>
            <select
              value={archetypeId}
              onChange={(e) => setArchetypeId(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              {ARCHETYPE_LIST.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">{selected.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Years of history</label>
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={years}
                onChange={(e) => setYears(parseFloat(e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Visit interval (months)</label>
              <input
                type="number"
                min={1}
                max={12}
                value={interval}
                onChange={(e) => setInterval_(parseInt(e.target.value, 10))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Patient name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated if left blank"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Seed (optional, for reproducibility)</label>
            <input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder="Leave blank for a random patient"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-ink-secondary">
            Cancel
          </button>
          <button onClick={create} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white">
            Generate patient
          </button>
        </div>
      </div>
    </div>
  );
}
