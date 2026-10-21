# Questions that shaped Noboride

The source editor and ride story form one **Ride browser** with a map, linked traces, section tree and shared boundaries. Suggested and custom sections use one comparison-local model: Add creates one section/entry, and Save changes updates its name and boundaries together. Stable section links prevent trimmed ranges becoming additional copies. Other comparisons remain independent, while ambiguous legacy versions stay inspectable for explicit cleanup. Full-ride viewing remains the default, with optional context focus and distance/time brushing.

The dev foundations now also provide a linked single-ride story with sensor traces, map cursor and approach/aftermath; terrain-only hills, ramps and dip-spanning passages with persistent boundary corrections; and inspectable, reversible same-road/similar-terrain decisions at original coordinates. See [RIDE-STORY.md](RIDE-STORY.md) for methods and the remaining seven-feature roadmap. These do not label intentions, emotions, physiological thresholds or estimated power.

Based on the cycling discussions supplied in the request and the retrieved September–October ride-analysis context:

| Question                                                             | Feature                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| How much faster than the immediately previous ride?                  | Explicit included rides, selectable baseline, elapsed and moving comparisons                                     |
| Did the gain come downhill or on the climb?                          | Common-reference terrain time budget and cumulative time-delta chart                                             |
| Are we timing exactly the same hill despite differing GPS/elevation? | GPS endpoint gates, ordered route checks, visible start/end offsets, manual correction                           |
| How do four climb passes across repeated loops compare?              | Separate automatic pass rows per lap                                                                             |
| Garmin defines the same hill with different boundaries               | User-defined, named sections; independent overlapping sections                                                   |
| The last few feet feel much steeper than the reported average        | Adjustable 10–300 m grade window, peak-window grade, grade overlay                                               |
| Where would a chart start/end selection land on the road?            | Profile range brushing linked to map S/E markers and coordinate snapping                                         |
| Is the new bike faster at similar HR?                                | Distance-aligned HR/speed overlays, time-weighted means, explicit limits on causal interpretation                |
| Did gearing, standing or mechanical drag affect the comparison?      | Bike/gearing/conditions/free-text notes next to whole-ride sensor summaries                                      |
| Did stops or extra route distance change the average?                | Separate elapsed/device timer/device moving/estimated moving times, route geometry checks and per-pass distances |
| Can cadence or power explain the difference?                         | Recorded cadence/power charts where the export contains those channels; no fabricated channels                   |
| Can this run in VS Code locally?                                     | Node 24 package, cross-platform launcher, VS Code tasks/debugging, local SQLite, no Garmin authentication        |

Not inferred: gear state without notes, standing vs seated without notes, wind, brake drag, accurate crank power from GPS, physical bike fit, or a causal fitness improvement.

The source editor lists existing stretches from its selected ride within the active comparison, with local map overlays and separate numbered profile rows for overlapping or repeated passes. Ride tabs remember their browsing ranges. Selecting an entry opens it in the same editor; Update/Cancel applies or discards edits. Select another stretch adds a separate entry. Legacy saved-section data remains in backups, without a competing save/switch workflow in the editor.

The dev workspace adds named comparison contexts above the source editor. Source ride tabs supply individually accepted stretches, including multiple passes from one recording. Names can be changed inline; populated unnamed contexts require a name before switching, and empty contexts cannot create another context. Comparison entries, analysis baselines and settings persist locally and travel in workspace backups. Matching suggestions require acceptance. Manually paired different-road efforts are supported without same-road terrain attribution. Broader automatic shared-section discovery remains a proposal in `COMPARISON-DESIGN.md`.

Checked rides now scope saved analysis as well as source browsing. Partial comparisons show available/total stretch counts, collapsed excluded entries and explicit inclusion controls. The comparison switcher reports availability against the current checked set and keeps that set when switching. Clearing all rides clears analysis without deleting saved comparisons. A missing or unverified baseline is identified explicitly and retained until the user includes its ride or chooses another available baseline.
