"use client";

import { useEffect, useId, useRef, useState } from "react";
import { prescriptionSchema, type CatalogueProduct, type Prescription } from "@/lib/prescriptions";
import type { Medication } from "@/lib/types";

export function MedicationDetails({ medication, instruction, language }: {
  medication: Medication;
  instruction?: string;
  language?: string;
}) {
  const { prescription } = medication;
  return <div className="summary-medication-details">
    <p><strong>{medication.name}</strong>{prescription && ` · ${prescription.strength}`}</p>
    {prescription && <p>{prescription.product}</p>}
    <p>Dosage {medication.dose} {medication.unit} · Frequency {medication.frequency}
      {prescription && ` · Route ${prescription.route} · Duration ${prescription.durationDays} days`}</p>
    <p>Start date {medication.startDate}
      {medication.endDate && (prescription ? ` · Course ends before ${medication.endDate}` : ` · End date ${medication.endDate}`)}</p>
    {(instruction ?? prescription?.instructions) && <p lang={instruction ? language : undefined}>{instruction ?? prescription?.instructions}</p>}
  </div>;
}

export function PrescriptionForm({ initial, confirm, cancel }: {
  initial?: Prescription;
  confirm: (value: Prescription) => void;
  cancel: () => void;
}) {
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [catalogueError, setCatalogueError] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<CatalogueProduct | undefined>(() => initial && {
    ...initial, genericName: initial.name,
  });
  const [error, setError] = useState("");
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const resultsId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/visit-summary/medicine-catalogue", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Catalogue unavailable");
        setProducts(await response.json());
      })
      .catch(() => { if (!controller.signal.aborted) setCatalogueError(true); });
    return () => controller.abort();
  }, [attempt]);

  const search = query.trim().toLowerCase();
  const terms = search.split(/\s+/);
  const matches = search.length >= 2
    ? products.filter(product => terms.every(term => `${product.genericName} ${product.product}`.toLowerCase().includes(term)))
    : [];
  const groups = new Map<string, Map<string, CatalogueProduct[]>>();
  for (const product of matches.slice(0, 100)) {
    const generic = product.genericName.toLowerCase();
    const variants = groups.get(generic) ?? new Map<string, CatalogueProduct[]>();
    const variant = JSON.stringify([product.strength, product.formulation, product.presentation,
      product.strength ? undefined : product.product]);
    const options = variants.get(variant) ?? [];
    options.push(product);
    variants.set(variant, options);
    groups.set(generic, variants);
  }
  const values = selected?.rxCui === initial?.rxCui ? initial : undefined;
  const savedDosage = values ? `${values.dose} ${values.unit}` : "";
  const showResults = searchOpen && search.length >= 2;

  return <form className="workflow-form summary-prescription-form" onSubmit={event => {
    event.preventDefault();
    if (!selected) return setError("Select a catalogue medicine.");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const dosage = String(data.dosage ?? "").trim();
    const amount = dosage.match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/i)?.[0] ?? "";
    const unchanged = values && dosage === savedDosage;
    const dose = unchanged ? values.dose : Number(amount);
    const unit = unchanged ? values.unit : dosage.slice(amount.length).trim();
    if (!Number.isFinite(dose) || dose <= 0 || (!unchanged && !/^[\p{L}%]/u.test(unit)) || unit.length > 250) {
      return setError("Enter a positive dosage with a unit, such as 500 mg, 1 tablet, or 10 units.");
    }
    const parsed = prescriptionSchema.safeParse({ ...selected, ...data, name: selected.genericName,
      id, dose, unit, durationDays: Number(data.durationDays) });
    if (!parsed.success) return setError(`Check the prescription field ${parsed.error.issues[0]?.path.join(" ") || "values"}.`);
    try { confirm(parsed.data); } catch (failure) { setError((failure as Error).message); }
  }}>
    <div className="summary-medicine-search" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
    }} onKeyDown={event => {
      if (event.key === "Enter" && event.target === searchInput.current) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        event.stopPropagation();
        searchInput.current?.focus();
        setSearchOpen(false);
      }
      if (!showResults || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const options = Array.from(results.current?.querySelectorAll("button") ?? []);
      if (!options.length) return;
      event.preventDefault();
      const index = options.findIndex(option => option === event.target);
      const next = event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : index - 1;
      if (next < 0) searchInput.current?.focus();
      else options[next]?.focus();
    }}>
      <input ref={searchInput} type="search" value={query} aria-label="Search diabetes medicine by generic name or brand"
        placeholder="Search diabetes medicine by generic name or brand" maxLength={100}
        aria-controls={showResults ? resultsId : undefined}
        onFocus={() => setSearchOpen(true)}
        onChange={event => { setQuery(event.target.value); setSearchOpen(true); }}/>
      {showResults && <div ref={results} id={resultsId} className="summary-medicine-results" aria-label="Medicine search results">
        {[...groups.entries()].map(([generic, variants]) => <div key={generic} className="summary-medicine-group">
          <h3>{variants.values().next().value?.[0].genericName}</h3>
          {[...variants.entries()].map(([variant, options]) => {
            const { formulation, strength, presentation, product } = options[0];
            const description = [strength, formulation, presentation].filter(Boolean).join(" · ");
            return <div key={variant} className="summary-medicine-variant">
              <p>{description || product}</p>
              <div className="summary-medicine-options">
                {options.map(option => <button type="button" key={option.rxCui} title={option.product}
                  aria-label={`${option.genericName}, ${description || option.product}, ${option.brand ?? "Generic product"}`}
                  onClick={() => {
                    setSelected(option);
                    setQuery("");
                    setSearchOpen(false);
                    setError("");
                    searchInput.current?.focus();
                  }}>{option.brand ?? "Generic product"}</button>)}
              </div>
            </div>;
          })}
        </div>)}
        {products.length > 0 && matches.length === 0 && <p role="status">No matching medicines.</p>}
        {matches.length > 100 && <p>Refine your search for more specific results.</p>}
      </div>}
    </div>
    {catalogueError && <p role="status">Medicine catalogue unavailable. <button type="button" onClick={() => {
      setCatalogueError(false);
      setAttempt(n => n + 1);
    }}>Retry catalogue</button></p>}
    {!catalogueError && !products.length && <p role="status">Loading medicine catalogue…</p>}
    {selected && <div className="summary-prescription-fields" key={selected.rxCui}>
      <div className="summary-prescription-selection">
        <strong>{selected.genericName}</strong>
        <p>{[selected.brand, selected.formulation, selected.presentation].filter(Boolean).join(" · ") || selected.product}</p>
      </div>
      <label>Strength<input name="strength" required maxLength={250} readOnly={!!selected.strength}
        defaultValue={selected.strength ?? values?.strength}/></label>
      <label>Dosage<input name="dosage" required placeholder="e.g., 500 mg" maxLength={600} defaultValue={savedDosage}/></label>
      <label>Route<input name="route" required maxLength={250} defaultValue={values?.route ?? selected.route}/></label>
      <label>Frequency<input name="frequency" required maxLength={250} defaultValue={values?.frequency}/></label>
      <label>Duration (days)<input name="durationDays" required type="number" min="1" max="36500" defaultValue={values?.durationDays}/></label>
      <label>Start date<input name="startDate" required type="date" defaultValue={values?.startDate}/></label>
      <label><span>Additional instructions <span className="font-normal">(optional)</span></span>
        <textarea name="instructions" rows={2} maxLength={1000} defaultValue={values?.instructions}/></label>
    </div>}
    {error && <p role="alert" className="workflow-error">{error}</p>}
    <div className="workflow-actions">
      <button type="submit" className="primary" disabled={!selected}>{initial ? "Update medication" : "Add medication"}</button>
      <button type="button" onClick={cancel}>Cancel</button>
    </div>
  </form>;
}
