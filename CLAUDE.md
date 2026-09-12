# Diabetes Care Assistant for Doctors

## Problem

Diabetologists carry years of scattered data per patient — HbA1c, renal markers, weight, BP, drug titrations, notes. Spotting *what changed and why it matters* means manually re-reading the whole chart at every visit. This app is a doctor-facing clinical decision-support layer over the longitudinal diabetes record: it surfaces trends, compares each new lab report against that patient's own history, answers patient-specific questions, and cites its evidence.

## Non-negotiables

- **Not an LLM wrapper.** All clinical reasoning is deterministic TypeScript in `lib/clinical/` (ADA Standards of Care 2025, KDIGO 2024/2022). The LLM only rephrases already-computed, already-cited facts; it may never introduce a claim.
- **Every insight ships evidence.** An `Insight` renders only if it carries an `EvidenceRef` (visit + field + value + date) or a `GuidelineRef` (source, section, grade). One click → the underlying data.
- **Three distinct classes:** observation / trend / possible clinical significance. Never conflate them.
- **No unsupported causality.** Drug→outcome wording requires the `causality.ts` gate; otherwise say "observed after".
- **Doctor decides.** No diagnoses, no auto-titration. Synthetic data only.

See `plan.md` for architecture and build order.
