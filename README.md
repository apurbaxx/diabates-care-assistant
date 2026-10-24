# Diabetes Care Assistant for Doctors

ClinIQ is an AI-assisted platform designed to improve doctor productivity and access to knowledge related to diabetes. It brings patient records, lab reports, medications, and medical data into one place, enabling faster record review, report comparison, source-linked reference retrieval, and organized patient information. It also has AI assistant that answer's doctor questions.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000. A seed cohort of 8 synthetic patients (one per
clinical archetype) loads automatically into browser `localStorage` on first
run — nothing to configure.



## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint checks |
| `npm test` | Workflow and data-integrity tests |
| `npm run test:e2e` | Production browser workflow tests (after build) |

## Doctor productivity workflows

The patient homepage includes a doctor worklist. Patient workspaces include saved visit summaries, laboratory PDF extraction and verification, and a unified clinical timeline linked to charts. Records remain in browser storage; original report files use browser IndexedDB. Download complete backups from **Browser storage and backups** to protect against clearing site data or device loss.

See [implementation, storage, APIs, testing and deployment notes](docs/doctor-workflows.md). No patient database or Supabase patient schema is introduced.

## Key directories

```
lib/clinical/     Deterministic clinical engine (guidelines, derivations, trend
                   stats, causality guard, per-domain analyzers)
lib/data/          Synthetic patient archetypes + generator
lib/labs/          Free-text lab report parser
lib/assistant/     Retrieval-first assistant (intent → retrieve → compose)
lib/store.ts       Zustand store, persisted to localStorage
components/        UI, organised by dashboard section
app/api/assistant/ Optional LLM narration pass (citation-validated)
```
