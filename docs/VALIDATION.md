# Validation

## Settings dialog and adjustable overlap — dev, October 19, 2026

- `npm run check`, `npm test` (**50 passed**), `npm run format:check` and `git diff --check` passed on macOS / Node.js 26.12.0. Overlap regressions now cover shared/combined distance, adjustable thresholds, short and fractional ranges, strict 100%, separate laps, and an approximate 0.38/0.32 mi example resembling the reported screenshot. This is synthetic regression data, not a read of the user's recordings.
- `npm run test:ui`: **10 passed** with isolated temporary databases. The header opens a native Settings dialog; overlap changes affect suggestions immediately. A non-default 65% threshold is saved and restored after reload; 95% exposes the edited suggestion again. Invalid API values are rejected, Done and Escape close the dialog, focus returns to the trigger, and a 390 px mobile layout has no horizontal overflow. The mobile dialog screenshot was inspected locally.
- The validated `suggestionOverlap` field is optional in existing preference/comparison JSON, defaulting to 60. No schema migration is needed. GPS matching, saved ranges, timing calculations and terrain verification rules are unchanged; suggestion filtering uses the newly documented overlap measure. Physical-device and original personal-track validation were not performed.

## Inline activity names — dev, October 19, 2026

- `npm run check`, `npm test` (**50 passed**), `npm run format:check` and `git diff --check` passed on macOS / Node.js 26.12.0.
- `npm run test:ui`: **10 passed** using isolated temporary databases. A GPX fixture is imported under its original filename, given setup notes, added to a comparison, and renamed by clicking its library label. Tests cover cancel, blank-name errors, Enter to save, escaped markup in names, updated source-tab/baseline labels, persistence after reload, identical metadata/points except for the display name, preserved notes and source filenames, retained backup linkage and comparison IDs, duplicate reimport without overwriting the chosen name, API blank/overlong rejection and mobile editor overflow.
- No schema or importer changes were needed. Original files, content IDs and compressed tracks are unchanged. No personal database or user export was used for validation.

## Trim-aware suggestions — dev, October 19, 2026

- `npm run check`, `npm test` (**50 passed**), `npm run format:check` and `git diff --check` passed on macOS / Node.js 26.12.0. A new regression covers small trims and extensions, substantial range changes, short-range overlap limits and separate laps using known source distances.
- `npm run test:ui`: **9 passed** with isolated temporary databases. Previewing a suggested pass, trimming both endpoints, and adding it leaves only the other ride's suggestion. This holds after reload; removing the trimmed entry restores the original suggestion. The saved trimmed endpoints remain exact and the entry remains a manual pairing. Existing comparison-deletion, scroll-stability and repeated-lap checks also pass.
- Only suggestion de-duplication changed. No persistence schema, source data, GPS verification thresholds, numerical timing or terrain-attribution rules changed.

## Local names, stable source selection and comparison deletion — dev, October 19, 2026

- `npm run check`, `npm test` (**49 passed**), `npm run format:check` and `git diff --check` passed on macOS / Node.js 26.12.0. Network coverage accepts the current Mac Bonjour name and its HTTP origin only in wildcard network mode, rejects unrelated names, and preserves default loopback restrictions. The app reads the existing system hostname without changing it. Physical iPad/iPhone Bonjour resolution was not tested.
- `npm run test:ui`: **8 passed** with isolated temporary databases. A saved-stretch card opens the correct lap without moving window scroll position by more than two pixels. Deletion coverage verifies cancel, deleting an extra empty context, deleting a named populated context while preserving the other context's entries/baseline/metric, rollback after a simulated failed save, deleting the final populated context, deleting an unnamed context without a naming prompt, and a protected fresh empty context after reload. Imported ride counts remain unchanged.
- Existing profile/marker, notes, CSV, backups, manual effort, repeated-lap, mobile overflow and no-external-request checks pass. No schema or numerical analysis changes, personal database modifications or system hostname changes were made.

## Optional Wi-Fi access — dev, October 19, 2026

- `npm run check`, `npm test` (**49 passed**), `npm run format:check` and `git diff --check` passed on macOS / Node.js 26.12.0. Network regressions launch isolated temporary-database processes for the default binding, bare `--host`, explicit address and launcher forwarding. They verify successful reads and same-origin settings writes through a local network interface, while rejecting unconfigured Host headers and unrelated origins.
- `npm run test:ui`: **7 passed**, including comparison creation, saving and editing with `crypto.randomUUID` deliberately unavailable, as on some browsers using plain HTTP over LAN. The fallback uses `crypto.getRandomValues`. No physical iPad/iPhone test was performed. Existing browser regressions, mobile layouts and privacy checks pass.
- Default binding stays loopback. Network access is explicitly enabled by the user; it exposes the same unauthenticated workspace on the selected interface(s). No schema changes or personal database access were needed.

## Simplified editor and saved stretch visibility — dev, October 19, 2026

- `npm run check`, `npm test` (**46 passed**), `npm run format:check` and `git diff --check` passed on macOS with Node.js 26.12.0.
- `npm run test:ui`: **7 passed** using Playwright Chromium and an isolated temporary database. Added assertions cover independent per-ride draft ranges; explicit Update/Cancel without changing other entries or the baseline; removal of the separate saved-section controls and adjustment dialog; inline selection errors; existing accepted ranges shown on source maps and profiles; two laps retained and visible after reload; opening the second lap through its local stretch card; and adding another stretch while preserving both original entries exactly.
- Desktop and 390 px mobile screenshots were inspected locally. Numbered profile rows distinguish saved ranges even when repeated laps share GPS geometry. Long comparison names fit without horizontal overflow. The full workflow reports no external requests or uncaught page errors.
- Legacy saved-section data remains in storage and backups. Per-ride drafts are optional fields within comparison JSON; older contexts remain compatible without another schema migration. The source view shows entries from the active comparison, not entries from other contexts. No user database or personal ride exports were used in validation; analysis algorithms were unchanged.

## Comparison workspace — dev, October 19, 2026

Validated on macOS with Node.js 26.12.0 and Playwright Chromium 1248. Tests use isolated temporary databases, synthetic ride data and the unchanged pinned public GPX; the user's database was not used for these checks.

- `npm run check`: passed, including the new comparison UI, validation and storage modules.
- `npm test`: **45 tests passed**. New coverage verifies multiple entries from one ride, normalized unique names, invalid/missing source ranges, fractional endpoint timing with retained missing channels, persistence and consistent backup before the additive schema migration. Existing 30 seeded GPS simulations still all matched with maximum endpoint-duration error 3.39 s; unchanged public-file import and the 446 s recording segment regression still pass.
- `npm run test:ui`: **7 tests passed**. Coverage includes inline naming and duplicate rejection; New disabled on empty contexts; naming before leaving a populated unnamed context; browsing without altering analysis entries; adding multiple stretches from one recording; truly unrelated road pairings and hidden geographic terrain attribution; restoration of context, baseline and metric after switching/reload; accepted suggestions for lap two of the same synthetic recording; backup/restore of comparison contexts; API name-collision rejection; transaction rollback for invalid comparison restores; old backups without comparisons; protected source deletion and cleanup of unused browser references; real marker dragging; existing profiles, coordinates, saved sections, notes, CSV and imports. The full workflow reports no external requests or uncaught page errors. Mobile checks include long comparison names at 390 px without horizontal overflow.
- `npm run format:check` and `git diff --check`: passed. Desktop/mobile synthetic-data screenshots were inspected locally and remain excluded from Git.
- Existing databases are backed up beside the original with `VACUUM INTO` before creating `comparison_workspace`. No ride/section schema or import-ID changes are required. Fresh databases do not need this migration backup. Comparison contexts are included in version 1 workspace backups as an optional field; existing version 1 backups remain accepted.
- Suggestions currently verify the first accepted road against included tracks; automatic discovery of arbitrary shared subsections and a coverage matrix across comparisons remain proposed. Comparisons with manual pairings suppress same-road terrain attribution. Multiple browser windows are not coordinated. No original personal FIT validation, new upstream FIT downloads or Windows launcher checks were performed.

## Local-only maps — dev, October 19, 2026

- `npm run check`, `npm test` (40 passed), `npm run format:check`, and `git diff --check`: passed on macOS / Node.js 26.12.0.
- `npm run test:ui`: all 4 tests passed using Playwright Chromium 1248 and an isolated temporary database. The full workflow reports no external requests or uncaught page errors. Assertions verify the Street map control and tile images are absent, and CSP restricts image sources to self/data and connections to self. Existing route geometry and mobile overflow checks pass.
- Removed the external map feature rather than repairing its provider-policy failure. Historical tile-disabled results below describe prior versions. The comparison discovery and grouping in `COMPARISON-DESIGN.md` are proposals only; they have not been implemented or validated. Existing numerical simulations and the unchanged public GPX import still pass; no personal ride data was used or modified.

## Included reference rides — dev, October 19, 2026

On macOS / Node.js 26.12.0, `npm run test:ui` passed all 4 tests with an isolated temporary database. New browser coverage checks deselecting the reference, filtered Include shown, clearing all rides, an empty selection after reload, saved sections re-including their reference, and persisting that inclusion after reload. Existing section editing, map geometry, profile/coordinate controls, import, notes, CSV, backup/restore and mobile checks also passed. This changes reference eligibility, not analysis algorithms or the independent timing-baseline control. No user database or personal tracks were used.

## Saved-section controls — dev, October 19, 2026

Validated on macOS with Node.js 26.12.0 and Playwright Chromium 1248.

Follow-up: removed the Set start / Set end buttons, their map-click handler, selection state and unused styles. Reran syntax, all 40 core tests, all 3 browser tests, formatting and diff checks successfully. Existing browser coverage exercises profile brushing, sliders and coordinate snapping; instructions now describe those controls. The separately identified Leaflet `lng` / normalized `lon` mismatch affecting marker dragging remains outside this removal.

- `npm run check`, `npm test` (40 tests), `npm run format:check` and `git diff --check`: passed.
- `npm run test:ui`: 3 browser tests passed using an isolated temporary database. New coverage checks visible selector/name labels, conditional Delete placement, create/update/copy actions, saved endpoint updates without duplicate records, reopening after reload, deletion retaining rides and the original section, nearby short-section errors, and 390 px layout without horizontal overflow. Existing map geometry, import, notes, CSV, manual sections and backup/restore checks also passed.
- Map tiles remained disabled in the browser workflow. The previously reported OpenStreetMap tile block is not addressed by this change. Tests use synthetic rides and the pinned public GPX fixture, not personal ride files; no user database or schema changes were made.

## Noboride 1.0.2 — October 19, 2026

Validated on macOS with Node.js 26.12.0 using the existing installed dependencies and Playwright Chromium 1248 (installed for this run).

- `npm run check`: passed.
- `npm test`: **40 tests passed**, including three new database compatibility tests. Temporary databases verify legacy rides, source points, notes, sections and settings survive reopening; new paths and environment-variable precedence are covered.
- `npm run format:check`: passed.
- `npm run test:ui`: **2 browser tests passed** using an isolated temporary database. The full existing import/comparison/selection/notes/CSV/backup/restore/security/map/mobile workflow passed, plus Noboride title/brand/download names and legacy browser-selection carryover, new-key precedence and intentionally empty selections. No uncaught page errors or unexpected external requests in the full workflow with map tiles disabled.
- Existing databases are selected in place, without a rename, copy or schema migration. This run did not open or modify the user's database. Fresh workspaces use `noboride.sqlite`; old filenames and the old environment variable remain supported as documented in README.
- Analysis algorithms and import IDs were unchanged. Numerical results still concern synthetic rides and seeded simulations on the pinned public GPX geometry, plus the unchanged public-file import check; no new personal FIT validation or upstream FIT downloads were performed. Platform launchers were not exercised.

## Previous validation — 1.0.1

Version 1.0.1, Node.js 24.19.0 on Linux, October 18, 2026.

- `npm run check`: passed application JavaScript syntax checks.
- `npm test`: **37 tests passed**. Coverage includes grade/window invariance, jitter smoothing, missing channels, time weighting, pause/gap handling, projected GPS gates, reverse/detour rejection, repeated laps, coincident full-loop gates, time-budget conservation, FIT/TCX/GPX parsing, ZIP/gzip, corrupt/unsupported inputs, duplicate imports, transactions and distance resets.
- New real-data regression: the unchanged pinned public GPX imports despite an initial empty track, and its 55-sample continuous section matches at its original **446 s** duration and **645.221 m** normalized distance.
- Seeded GPS simulations on that public track's resampled polyline: **30/30** jitter + correlated drift + irregular sampling cases matched; maximum endpoint-duration error **3.39 s**, below the **12 s** test tolerance. All 10 independently noisy reference/candidate pairs also matched. See `docs/ANALYSIS.md` for the exact simulation parameters and limitations.
- Added regressions for brief/long GPS dropout, retained missing coordinates, disclosed geometry-only bridging, GPS-derived distance, noisy repeated laps, stationary distance, large sustained displacement and empty GPX/TCX sibling tracks.
- `npm run test:ui`: browser workflow rerun with the public GPX import in addition to synthetic fixtures. It covers include/reference controls, profiles and coordinate snapping, saved/manual sections, notes, CSV, imports/duplicates, backup/restore, loopback security, visible Leaflet route geometry, and a 390 px mobile viewport without horizontal overflow. No uncaught page errors or unexpected external requests with tiles disabled.

## One-off upstream Garmin FIT checks

These files were downloaded from Garmin's official `fit-javascript-sdk/test/data` repository and spot-checked separately. They are not bundled and these checks are not part of the offline suite:

- `Activity.fit` SHA-256 `949a238e1bb75c3684479785f76fa9a16888bb394518844248f488171d591387`: valid stand-up-paddleboarding session correctly skipped as non-cycling.
- `WithGearChangeData.fit` SHA-256 `7220d6a86e0bafcb1884070081757a2a65caa83d46afccc113ebbe17df60fa79`: 1,979 sensor records imported; no GPS channel, so no road matching claimed.

The generated FIT encoder/decoder roundtrip remains in the offline suite. The public GPX fixture's original sport and recording provenance are not independently verified; simulated sensors/timing are clearly distinguished from its original recording. No original personal FIT export from the user has been supplied. macOS/Windows launchers are provided but have not been run on those operating systems. Test screenshots/browser downloads/databases are excluded from the release ZIP.
