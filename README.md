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
| `npm run lint` | Next.js lint |

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
