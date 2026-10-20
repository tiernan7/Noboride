# Changes

## Unreleased — dev

- Replaced the inline analysis-settings panel with a modal Settings dialog. Added an adjustable suggestion overlap percentage (10–100%, default 60%), persisted per comparison and in backups. De-duplication now uses shared/combined source distance instead of fixed endpoint tolerances, so substantially overlapping edited ranges can hide redundant suggestions without merging separate laps.
- Added inline activity renaming by clicking names in the ride library, with Save/Enter and Cancel/Escape. Names update across tabs, comparisons and exports; original filenames, stable IDs, notes and duplicate detection remain intact. Name-only metadata updates preserve existing notes and reject blank or overlong names.
- Suppressed redundant GPS suggestions after accepting a lightly trimmed preview or editing an existing stretch's boundaries. Larger changes and separate recording passes remain eligible suggestions; saved endpoints and match-verification rules are unchanged.
- Recognized and printed the Mac's existing Bonjour `.local` address in wildcard host mode while retaining configured Host/Origin restrictions.
- Stopped local saved-stretch cards from scrolling the page when selected. Distant Edit actions still navigate to the editor.
- Added confirmed comparison deletion, retaining imported rides and restoring state after failed saves. Deleting the last populated comparison leaves one fresh untitled comparison with deletion disabled.
- Added opt-in Wi-Fi access using `node server.mjs --host`, explicit `--host address` / `--host=address`, and launcher argument forwarding. Default binding remains loopback; Host/Origin validation permits configured network addresses. Added a comparison-ID fallback for mobile browsers on plain HTTP.
- Simplified the source editor to Add to comparison or explicit Update/Cancel. Removed the competing reusable-section controls and separate adjustment dialog while retaining legacy definitions in storage/backups.
- Persisted per-ride browsing ranges independently of accepted entries. Source tabs now show existing stretches in the active comparison as selectable cards, local map overlays and separate numbered profile rows; another selection can be added without replacing earlier passes.
- Added named, persistent comparison contexts with inline renaming, normalized unique names, a switcher and an empty-aware New comparison action.
- Replaced the fixed reference dropdown with source ride tabs. Comparisons contain independently accepted stretches, including several from one recording, and restore their own baseline, settings and browser selection.
- Added previewable GPS match suggestions from the first accepted road, including repeated laps. Manual pairings across different roads remain explicit and disable same-road terrain attribution.
- Added comparison persistence and backup/restore support, with a consistent pre-migration database backup before creating the additive storage table.
- Corrected Leaflet longitude conversion at the marker-drag boundary.

- Removed online street maps and tile-loading code for privacy. Maps render local route geometry only; CSP no longer permits external tile images. Updated help and documentation.

- Restricted reference choices to included rides, selecting another included reference when needed. Empty selections clear stale comparisons; opening saved sections includes their reference ride with a visible explanation.

- Removed Set start / Set end map buttons and their map-click selection mode; updated instructions to point to profile selection, sliders and coordinate snapping.

- Added visible Saved sections and Section name labels; moved Delete section beside the section selector.
- Distinguished Save new section, Update section and Save as new section. Endpoint edits on a selected saved section now update that section when saved; creating a copy is explicit.
- Added confirmations and validation errors beside the save controls, with browser coverage for saving, updating, copying, reopening and deleting sections.

## 1.0.2 — October 19, 2026

- Renamed the app to Noboride across the UI, npm metadata, docs, downloads, launcher messages and VS Code configurations.
- New workspaces use `noboride.sqlite` and `NOBORIDE_DATA_DIR`. Existing databases are reused in place, and the previous data-directory variable remains supported.
- Carried over browser-local included-ride selections and retained version 1 backup compatibility.
- Added regression coverage for database path precedence, reopening legacy workspaces and browser selection compatibility.

## 1.0.1 — October 18, 2026

- Added root `AGENTS.md` with launch/architecture details, normalized data contract, analysis invariants, testing instructions, fixture provenance, privacy rules and known limitations.
- Added a commit-pinned public timed GPX fixture with source/checksum metadata and upstream license.
- Expanded the core suite from 22 to 37 tests, including deterministic GPS jitter, correlated drift, irregular sampling, missing GPS, repeated laps and rejection cases on recorded track geometry.
- Fixed GPX/TCX imports that discarded valid tracks when an earlier sibling track/activity was empty or untimed.
- Fixed automatic matching rejecting brief interior GPS loss despite continuous time/distance/sensor data. Short gaps are bridged for geometry verification only; source coordinates remain missing. Long gaps and explicit discontinuities still reject.
- Added GPS geometry-bridge duration to the comparison display and CSV; manual selections do not imply automatic route verification.
- Corrected the old “noisy coordinates” test name to describe its actual constant-offset coverage.

## 1.0.0

Initial local dashboard, import pipeline, GPS sections, repeated-pass comparisons, notes, terrain time budgets, CSV and backup/restore.
