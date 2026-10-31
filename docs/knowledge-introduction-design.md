# Knowledge Explorer first visit

Use the existing welcome’s editorial layout: pale blurred backdrop, long blue rule, Fraunces headline, sans-serif descriptions, numbered monospace labels, restrained reveal animation and responsive columns.

The introduction follows the app loading screen and global welcome, when applicable. Present “Search diabetes guidelines.” Explain that answers are retrieved from the PDF document collection, with source passages and references. Three brief columns explain asking, retrieving and verifying. An expandable source collection lists every title and link from `files_needed_for_rag.txt`, parsed on the server rather than copied into UI code. Preserve the supplied links, including the ADA article pages.

“Start exploring” records introduction completion in a separate browser storage key, fades out the introduction and allows the existing Knowledge Assistant tour to launch if unseen. Refreshing before completion repeats the introduction; completing it suppresses it on later visits. Existing tour completion does not suppress this new introduction. Use a native modal, restore focus, support reduced motion, and handle unavailable storage for the current visit.
