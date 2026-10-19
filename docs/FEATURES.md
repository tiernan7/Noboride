# Questions that shaped Noboride

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
