# Changes

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
