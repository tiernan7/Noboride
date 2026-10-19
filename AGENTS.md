# Noboride — instructions for agents working in this folder

## Purpose and current state

Noboride is a **local, single-user Garmin cycling analysis dashboard**. The user (Tiernan) wants to compare rides over the same physical road, including repeated hill passes, and understand where time gains occurred. It is a runnable multi-file package for VS Code, not a hosted website.

The motivating questions were:

- How does this ride compare with the immediately previous ride, with explicit control over included rides?
- How much of a time improvement came downhill versus climbing or level road?
- Can the same hill be timed at matching GPS endpoints despite GPS/altitude differences?
- Where do chart-selected start/end points land on the map?
- Can short steep ramps be examined at an adjustable grade window rather than Garmin's coarse climb categories?
- How do elapsed time, pauses, HR, cadence, gearing, standing effort and bike/brake changes affect interpretation?

Read `README.md`, `docs/ANALYSIS.md`, `docs/VALIDATION.md` and `docs/FEATURES.md` before changing analysis behavior. The root `AGENTS.md` applies to the entire project. Do not add the user's unrelated personal/medical/career information to this repository.

## Stack, launch and entry points

- **Node.js 24+**, native ES modules. No TypeScript compilation, React, Python, bundler or external database service is required.
- `node scripts/start.mjs`: first-run `npm ci`, then starts the app. `npm start` starts an already installed copy. `npm run dev` enables Node file watching; refresh the browser after frontend edits.
- URL: `http://127.0.0.1:4317`. `PORT` changes the port. `NOBORIDE_DATA_DIR` changes the directory holding `noboride.sqlite`. The legacy `RIDESCOPE_DATA_DIR` remains a fallback. Existing `ridescope.sqlite` databases are reused in place when `noboride.sqlite` is absent; preserve both names and their SQLite sidecars.
- `.vscode/tasks.json` starts/tests the project; `.vscode/launch.json` supports F5 debugging.
- UI: native DOM/SVG, Leaflet. Keep dependencies small; the lockfile is authoritative.

| File                                      | Responsibility                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `server.mjs`                              | Loopback HTTP API, validation, file limits, security headers, allowlisted static routes |
| `lib/import.mjs`                          | Official Garmin FIT SDK, TCX/GPX XML, ZIP/gzip, normalization and content IDs           |
| `lib/analysis.mjs`                        | Pure shared GPS matching, grade, timing, sensor means and terrain attribution           |
| `lib/paths.mjs` | Database path selection and compatibility with pre-rename workspaces |
| `lib/store.mjs`                           | SQLite metadata, compressed normalized tracks, notes, sections, settings, transactions  |
| `lib/demo.mjs`                            | Clearly labeled synthetic demo rides (polygon geometry, not a real road)                |
| `public/app.js`                           | Dashboard state, API calls, map/profile selection, charts, CSV, notes and dialogs       |
| `public/index.html`, `public/styles.css`  | Semantic UI and responsive styling                                                      |
| `tests/*.test.mjs`                        | Numerical, parser, persistence and noisy-track regressions                              |
| `tests/helpers/noise.mjs`                 | Fixed-seed, explicitly parameterized simulations based on public track geometry         |
| `tests/fixtures/`                         | Pinned public GPX, SHA-256/source metadata and upstream license                         |
| `tests/browser/`, `playwright.config.mjs` | Browser integration test with isolated temporary database                               |

## Data contract and non-negotiable invariants

Normalized samples use:

- `t`: Unix milliseconds, strictly increasing; `d`: nondecreasing cumulative **meters**.
- `lat`, `lon`: decimal degrees or `null`; `ele`: meters or `null`.
- `speed`: m/s; `hr`: bpm; `cad`: rpm; `power`: watts; `temp`: Celsius; absent values are `null`.
- `timer`: true/false when known, otherwise `null`; `breakBefore`: an explicit track discontinuity.

1. Keep SI units inside the analysis. Conversion belongs in the display/export boundary. FIT position semicircles must be converted to degrees. Enhanced FIT fields may be arrays; never assume all numeric fields are scalars.
2. Missing data is not zero. Recorded zero power/cadence is valid. Do not fill absent HR, power or GPS merely to draw a continuous chart.
3. Preserve elapsed, device timer, device moving and estimated moving time as different quantities. Do not label a threshold-based moving estimate as Garmin's moving time.
4. HR/cadence/power means are **time weighted**, not sample-count weighted. Preserve pause/gap handling.
5. Grade uses a physical distance window, not pixels or point count. Missing elevation and recording breaks must not become confident gradients. Screen zoom must not change the calculation window.
6. Match the same GPS endpoints and direction; retain separate passes on repeated laps. Show miss distances and distinguish manual overrides from automatic matches.
7. **Interior alignment is currently normalized distance progress, not exact GPS projection at every interior point.** Charts and terrain attribution must continue to describe this as approximate unless a tested replacement is implemented. Do not claim exact geographic time attribution.
8. Terrain buckets use **one reference elevation profile for all compared rides**. Their times must sum to elapsed time, including slow/paused, unknown-grade and gap buckets. Never silently add overlapping saved sections into a whole-ride total.
9. Constant altitude offsets are removed only for the relative-elevation overlay; do not force endpoints to match. Ascent/deadband estimates are not Garmin's official totals.
10. Do not infer power, gear choice, standing/seated state, wind, fitness, mechanical drag or equal physiological effort from GPS/HR alone. Preserve the notes workflow for those observations.
11. Keep content-based import IDs stable. Identical repeated imports should not duplicate a ride. Different format exports of one activity can still have different IDs; do not invent an undocumented deduplication heuristic.

## Matching details and limits

`anchorVisits` projects each reference endpoint onto continuous GPS legs, groups adjacent hits inside the radius, and interpolates the nearest crossing. Candidate passes must be chronological, 0.65–1.5 times the reference distance, and pass 33 ordered shape probes at equal distance progress. Maximum allowed ordered-route offset is `max(65 m, 2.5 × gate radius)`.

A fixed **30 s continuity limit** applies to automatic route verification, independently of the configurable statistical gap threshold. A brief interior loss of GPS can be bridged for geometry verification only if bounding GPS observations are at most 30 s apart. Returned sensor/source samples keep their original missing GPS; `gpsBridgeSeconds` records the maximum such bridge. Explicit breaks and longer gaps are rejected. Do not simply fill source coordinates to make tests pass.

These checks are conservative, not a road-network map matcher. Nearby parallel roads, dense GPS-only jitter, start/end ambiguity at a stop, out-and-back crossings, substantial distance-channel distortion, and noisy reference endpoints can require manual inspection. Manual selection supports one pass per ride/section; automatic matching supports multiple passes. Start/end map snapping selects recorded reference samples and can choose an earlier visit on multi-lap routes—chart/sliders disambiguate.

Saved sections need their reference ride to be present for editing/opening in the current UI. Large numbers of included tracks can consume browser memory; metadata is listed separately and tracks are fetched on demand. Do not claim unlimited dump scalability.

## Import robustness

- GPX/TCX exports can contain empty or untimed sibling tracks/activities. Skip unusable siblings without discarding valid timed tracks later in the file. This was exposed by the public GPX fixture and has a regression test.
- Preserve GPX segment discontinuities and do not draw/add GPS distance chords over known breaks.
- FIT daily health files and CSV/JSON summaries are not cycling tracks. FIT/TCX non-cycling sessions are skipped. GPX sport metadata is unreliable; selected timed GPX is accepted.
- All-time-missing GPX must not acquire fabricated timestamps. Corrupt FIT/XML must produce useful errors.
- Public upstream Garmin test files may be non-cycling or lack GPS; do not turn them into cycling GPS data by changing their metadata. A valid decoder test and a valid cycling-route comparison are different tests.

## Validation requirements

Install once with `npm ci`. Run:

```sh
npm run check
npm test
npm run format:check
```

For UI, API, persistence, selection, map or chart changes, also run:

```sh
npx playwright install chromium   # first time only
npm run test:ui
```

`CHROMIUM_PATH` can point the browser tests at an existing compatible Chromium executable. The packaged test config uses an isolated temporary database; never point tests at a user's database. Browser-install trouble does not justify reporting browser tests as passed. State what actually ran and what did not.

Test design:

- Use analytically known answers or independent ground truth, not a test that repeats the implementation to compute its expectation.
- Noise tests must be **seeded and reproducible**. A constant coordinate offset is not random GPS noise. Record jitter/drift amplitudes, temporal correlation, sampling changes, route source and timing assumptions.
- `realistic.test.mjs` uses public real track geometry and synthetic controlled timing/sensors. The original file is also imported unchanged. The original recording's sport/provenance is not independently verified; it is not the user's data.
- Keep noisy positive matches, incorrect-road/reverse-direction negatives, repeated laps, missing GPS, gaps, empty XML siblings, missing sensors and time conservation covered.
- Do not loosen tolerances or relabel an expected failure merely to get green tests. If a condition is deliberately unsupported, explain it and test safe rejection/manual fallback.
- Preserve fixture source metadata, pinned revision, checksum and license. Normal test runs must work offline; do not fetch mutable remote fixtures during tests.
- Check map geometry visually or by bounding boxes, not only element counts. A global `svg { width:100% }` rule once collapsed Leaflet's SVG pane; scope chart SVG styles to chart containers.
- Verify map clicks, draggable markers, profile brushing, coordinate snapping, saved/manual sections, notes, CSV, backup/restore and mobile overflow when relevant. Test with online tiles off and ensure no unexpected external requests.

Update `docs/VALIDATION.md` with actual commands/results and honest limitations after substantive changes. Public fixtures and simulations strengthen confidence; they do not prove correct behavior for every Garmin/watch export or for the user's own recordings. The original user FIT files have not yet been supplied.

## Privacy, security and persistence

- Listen on **127.0.0.1 only**. Preserve Host/Origin checks, CSP, static-file allowlist and parameterized SQLite statements. Do not expose `data/`, dependencies generally, filesystem paths, or arbitrary files through HTTP.
- No Garmin credentials, cloud uploads, analytics or automatic external requests. Street-map tiles are opt-in with attribution and no bulk download. Do not remove that choice.
- Render imported names/notes as text or escaped HTML. Preserve CSV formula-injection protection.
- Respect upload/decompression limits, XML entity rejection, FIT integrity checks and transactional writes. Keep backup restore validation and failure rollback.
- Do not delete a user's data to debug an issue. Preserve `data/noboride.sqlite` and any legacy `data/ridescope.sqlite`, and take a backup before migrations. Schema changes require a migration strategy.
- Never commit/package personal GPS tracks, databases, original user exports, credentials, `node_modules/`, QA screenshots, browser downloads or test artifacts. The only distributable GPS fixture is the documented public test track with its license.

## Packaging and change communication

A release ZIP contains the `noboride/` source folder, lockfile, docs, tests, fixtures/license, `AGENTS.md`, launchers and `.vscode/` configs. Exclude the paths above. Keep root `package.json` and lockfile version/dependency entries consistent.

Lead a change report with behavior changed, why it matters, and validation performed. Distinguish simulated-data results, upstream-file import checks and user-file validation. Mention important residual limitations plainly; do not promise improved physiological or causal interpretation that the data cannot support.
