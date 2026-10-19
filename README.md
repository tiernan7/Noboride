# Noboride

Version 1.0.2. A small local dashboard for Garmin cycling exports. Select rides, mark the same stretch of road, and compare individual passes at matching GPS endpoints. Includes a synthetic demo so you can explore before importing anything.

## Start in VS Code

1. Install **Node.js 24 LTS or newer** from <https://nodejs.org> (includes npm).
2. Unzip this package and open the **noboride** folder in VS Code.
3. Open its terminal and run:

   ```sh
   node scripts/start.mjs
   ```

4. Open **http://127.0.0.1:4317**. First launch installs the locked dependencies; subsequent launches use the local installation.

VS Code: **Terminal → Run Build Task** also starts the dashboard. After installation, **F5 → Run Noboride** starts the debugger and opens the browser. macOS/Linux users can run `./start.command`; Windows users can run `start.bat`.

Stop with **Ctrl+C** in the terminal. No separate frontend build or Python environment is needed. The first installation requires internet; the dashboard and route-only map work offline afterward. Street-map tiles are optional.

## The workflow

1. **Import** original `.fit`, `.tcx`, timed `.gpx`, `.fit.gz` or `.zip` files. Drop several files at once. Nested Garmin activity ZIPs are supported.
2. **Include** whichever rides belong in a comparison. Filter by ride name, bike or date. Rides are loaded on demand; unselected tracks do not enter analysis.
3. **Choose a reference ride.** It defines the geometry, terrain and endpoints. You can compare the full loop, or select just a hill, descent, flat or approach.
4. **Mark the same road.** Drag over the reference elevation chart, use start/end sliders, drag the map's S/E markers, click “Set start/end”, or enter latitude/longitude and snap to the track. Start must occur before end. For repeated laps, use the chart/sliders to choose the desired pass; a map click alone may snap to an earlier visit.
5. **Compare passes.** Automatic matching checks the GPS gates, direction and ordered route shape. Repeated laps appear separately. Inspect start/end GPS offsets. If a recording doesn't match, use **Select manually**, or **Adjust** an existing pass.
6. **Save a named section.** Later rides can be matched to it. Saving an existing section updates it; drawing a new range starts an unsaved selection. Manual overrides are kept when the section is saved and included in its backup.
7. **Choose a baseline**, then compare elevation, speed, HR, cadence, recorded power, grade, or cumulative time behind the baseline. Hovering over the chart shows the corresponding map location and values for each pass.
8. **Read the terrain time budget.** It separates time differences on climbs, descents and level road, plus slow/paused intervals and recording gaps. This directly addresses “how much faster was downhill?” for a matched loop or section.
9. **Add setup notes** for bike, gearing, wind, tires, standing effort, brake drag or saddle changes. Export the comparison CSV or download a full workspace backup.

## Getting useful Garmin data

Prefer an activity's **Export Original** FIT file from Garmin Connect on the web. A Garmin account-data dump is useful when it contains the original activity FIT files, sometimes in nested ZIPs. Select those files or archives in the dashboard.

An activities-list CSV, daily health FIT file, or activity-summary JSON is not an activity track. Those files cannot reconstruct the second-by-second GPS/HR/elevation needed here. They are reported as skipped, not silently converted into fake rides. Running/swimming sessions in FIT/TCX are skipped. GPX sport labels are not reliable, so timed GPX tracks are accepted as user-selected tracks.

Limits: 200 MiB per upload, 40 MiB per decompressed activity/inner archive, 400 MiB expanded per ZIP import, 2,500 supported archive entries, three nested archive levels. For a larger account dump, extract it locally and import the original activity files in batches. The package does not include your personal ride data.

## What the numbers mean

- **Elapsed section time** is the timestamp difference at the matched road endpoints. Crossing timestamps are interpolated between GPS samples.
- **Device timer / device moving** are shown separately where the file actually supplies them. They are not substituted for section elapsed time.
- **Moving estimate** uses distance/time above an explicit speed threshold (default 1 m/s ≈ 2.24 mph), excluding known pauses and recording gaps. It may differ from Garmin's moving time.
- **Heart rate, cadence and power averages** are time weighted. Missing values remain missing; zero recorded watts remains zero.
- **Grade window** is adjustable from 10–300 m. Short windows expose detail and amplify GPS/altitude noise; longer windows smooth short ramps. Grade is calculated from elevation gain over that physical window and is not changed by screen zoom.
- **Terrain attribution** uses one reference profile for all passes, so altitude noise doesn't relabel the same road between rides. Tracks are aligned by distance progress between GPS gates; internal alignment and terrain time allocation are approximate.
- **Elevation overlays** subtract each pass's initial altitude, avoiding false differences caused by a constant barometric offset.
- **Time delta** is time behind the baseline at the same distance progress; negative means ahead. Differing sensor distance accumulation can shift the internal correspondence.
- **Ascent estimates** use a 3 m elevation deadband and may differ from Garmin.

The dashboard makes comparisons, not causal claims: equal mean HR does not prove equal effort or isolate the bike's mechanical efficiency. It does not infer power, gear choice, wind or fitness from GPS.

## Privacy and persistence

The server listens only on **127.0.0.1**, not your network. Files are decoded locally and normalized tracks/notes/sections are stored in `data/noboride.sqlite`. There is no Garmin login, cloud sync, telemetry, analytics or external font request.

The route-only map requires no network. Enabling **Street map** loads OpenStreetMap tiles, which discloses your IP and viewed map area to that service. Normal attribution is displayed; the app does not bulk-download map tiles.

Download a workspace backup before moving folders or computers. It includes GPS tracks, sensors, notes, settings and saved sections. Restore merges rides by stable import ID and updates saved sections/settings; existing ride notes for duplicate IDs are retained. Selected-ride checkboxes are browser-local, not part of the backup. Unsaved manual overrides are temporary.

To reset everything, stop the app and move the `data` directory out of the project. Keep that directory if you want your rides to persist. It is excluded from the distributable and `.gitignore`.

## Upgrading from RideScope

Noboride continues to open an existing `ridescope.sqlite` in the selected data directory, without renaming or copying it. New workspaces use `noboride.sqlite`. If both filenames exist, `noboride.sqlite` takes priority. Keep your existing data directory when moving the project folder.

`NOBORIDE_DATA_DIR` selects the data directory; the older `RIDESCOPE_DATA_DIR` is still accepted when the new variable is unset. Existing version 1 workspace backups remain compatible. Included-ride selections carry over in the same browser at the same address and port; new selections use the Noboride storage key.

## Development

Plain ES modules with isolated, tested analysis/import/storage modules; a native browser UI; Leaflet maps; SQLite storage; Garmin's official FIT SDK. A lockfile pins the actual installed dependency versions. No global toolchain or compilation step is required.

```sh
npm ci
npm run check
npm test
npm run dev
```

Optional browser integration tests:

```sh
npx playwright install chromium
npm run test:ui
```

Browser tests use a separate temporary database and synthetic/fixture data. The offline suite also includes a pinned public timed GPX recording and seeded GPS jitter/drift/dropout tests on its geometry. Future coding agents should start with `AGENTS.md`. `docs/ANALYSIS.md` details algorithms and limitations; `docs/FEATURES.md` maps features to the cycling questions that motivated them.

Change the port using the `PORT` environment variable, or use `NOBORIDE_DATA_DIR` to select a different database directory. Example on macOS/Linux: `PORT=4320 npm start`. On PowerShell: `$env:PORT=4320; npm start`.

## Project structure

```
server.mjs          Local HTTP API and allowlisted static serving
lib/import.mjs      FIT / TCX / GPX and ZIP ingestion
lib/analysis.mjs    Shared pure GPS, timing, grade and comparison functions
lib/store.mjs       SQLite persistence and transactions
lib/demo.mjs        Synthetic demonstration rides
public/             Dashboard, charts and map interactions
scripts/start.mjs   Cross-platform first-run installer and launcher
AGENTS.md           Architecture, analysis invariants and future-agent workflow
.vscode/            Start/debug/test configurations
tests/              Numerical, parser, storage and browser tests
```

## Dependencies and references

- Official Garmin FIT JavaScript SDK: <https://github.com/garmin/fit-javascript-sdk>
- Leaflet: <https://leafletjs.com/reference.html>
- Node.js SQLite API: <https://nodejs.org/api/sqlite.html>
- fast-xml-parser: <https://github.com/NaturalIntelligence/fast-xml-parser>
- fflate: <https://github.com/101arrowz/fflate>
- OpenStreetMap tile usage: <https://operations.osmfoundation.org/policies/tiles/>

Noboride source is MIT-licensed (see LICENSE). Dependencies retain their own licenses, including Garmin's FIT SDK license in its installed package. Noboride is an independent tool, not a Garmin product.
