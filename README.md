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

Stop with **Ctrl+C** in the terminal. No separate frontend build or Python environment is needed. The first installation requires internet; the dashboard and route-only map work offline afterward.

To use an iPad or iPhone on the same Wi-Fi, run `node server.mjs --host` (or `node scripts/start.mjs --host`). Open the network address printed in the terminal, such as `http://192.168.1.12:4317`, on the other device. Keep the computer and server running; allow incoming connections if your computer's firewall asks. You can bind a specific address with `--host 192.168.1.12` or `--host=192.168.1.12`. `npm start -- --host` also works. Without the flag, access stays on this computer. Wi-Fi mode has no login: devices that can reach the server can view and modify the shared workspace. Use one editing window at a time.

On macOS, `--host` also recognizes and prints the Mac's existing Bonjour address, for example `http://my-mac.local:4317`. This local-network name avoids remembering a changing IP address. To shorten it, edit **System Settings → General → Sharing → Local hostname** and restart Noboride afterward. This changes the Mac's local hostname; Noboride does not change system settings or publish a public domain. Bonjour discovery must be supported by the devices' network; use the printed IP address if name resolution is unavailable.

## The workflow

1. **Import** original `.fit`, `.tcx`, timed `.gpx`, `.fit.gz` or `.zip` files. Drop several files at once. Nested Garmin activity ZIPs are supported.

   Click an activity's name in **Your rides** to rename it inline. Save with Enter or **Save**; **Cancel** or Escape discards the edit. This display name appears in source tabs, comparisons and CSV exports. Original source filenames and stable import IDs stay linked internally and in workspace backups; raw files do not need to be renamed. Reimporting the same file preserves your chosen name and notes.
2. **Work in a comparison.** Its name, stretch list and switcher sit at the top. Click its name to rename it inline. Names are unique after whitespace, case and Unicode normalization. **New comparison** is disabled until the current comparison has a stretch; leaving a populated unnamed comparison asks for a name. Existing empty contexts are reused.

   **Delete comparison** removes the active comparison after confirmation and keeps imported rides. You can delete named, unnamed or extra empty comparisons. Deleting the last populated comparison creates a fresh untitled comparison; the sole empty untitled comparison cannot be deleted. A failed save restores the comparison in the interface for retry.
3. **Include rides** from the library to control both source tabs and analysis. Filters narrow the library list; **Include shown** replaces the checked set with the filtered rides. Switching a source tab changes only the editor. Unchecking a ride hides its stretches from analysis, whole-ride context and CSV without deleting them. The comparison switcher labels saved work **Ready**, **Partial**, **No selected rides** or **Empty** according to the checked set. A selected comparison with unverified GPS matches shows **Review matches**. Missing stretches stay in a collapsed list; **Include ride** or **Include missing rides** brings them back. If none of its stretches are available, the dashboard shows an empty state.
4. **Select and add a stretch.** Brush the elevation profile, use the start/end sliders, drag the map markers, or expand GPS coordinates and snap to the track. Choose **Add to comparison** to accept the selection. The first stretch defines the shared road for automatic matching. You may add several distinct stretches from the same recording, including repeated laps.
5. **Review suggestions.** The app checks the selected road against loaded rides, including other passes in the same recording. Preview suggested endpoints, then **Add match**. Gates, direction, route shape and recording continuity are checked. Suggestions are never added silently. You can also select a different road on any source tab and add it as a clearly labeled manually paired effort.

   If you preview a suggestion, trim its boundaries and add that selection, overlapping suggestions are hidden according to **Settings → Hide overlapping suggestions**. This measures shared distance divided by the combined span on the same recording, default 60%. Lower the percentage to hide more suggestions; raise it for closer agreement. Separate laps stay independent. Removing the trimmed stretch makes its original suggestion available again. Endpoint edits remain explicit manual pairings rather than automatically verified matches.
6. **Inspect existing stretches.** Each source tab lists its accepted stretches in the active comparison. Their ranges appear on the map and in separate numbered rows below the linked traces, so repeated laps remain distinguishable even where their GPS paths overlap. Select a section in the tree, a numbered trace row, or **Edit** in the comparison list to inspect the same object; **Save changes** applies edits and **Cancel changes** discards them. **Select another stretch** starts another selection without replacing existing entries. Each ride tab remembers its browsing range across switching and reload. Legacy saved road definitions remain in storage and backups; their separate save/switch controls have been removed from this editor.
7. **Choose a baseline stretch** in the analysis area, then compare elevation, speed, HR, cadence, recorded power, grade or time behind that entry. Switching comparisons restores its saved entries, baseline, metric, analysis settings and editor range when its source is selected; it keeps your current checked ride set. Reload restores the active comparison's last checked set. If the saved baseline is unselected or cannot be verified, a notice offers **Include baseline ride** where applicable, or you can explicitly choose another available baseline. Raw stretch statistics remain visible; baseline deltas and overlays wait for an available baseline. Reincluding the old baseline restores it unless you explicitly chose another. Charts use distance progress; a map hover locates the first accepted entry belonging to the active source tab, when present.
8. **Read terrain attribution for verified same-road comparisons.** It separates climbing, descent and level-road time, plus pauses, unknown grade and gaps. The first selected road supplies one terrain profile. Attribution is disabled whenever an analysed stretch is a manually paired effort, since these may be unrelated roads. Their time and sensor comparisons remain available, without implying equal effort.
9. **Add setup notes** for bike, gearing, wind, tires, standing effort, brake drag or saddle changes. Export the comparison CSV or download a full workspace backup.

The header's **Settings** button opens a compact dialog for overlap percentage, display units, GPS gate radius, level-road threshold, moving threshold and recording-gap threshold. Changes apply immediately and are saved with the active comparison. Choose **Done** or press Escape to close it. The grade window remains directly above the elevation profile.

## Ride story, climbs and road review (dev)

The **Ride browser** combines ride tabs, one local map, stacked elevation/gradient/speed/HR and available cadence/power traces, the terrain tree and one pair of Start/End controls. Drag across any trace, move S/E markers or use the sliders/GPS coordinates to select one shared range. A cursor links all sensor lanes to that map. Missing sensor data stays missing.

Select a detected or manual hill, ramp or passage in **Ride sections** to load its boundaries. Comparison stretch cards above the map and numbered rows below the traces open accepted stretches for editing; rows also support Enter/Space. Selecting a ride section leaves comparison-edit mode. The section editor and **Add to comparison / Save changes** action sit together beneath the browser. Names, boundaries and included timing ranges save together in this comparison.

**Show full ride** starts checked and preserves the whole recording while selecting terrain. Uncheck it to focus the traces/map on the selection with 500 m of approach and aftermath; the context selector offers other distances. **Select full ride** changes the selection boundaries to the whole recording, whereas **Show full ride** changes only the view. Distance/time axes, context controls and viewport changes do not rewrite source data or accepted entries.

Sections belong only to the active comparison. Selecting a detected suggestion and defining a custom section use the same name/type/boundary editor. **Add to comparison** creates it once; **Save changes** updates that same section, including its accepted timing range. There is no separate activity-level section-save step. Use **New section** or **Select another stretch** when you intend to start a different section.

Suggested and included sections appear together in **Comparison sections**. Included sections retain a stable link when trimmed, renamed, reopened or reloaded, so a slight GPS trim does not become another Add. Nearby legacy versions are shown with explicit Edit buttons rather than being silently deleted. Choose a version to edit, or remove an unwanted version from the comparison list. New nearly identical sections of the same type update the existing section instead of cloning it. Distinct recording laps remain separate.

Use **Delete section from comparison** to remove a section and its included versions only here. Its detected suggestion remains suppressed in this comparison; another comparison has its own names, boundaries and inclusion. Legacy activity-level corrections remain untouched in storage/backups and are copied once into older comparison contexts; new comparisons start with fresh detection. Source files and samples are never rewritten.

For GPS suggestions, **Inspect roads** overlays original tracks, direction and endpoint/shape discrepancies. Confirm same road, compare similar terrain, or reject a pairing with a remembered reason. Existing entries offer **Review road**; independent editor selections offer **Inspect road pairing**. Rejected matches stay out of analysis until reviewed again. Manual same-road corrections keep their own boundaries and remain distinct from automatically checked matches; geographic terrain attribution is disabled for manual or similar-terrain efforts.

Use **Add to hill library** in Comparisons to name a hill or add individual sections/the whole comparison to an existing hill. Each new or edited pass requires an alignment review; saved membership/reviews and precise hill-only boundaries are remembered when reopened. The review shows elevation and gradient around the endpoints, since GPS agreement alone does not establish matching crests. Hill-only changes persist independently of comparison sections. The **Hills** tab shows a full-width combined profile with gradient/sensor colors, recording variation and calculation-only inclusion checkboxes. Its separate explorer uses one point per named hill and compares different hills in an inline graphic. **Open all passes in Comparisons** retains every member for individual pass analysis. [Hill library methods](docs/HILLS.md) describes mapping, persistence and limits.

The Ride browser includes a compact grade-coloured elevation overview above gradient and sensor traces. It shares the selected range and cursor; the separate duplicate elevation trace has been removed. A faint zero-gradient guide distinguishes rising from falling terrain. Missing elevation and recording breaks remain blank. Equipment/event annotations, riding-mode analysis, power estimation and an assistant remain future work. [Ride story methods and roadmap](docs/RIDE-STORY.md) explains assumptions and remaining work.

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

The server defaults to **127.0.0.1**. The optional `--host` flag listens on network interfaces for access from your own devices; an explicit address restricts the listening interface. Host and Origin checks remain enabled for configured addresses. Files are decoded on the computer running the server and normalized tracks/notes/sections are stored in its `data/noboride.sqlite`. There is no Garmin login, cloud sync, telemetry, analytics or external font request.

The map draws your recorded routes locally. It does not request online map tiles or send your IP or viewed map area to a map provider. Browser security policy restricts images and connections to local resources (and embedded image data).

Download a workspace backup before moving folders or computers. It includes GPS tracks, sensors, notes, saved sections, comparison contexts and their browser/analysis choices. Restore merges rides and comparisons by stable ID; name collisions between different comparison IDs reject the restore transaction. Existing ride notes for duplicate IDs are retained. Older version 1 backups without comparisons still restore. Legacy browser-local ride selections seed the first comparison when no contexts exist.

Comparisons are stored in an additive SQLite table. On first opening an existing database without it, the app writes a consistent pre-migration backup beside the database as `*.before-comparisons-<timestamp>.sqlite`, then adds the table. Existing ride/section tables and import IDs are unchanged. Backups remain private and excluded from Git. Editing from concurrent browser windows is not coordinated; use one workspace window. Limits are 100 comparisons, 200 entries per comparison and a 2 MiB comparison-save request.

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
lib/comparisons.mjs Comparison validation, unique names and fractional sample ranges
lib/store.mjs       SQLite persistence and transactions
lib/demo.mjs        Synthetic demonstration rides
public/             Dashboard, charts and map interactions
public/workspace.js Named comparison contexts, source entries and match suggestions
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

Noboride source is MIT-licensed (see LICENSE). Dependencies retain their own licenses, including Garmin's FIT SDK license in its installed package. Noboride is an independent tool, not a Garmin product.
