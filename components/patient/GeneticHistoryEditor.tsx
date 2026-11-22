"use client";

import { useState } from "react";
import type { Patient, GeneticHistory, FamilyHistoryEntry } from "@/lib/types";
import { useAppStore } from "@/lib/store";

export function GeneticHistoryEditor({ patient }: { patient: Patient }) {
  const updatePatientGeneticHistory = useAppStore(
    (state) => state.updatePatientGeneticHistory
  );

  const initialHistory = patient.geneticHistory;

  const [status, setStatus] = useState<GeneticHistory["status"]>(
    initialHistory?.status ?? "unknown"
  );

  const [familyHistory, setFamilyHistory] = useState<FamilyHistoryEntry[]>(
    initialHistory?.familyHistory ?? []
  );

  const [relationship, setRelationship] = useState("");
  const [condition, setCondition] = useState("");
  const [diabetesType, setDiabetesType] = useState("");

  const [geneticConditions, setGeneticConditions] = useState(
    initialHistory?.knownGeneticConditions?.join(", ") ?? ""
  );

  const [notes, setNotes] = useState(initialHistory?.notes ?? "");
  const [saved, setSaved] = useState(false);

  function addFamilyHistory() {
    if (!relationship.trim() || !condition.trim()) return;

    const entry: FamilyHistoryEntry = {
      id: crypto.randomUUID(),
      relationship: relationship.trim(),
      condition: condition.trim(),
      ...(diabetesType.trim()
        ? { diabetesType: diabetesType.trim() }
        : {}),
    };

    setFamilyHistory((previous) => [...previous, entry]);

    setRelationship("");
    setCondition("");
    setDiabetesType("");
    setSaved(false);
  }

  function removeFamilyHistory(id: string) {
    setFamilyHistory((previous) =>
      previous.filter((entry) => entry.id !== id)
    );
    setSaved(false);
  }

  function saveHistory() {
    const geneticHistory: GeneticHistory = {
      status,
      familyHistory,
      knownGeneticConditions: geneticConditions
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      notes: notes.trim(),
    };

    updatePatientGeneticHistory(patient.id, geneticHistory);
    setSaved(true);
  }

  return (
    <section id="genetic-history" className="record-section">
      <div className="record-section-heading">
        <h2>Genetic History</h2>
        <span>Patient information</span>
      </div>

      <p className="record-description">
        Record reported family history and known genetic conditions.
        This information is for documentation and clinician review.
      </p>

      <div className="record-facts">
        <div>
          <label htmlFor="family-status">Family history status</label>
          <select
            id="family-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as GeneticHistory["status"]);
              setSaved(false);
            }}
          >
            <option value="unknown">Unknown / Not recorded</option>
            <option value="recorded">Information recorded</option>
            <option value="none-known">
              No known relevant family history reported
            </option>
          </select>
        </div>
      </div>

      <h3>Family history entries</h3>

      {familyHistory.length > 0 ? (
        familyHistory.map((entry) => (
          <div key={entry.id} className="record-facts">
            <div>
              <strong>{entry.relationship}</strong>
              <span> — {entry.condition}</span>
              {entry.diabetesType && (
                <span> ({entry.diabetesType})</span>
              )}

              <button
                type="button"
                onClick={() => removeFamilyHistory(entry.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))
      ) : (
        <p className="record-empty">
          No family history entries added.
        </p>
      )}

      <div className="record-facts">
        <div>
          <label htmlFor="relationship">Relationship</label>
          <input
            id="relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="e.g. Mother, Father, Sibling"
          />
        </div>

        <div>
          <label htmlFor="condition">Condition</label>
          <input
            id="condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder="e.g. Type 2 diabetes"
          />
        </div>

        <div>
          <label htmlFor="diabetes-type">Diabetes type (optional)</label>
          <input
            id="diabetes-type"
            value={diabetesType}
            onChange={(e) => setDiabetesType(e.target.value)}
            placeholder="e.g. Type 1 or Type 2"
          />
        </div>

        <button type="button" onClick={addFamilyHistory}>
          + Add family history
        </button>
      </div>

      <h3>Known genetic conditions</h3>

      <input
        value={geneticConditions}
        onChange={(e) => {
          setGeneticConditions(e.target.value);
          setSaved(false);
        }}
        placeholder="Enter conditions separated by commas"
      />

      <h3>Additional notes</h3>

      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        placeholder="Enter additional recorded information..."
        rows={4}
      />

      <div>
        <button type="button" onClick={saveHistory}>
          Save Genetic History
        </button>

        {saved && (
          <p role="status">
            Genetic history saved successfully.
          </p>
        )}
      </div>
    </section>
  );
}