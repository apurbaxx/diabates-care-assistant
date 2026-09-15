# Diabetes Care Assistant for Doctors — Build Plan

> Doctor-facing assistive record-review system for longitudinal diabetes management.
> **Not a chatbot. Not an LLM wrapper.** A deterministic, guideline-encoded reasoning
> engine with an optional natural-language layer that is only allowed to speak about facts the
> engine already computed and cited. The clinician always interprets and decides.

---

## 0. Guiding principles

| Principle | How it is enforced in code |
|---|---|
| **Not an LLM wrapper** | All clinical logic lives in `lib/clinical/*` as deterministic TypeScript rules derived from published guidelines. The engine runs with zero network access. The LLM (if a key exists) only *rephrases* an already-computed, already-cited fact bundle and is forbidden new claims. |
| **Every insight is verifiable** | Every `Insight` object must carry `≥1 EvidenceRef` (patient datum: visit id + field + value + date) or `≥1 GuidelineRef` (source + section + grade + URL). Insights without evidence are dropped by a validator before render. |
| **Observation ≠ trend ≠ flagged-for-review** | `Insight.kind: 'observation' | 'trend' | 'flagged-for-review'`. Rendered with a neutral kind badge only — no red/amber urgency colour-coding. |
| **Doctor in control** | No auto-actions. All outputs phrased as *consider / discuss / note*. Prominent "assistive tool — not a diagnosis" framing. Doctor can dismiss/acknowledge insights. |
| **No unsupported claims** | Causality guard: medication→outcome statements only emitted when temporal window + magnitude + no-confounder checks pass; otherwise phrased as temporal association only. |

---

## 1. Tech stack

- **Next.js 15 (App Router) + TypeScript** — one deployable, server route for the optional LLM proxy (key never in browser).
- **Tailwind CSS v4** — clinical UI, dense but calm.
- **Recharts** — interactive longitudinal charts with reference bands + medication-change annotations.
- **Zustand + localStorage** — client patient store (MVP; swap for a DB later).
- **Zod** — schema validation for uploaded/parsed lab payloads.
- **@anthropic-ai/sdk** — optional narration layer, `claude-sonnet-5`. Absent key ⇒ app fully functional via deterministic composer.

No database in the MVP. Data = seeded synthetic cohort + user-generated synthetic patients + uploaded labs, all persisted in `localStorage`.

---

## 2. Data model (`lib/types.ts`)

```ts
Patient        { id, mrn, name, sex, dob, ethnicity, diabetesType, diagnosisDate,
                 comorbidities[], allergies[], smoking, notes, visits[], labReports[] }
Visit          { id, date, reason, vitals, labs, medications[], medicationChanges[],
                 clinicianNote, insulinRegimen? }
Vitals         { weightKg, heightCm, systolic, diastolic, heartRate }
LabPanel       { hba1c, fastingGlucose, randomGlucose, creatinine, egfr, uacr,
                 potassium, ldl, hdl, triglycerides, alt, hb, tsh, vitaminB12, ... }
Medication     { id, name, class, dose, unit, frequency, startDate, endDate?, indication }
MedicationChange { medId, type: 'start'|'stop'|'increase'|'decrease'|'switch', from, to, reason }
LabReport      { id, date, source: 'upload'|'manual'|'synthetic', rawText?, fileName?,
                 parsed: LabPanel, parseConfidence, unmatchedLines[] }
Insight        { id, scope, kind, severity, title, statement, detail,
                 evidence: EvidenceRef[], guidelines: GuidelineRef[], confidence, tags[] }
EvidenceRef    { kind:'measurement'|'visit'|'medication'|'report', patientId, visitId?,
                 field, value, unit, date, label }
GuidelineRef   { id, source, year, section, title, statement, grade?, url }
```

**Units are normalised on entry** (mg/dL ↔ mmol/L, %, mmol/mol, mg/g ↔ mg/mmol) via `lib/clinical/units.ts`.

---

## 3. Clinical engine (`lib/clinical/`) — the core, no AI

### 3.1 `guidelines.ts` — encoded knowledge base
Structured, citable entries (statement + source + section + evidence grade + URL). Seeded from:
- **ADA Standards of Care in Diabetes — 2025** (Sections 2, 6, 8, 9, 10, 11)
- **KDIGO 2024 Clinical Practice Guideline for CKD** (albuminuria/eGFR staging definitions)
- **KDIGO 2022 Diabetes Management in CKD**
- **ADA/EASD 2022 Consensus Report** on hyperglycaemia management in T2D
- **ACC/AHA** guidance where ADA cross-references

Each entry exposes `applies(ctx: PatientContext): boolean` so retrieval is *rule-based*, not embedding-guessed.

### 3.2 `derive.ts` — computed clinical quantities
- **eGFR** — CKD-EPI 2021 creatinine equation (race-free)
- **CKD stage** G1–G5, **albuminuria** A1–A3 (KDIGO's published staging boundaries, applied to the record — no risk score or heatmap classification is derived or shown)
- **BMI**, BSA, **eAG** from HbA1c (`eAG = 28.7 × A1c − 46.7`)
- No personalised treatment targets (HbA1c/BP/LDL goals) are computed or displayed — ADA/KDIGO numbers appear only as general reference citations, never attached to this patient as "your target"

### 3.3 `stats.ts` — trend mathematics
- **Theil–Sen slope** + Kendall's tau (robust to outliers, tiny n)
- **Monotonic run detection** (n consecutive rises/falls)
- **Significance gate**: change must exceed *assay + biological variability* thresholds before being called a trend
  (HbA1c ≥ 0.5 %, creatinine ≥ 0.15 mg/dL, eGFR ≥ 5 mL/min/1.73m², UACR ≥ 30 % + category change, weight ≥ 2 kg, SBP ≥ 5 mmHg)
- `classify(): 'stable' | 'rising' | 'falling' | 'variable' | 'insufficient-data'`

### 3.4 `analyzers/` — insight producers (each pure: `(ctx) => Insight[]`)
1. `glycemic.ts` — HbA1c trajectory (noise-gated), glucose/HbA1c discordance, retest-interval fact
2. `kidney.ts` — eGFR decline (≥30 % / ≥40 % from baseline), CKD stage transition, UACR category change + **KDIGO confirmation rule** (2 of 3 over 3–6 months) — record facts only, no risk-cell classification
3. `medication.ts` — medication change paired with the surrounding lab record, dose-change history, guideline-indicated but absent agents (SGLT2i for CKD/HF/ASCVD; GLP-1RA for obesity/ASCVD) shown as an absence-of-class fact
4. `safety.ts` — metformin & eGFR<30, SGLT2i & eGFR<20, duplicate class, hypoglycaemia-risk stacking (SU+insulin), NSAID/ACEi/diuretic triple-whammy, missing statin where indicated
5. `cardiometabolic.ts` — BP, LDL, weight trajectory (noise-gated trends only, no target comparison), BMI class change
6. `screening.ts` — overdue annual UACR/eGFR, retinal exam, foot exam, lipid panel per ADA §4 intervals
7. `comparison.ts` — new report vs previous vs trend delta engine (used by the Lab Check module)

### 3.5 `causality.ts` — the anti-hallucination guard
Before any "X led to Y" phrasing:
`temporalOrder ✓` → `plausibleLatency ✓` → `magnitude > noise ✓` → `noCompetingChange ✓` → `noConfoundingIllness ✓`
Fail any check ⇒ downgrade wording to **"observed after"** and set `confidence: 'associational'`.

### 3.6 `engine.ts`
`runEngine(patient) → { insights, derived, trends, summary }` — memoised, deterministic, testable.

---

## 4. Synthetic data (`lib/data/`)

`generator.ts` — seeded (mulberry32) longitudinal generator, clinically coherent:
- Archetypes: `well-controlled-t2d`, `worsening-control`, `diabetic-nephropathy-progression`,
  `newly-diagnosed-t2d`, `t1d-variable`, `elderly-deintensification`, `obesity-glp1-responder`,
  `therapeutic-inertia`
- Correlated physiology: HbA1c ↔ mean glucose; weight ↔ HbA1c ↔ drug class; creatinine ↔ eGFR (inverted CKD-EPI); UACR ↔ BP + HbA1c burden; realistic drug titration ladders and 3-month visit cadence with jitter.
- UI: **"Generate synthetic patient"** dialog — archetype, years of history, visit interval, seed → reproducible.
- `seed.ts` — 6 pre-built demo patients so the app is useful on first load.

---

## 5. Lab report ingestion (`lib/labs/`)

- Accepts **paste text**, **.txt / .csv upload**, **PDF** (text-layer extract), or **manual form**.
- `parser.ts`: analyte synonym dictionary (`HbA1c | A1c | Glycated haemoglobin | GHb`…), unit detection, value + range capture, per-field `confidence`, `unmatchedLines` surfaced for doctor review.
- **Doctor confirms the parsed table before it is committed** — nothing enters the record silently.
- Sample report fixtures shipped in `public/samples/`.

---

## 6. Grounded assistant (`lib/assistant/`)

Pipeline — **retrieval-first, generation-last**:
1. `intent.ts` — rule-based classification (change-since-last, 6-month-review, kidney-and-diabetes, biggest-movers, trend-vs-history, medication-question, guideline-question, safety-question).
2. `retrieve.ts` — pulls the exact patient facts + engine insights + applicable guideline entries for that intent. **This is the answer's factual substrate.**
3. `compose.ts` — deterministic template composer producing two clearly separated blocks:
   - **🩺 This patient** — facts, each with an inline evidence chip
   - **📘 Guideline context** — citations with source + section + grade
   plus a fixed **"Your clinical judgement decides"** footer.
4. `narrate` (optional) — `POST /api/assistant` sends *only* the retrieved bundle to Claude with a strict system prompt: rephrase for readability, cite by `[E1]`/`[G1]` id, add nothing. Server post-validates that every citation id exists; on violation it falls back to the deterministic composition.
5. Suggested questions are generated from the patient's own active insights.

---

## 7. UI architecture

```
app/
  page.tsx                    Patient selection (search, filter, flagged-count chips, "generate synthetic")
  patient/[id]/page.tsx       Dashboard shell with section nav
components/
  patient/OverviewPanel       Demographics, dx, meds, comorbidities, latest values, AI summary
  history/VisitTimeline       Vertical longitudinal timeline, per-visit expandable + inline insights
  trends/TrendWorkbench       Multi-parameter Recharts, reference bands, med-change markers,
                              clickable AI explanation → highlights the causal datapoints
  meds/MedicationTimeline     Gantt-style drug bars aligned to the HbA1c curve
  labs/LabCheck               Upload → parse → confirm → CURRENT vs PREVIOUS vs TREND table
                              → "N notable changes" summary
  assistant/AssistantPanel    Grounded Q&A with evidence chips
  shared/InsightCard          kind badge, statement, "Show evidence" →
  shared/EvidenceDrawer       The verification surface: measurement table, source visits,
                              guideline text, computation shown (e.g. the eGFR equation used)
  shared/GuidelineCitation
```

**Visual concept implemented as a persistent left rail** that mirrors the requested flow:
`Patient data → History → AI analysis → Trends & changes → Insights → Guidelines & evidence → Doctor review`.

Design: clinical light theme, slate/teal, generous whitespace, kind-based badges only
(observation / trend / flagged-for-review), neutral colour across all insight types — no
red/amber urgency coding.
Every AI element carries a small ✦ marker and a "verify" affordance — never a bare claim.

---

## 8. Build order

1. Scaffold Next.js + Tailwind + deps; base layout & design tokens
2. `types.ts`, `units.ts`, `derive.ts`, `stats.ts`
3. `guidelines.ts` knowledge base
4. Synthetic generator + seed cohort
5. Analyzers + `causality.ts` + `engine.ts`
6. Store + patient selection page
7. Overview + AI summary
8. Visit timeline with inline insights
9. Trend workbench + evidence drilldown
10. Medication timeline
11. Lab upload → parse → compare module
12. Assistant retrieval/compose + `/api/assistant` narration
13. Evidence drawer wiring across every insight surface
14. Polish, empty/edge states, disclaimers, README

---

## 9. Explicit MVP boundaries

- localStorage persistence only — no auth, no multi-user, no audit log, no PHI handling
- Guideline KB is a curated subset, not the full text of any standard
- PDF parsing handles text-layer PDFs only (no OCR of scanned images)
- CGM/time-in-range ingestion is out of scope for the MVP
- **Synthetic data only** — the app must never be pointed at real patient data in this state

---

## 10. Safety framing (non-negotiable, ships in v1)

- Persistent footer: *"Assistive tool for clinician review. Synthetic data only — not a medical device. Every item traces to the record shown; interpretation and decisions remain with the treating clinician."*
- No diagnoses, no prescriptions, no auto-titration.
- Every insight → evidence in ≤1 click.
