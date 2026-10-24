# Doctor productivity implementation

ClinIQ remains a synthetic, non-diagnostic demonstration application. This implementation extends the existing Next.js application and clinical engine. It does not add patient tables to Supabase, migrate a database, or store patient records on a Heroku dyno.

## Storage and preservation

The existing Zustand persistence key, `diabetes-care-assistant-store`, remains the source of truth for patients. Its state now also contains appointments, summaries and administrative tasks. Older saved state merges with the new defaults; existing patient IDs, visits and reports are retained. First-run seeding runs only after successful hydration. The historical reset action no longer replaces an existing cohort. Generating an existing patient ID reports an error instead of duplicating it.

Original uploaded documents are stored as Blobs in the browser's IndexedDB database `cliniq-report-files`. They are not publicly hosted or uploaded to a server. Metadata references each Blob by a stable ID. PDF parsing runs in a local PDF.js worker, bundled with the application. Only structured review values are sent to the stateless validation API; the API does not persist them.

Both stores survive reloads, browser restarts and Heroku dyno restarts when the same browser profile and origin are used. Browser storage cannot guarantee permanent retention: clearing site data, browser eviction, private browsing expiry, profile/device loss, and changing the deployed origin can make records unavailable. The UI provides a persistent-storage request, a complete downloadable JSON backup including original files, and validated restore. Restore merges missing IDs, including visits/reports belonging to existing patients, without overwriting current records or clinician edits. Conflicting existing IDs win. Backups are local files and should be kept safely. Restore accepts explicitly marked synthetic ClinIQ backups only.

Quota/write failures display a global warning rather than claiming a successful durable save. Corrupt stored JSON is not overwritten with a new cohort. An explicit restore first preserves unreadable bytes under a separate recovery key. Cross-tab storage events refresh the shared store; summary revision checks reject stale saves. This is not a transactional multi-user database, and simultaneous writes from multiple tabs should be avoided.

## Features

- Doctor worklist: real counts, today's appointments, date/all-date filters, appointment create/edit/cancel/status changes, pending reports and summaries, linked tasks with persistent status changes. Completing an appointment creates an empty documented encounter source and a documentation task. No measurements or clinician notes are fabricated for it. Task completion never approves the underlying record.
- Visit summaries: one-click deterministic generation from an actual selected visit and its available historical records. Demographics, medical history, individually dated measurements, validated comparison deltas, medication history and existing clinician notes retain source references. Computed changes are identified separately. Missing data is stated explicitly. Saved drafts reopen rather than regenerate. Approvals preserve entered reviewer and timestamp; approved snapshots are immutable and editable revisions create new records. Export opens an isolated, escaped, Unicode-capable print layout containing exactly the saved reviewed sections, source IDs, status and approval metadata. Choose **Save as PDF** in the browser print dialog. Unsaved edits must be saved before export.
- Laboratory reports: PDF/TXT/CSV/paste, file size/signature validation, PDF text extraction, existing analyte synonym matching, explicit unit allowlists and existing canonical conversions. ISO/named-month specimen dates are extracted conservatively. DOB is not used as specimen date. Ambiguous/missing dates and units require correction. Inequality results are left unmatched rather than treated as exact values. Editable review preserves source text, unmatched lines and downloadable originals. Server and browser validation precede import. Verified values create sparse dated laboratory records with source-report IDs, without copying older measurements, vitals, notes or medications onto a new date. Repeated imports and identical existing measurements are prevented. Rejecting a report preserves its audit and does not import measurements.
- Unified timeline: visits, individual measurements, medication events, source notes, current computed observations, actual upload/verification actions, and saved summary revisions. Every event has a patient ID, event ID, date/timestamp, source reference and details. Date-only records have no fabricated time. Type/date filters, expandable details, source navigation and stable chart-point links work in both directions. Medication events are displayed without causal claims. Existing visit history remains available separately.

All existing engine consumers observe verified imports immediately because measurements enter the existing visit/series architecture. All registered analytes can appear in trends; active medication reconciliation is not replaced by a laboratory-only record. Overview tiles show each latest available measurement with its own original date.

Synthetic generation reuses the existing seeded archetypes, RNG, medications and visit logic. New patients receive an unverified synthetic report derived from their generated laboratory panel and a scheduled synthetic follow-up. Existing patients are not regenerated. Workflow initialization adds only a missing deterministic scheduled follow-up per patient; it does not fabricate historical uploads or approvals. An optional generation anchor supports reproducible dates. Generated diabetic histories do not precede diagnosis, and jitter cannot put historical visits in the future.

## Files and integration points

New domain logic: `lib/workflow/{types,validation,records,summary,timeline}.ts`.

New browser utilities: `lib/browser/{files,backup}.ts`, `lib/labs/pdf.ts`, `scripts/prepare-pdf-worker.mjs`.

New UI: `components/workflow/{DoctorWorklist,VisitSummaries,BrowserStoragePanel,StorageStatus,WorkflowUI}.tsx`, `components/labs/ReportReview.tsx`, `components/history/ClinicalTimeline.tsx`.

Updated integration: `lib/store.ts`, `lib/types.ts`, `lib/data/generator.ts`, `lib/labs/parser.ts`, `lib/clinical/{context,derive,units}.ts`, `lib/clinical/analyzers/comparison.ts`, `lib/assistant/retrieve.ts`, `lib/nav.ts`; patient selection/dashboard/overview/generation, report UI, visit history, trends and evidence components; root layout, safety footer and print stylesheet. The assistant panel has an entity-escaping lint correction. Existing Knowledge Explorer APIs and Supabase guideline storage are unchanged.

Tooling: `package.json`, lockfile, `.gitignore`, `eslint.config.mjs`, `playwright.config.ts`, `tests/*.test.ts`, `tests/browser/workflows.spec.ts`.

## API

`POST /api/labs/validate` accepts `patientId`, `reportId`, entered `actor`, and `values` containing analyte key, reported value/unit and measurement date. It returns normalized validated values or a validation error. It bounds streamed request bodies, rejects cross-origin browser requests, and disables response caching. It performs no writes and has no patient lookup or identity authentication.

## Verification and deployment

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then `npm run test:e2e`. Playwright needs Chromium (`npx playwright install chromium`); `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an existing browser. Browser tests start the production app on port 3100.

Tests cover normalization, missing dates/units, duplicate import, sparse provenance, medication preservation, source-linked summary snapshots, task reconciliation, approval immutability, revision persistence, anchored generation, backup validation and merging. Browser tests exercise appointments, an actual generated PDF, server validation, verified imports, chart/timeline links, draft reload, approval, reviewed export content, full backup restore including original PDF, legacy storage, filters, invalid/scanned PDFs and corrupt-storage preservation. Mobile checks measure page overflow and capture screenshots.

Verified results: 17 workflow/data-integrity tests and 5 production-browser tests passed. Typecheck, ESLint, production build and `git diff --check` passed. The build reports two existing unused ESLint-disable warnings in the clinical engine. Live AI and guideline-provider calls were not tested.

The existing Docker/Heroku build invokes `npm run build`, which copies the matching PDF.js worker to public assets before compiling. Do not deploy without that build step. Use HTTPS or localhost for browser cryptographic APIs. No new storage credentials or environment variables are needed. Changing hostname or scheme changes the browser storage origin; export before changing it and restore afterward.

Limits: no OCR; scanned PDFs need transcription. PDFs are limited to 10 MB, 50 pages and 500,000 extracted characters. Numeric slash dates are deliberately not inferred. Extraction is a review aid, not a guarantee for every laboratory layout. Report verification requires the application server for stateless validation. Reviewer names are entered locally and are not authenticated identities; browser data and approval metadata can be changed by the browser owner. There is no multi-user authorization or regulatory-compliance claim. Live external AI/knowledge providers need their existing configuration and are not exercised by offline workflow tests.

Dependency audit at implementation time reports 9 advisories in the existing dependency stack (7 high, 2 critical), including Next.js and the knowledge-retrieval dependencies. No force upgrades were applied as part of these workflow changes. A dependency-security upgrade remains necessary before exposing this prototype as a production clinical service.
