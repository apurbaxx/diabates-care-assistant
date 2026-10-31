# First visit welcome

## Visual direction

A quiet editorial introduction that follows the existing loading screen. The real workspace remains visible behind a pale, softly blurred backdrop. No floating card or heavy shadow. A long blue hairline, generous whitespace and restrained typography provide the structure.

Use the app’s locally bundled Fraunces for expressive headings and the Dr. prefix, system sans-serif for readable supporting copy, and a system monospace for small numbered labels. Colours follow ClinIQ: paper white, slate ink and a single muted blue accent. No new font downloads.

## Sequence

1. Existing loading animation finishes.
2. Name entry appears: ClinIQ wordmark, long animated rule, “A clearer view. A more focused day.”, and an underlined name field with a fixed Dr. prefix. Continue is disabled for an empty name.
3. Name entry fades out; the greeting “Hello, Dr. {name}.” rises gently into place. A short introduction and three numbered sections reveal in sequence: patient records, daily workflow, and research. Each section uses a fine divider instead of a card.
4. “Enter workspace” fades out the introduction. Save completion and the name locally in this browser, then automatically open the workspace guided tour if it has not been completed or skipped. Future loads skip the welcome; completed or skipped tours stay dismissed and can be replayed from “Take a tour”. Tours wait until the loader and welcome have finished.

## Behaviour and accessibility

Use a native modal dialog for keyboard focus containment and background isolation. Focus the name field on entry, support Enter to continue, and focus the greeting when the step changes. Allow scrolling on short screens. Reflow overview sections vertically on mobile. Honour reduced motion by removing transitions and delays. Never send the name to a server; gracefully continue if browser storage is unavailable. Store completion only when the user enters the workspace. This is a local display preference, not account registration.

## Validation

Check loading-before-welcome order, blank-name handling, prefix normalization, animated greeting and overview, keyboard navigation, completion persistence, reload during an unfinished welcome, unavailable storage, mobile overflow, reduced motion, and access to the existing guided tour.
