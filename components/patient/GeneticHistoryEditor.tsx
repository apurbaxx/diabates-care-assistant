"use client";

import { Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { FamilyHistoryEntry, GeneticHistory, Patient } from "@/lib/types";
import { hasGeneticHistory } from "@/lib/genetic-history";
import { useAppStore } from "@/lib/store";

export function GeneticHistoryEditor({ patient, close }: { patient: Patient; close: (saved: boolean) => void }) {
  const initial = patient.geneticHistory;
  const updateHistory = useAppStore(s => s.updatePatientGeneticHistory);
  const conditions = useId();
  const [family, setFamily] = useState(initial?.familyHistory ?? []);
  const [noneKnown, setNoneKnown] = useState(initial?.status === "none-known");
  const [geneticConditions, setGeneticConditions] = useState(initial?.knownGeneticConditions?.join(", ") ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const addedRelative = useRef<string | null>(null);

  function addRelative() {
    const id = crypto.randomUUID();
    addedRelative.current = id;
    setFamily(entries => [...entries, { id, relationship: "", condition: "" }]);
  }

  function editEntry(id: string, values: Partial<FamilyHistoryEntry>) {
    setFamily(entries => entries.map(entry => entry.id === id ? { ...entry, ...values } : entry));
    setError("");
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries = family.map(entry => ({
      ...entry,
      relationship: entry.relationship.trim(),
      condition: entry.condition.trim(),
      diabetesType: entry.diabetesType?.trim() || undefined,
    })).filter(entry => entry.relationship || entry.condition || entry.diabetesType || entry.notes);

    if (entries.some(entry => !entry.relationship || !entry.condition)) {
      setError("Enter a relationship and condition for each relative, or remove the incomplete entry.");
      return;
    }

    const knownGeneticConditions = geneticConditions.split(",").map(condition => condition.trim()).filter(Boolean);
    const history: GeneticHistory = {
      status: entries.length ? "recorded" : noneKnown ? "none-known" : "unknown",
      familyHistory: entries,
      knownGeneticConditions,
      notes: notes.trim(),
    };

    try {
      updateHistory(patient.id, hasGeneticHistory(history) ? history : undefined);
      close(true);
    } catch (error) {
      setError((error as Error).message);
    }
  }

  return (
    <form className="workflow-form genetic-history-editor" onSubmit={save} aria-label="Genetic history">
      <div className="genetic-history-heading">
        <h3>Family history</h3>
        <button className="genetic-history-add" type="button" onClick={addRelative}>
          <Plus size={16} aria-hidden="true" />
          Add relative
        </button>
      </div>
      {family.map((entry, index) => (
        <fieldset className="genetic-history-relative" key={entry.id}>
          <legend>Relative {index + 1}</legend>
          <div className="genetic-history-relative-fields">
            <label>Relationship
              <input value={entry.relationship} onChange={e => editEntry(entry.id, { relationship: e.target.value })} ref={input => {
                if (input && entry.id === addedRelative.current) {
                  addedRelative.current = null;
                  input.focus();
                }
              }} />
            </label>
            <label>Condition<input value={entry.condition} onChange={e => editEntry(entry.id, { condition: e.target.value })} /></label>
            {entry.diabetesType !== undefined && <label>Diabetes type<input value={entry.diabetesType} onChange={e => editEntry(entry.id, { diabetesType: e.target.value })} /></label>}
          </div>
          {entry.notes && <p>{entry.notes}</p>}
          <button className="genetic-history-remove" type="button" onClick={() => { setFamily(entries => entries.filter(item => item.id !== entry.id)); setError(""); }}>Remove relative</button>
        </fieldset>
      ))}
      {family.length === 0 && <label className="genetic-history-checkbox">
        <input type="checkbox" checked={noneKnown} onChange={e => setNoneKnown(e.target.checked)} />
        No known relevant family history reported
      </label>}
      <div>
        <label>Known genetic conditions<input value={geneticConditions} aria-describedby={conditions} onChange={e => setGeneticConditions(e.target.value)} /></label>
        <p id={conditions}>Separate conditions with commas.</p>
      </div>
      <label>Notes<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      {error && <p className="workflow-error" role="alert">{error}</p>}
      <div className="workflow-actions genetic-history-actions">
        <button type="button" onClick={() => close(false)}>Cancel</button>
        <button type="submit" className="primary">Save genetic history</button>
      </div>
    </form>
  );
}
