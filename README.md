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


### Browser appointment and summary records

The doctor workspace follows `UIUX/Doctor workspace@1x.png`; its counts and queues are derived from saved synthetic records. Appointments reserve 30 minutes across the single-doctor workspace. The workspace schedule supports appointment editing, rescheduling, cancellation, and starting/resuming visits. Patient profiles place visit-summary creation directly beneath the AI summary, with editable drafts, finalization, historical comparison, and printing. Finalized summaries are immutable; finalizing completes the linked appointment. Historical measurements retain their source dates and are never presented as newly measured findings.

Structured patients, visits, laboratory results, appointments and summaries remain in the existing Zustand localStorage key `diabetes-care-assistant-store`. Version 1 migrates existing patient data without regenerating it. Zod validates workflow records and checks patient/appointment ownership. IndexedDB `cliniq-report-files` stores original report attachments (or pasted report text); historical report values remain in localStorage. No patient backend or AI summary generation was introduced. Browser storage is origin-specific; clearing browser data removes these local records.

Browser checks: start the application on port 3100, then run `node scripts/tests/workflow.cjs` and `node scripts/tests/storage.cjs`; use `node scripts/tests/report-review.cjs` to check direct report verification links with Playwright installed. The scripts default to installed Microsoft Edge; set `PLAYWRIGHT_CHANNEL=chrome` to use Chrome. They use isolated browser contexts and synthetic records. Coverage includes legacy-store migration, appointment conflicts and invalid dates, refresh persistence, summary finalization, dashboard synchronization, mobile overflow, and IndexedDB report attachments. Pending-report links open the selected report directly; comparison uses only history preceding that report, and confirmation commits the selected report once.
