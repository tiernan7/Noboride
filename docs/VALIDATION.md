# Validation

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
