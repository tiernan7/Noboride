# Ride story, nested terrain and route review

This dev implementation covers the first three foundations in the requested ten-feature plan. It is interactive post-ride analysis of imported recordings. It does not add a live feed, psychological labels, estimated power, physiological thresholds or an external assistant.

## Inspect an effort in context

Choose a source ride and range in the existing editor. **Keep the climb in context** stacks elevation, gradient, speed and heart rate, plus cadence and recorded power when those channels occur in the recording. Each lane has its own labeled scale; a shared cursor selects one original normalized source sample across all lanes and both local maps. Hover, touch, or use the keyboard-accessible cursor slider. The axes can show distance or elapsed recording time, including pauses. The original source indices, timestamps and coordinates are unchanged.

The default view retains 500 m before and after the selection, bounded by available data. Choose 250 m, 1 km, 2 km or the full recording. Selecting a hill or passage changes the editor selection and retains these surroundings; it does not crop the underlying ride or add comparison entries. The approach summary reports observed positive elevation changes and recording interruptions within the displayed approach. Positive elevation changes are noise-sensitive, not a surveyed ascent total.

Traces retain source samples rather than averaging effort into categories. Missing values, explicit breaks and analysis-gap intervals break lines. Gradient is calculated using the existing physical grade window, not inferred from pixels. Speed can be recorded or derived from distance/time by the existing importer; missing HR, cadence and power are never invented. Small display-domain floors avoid magnifying numerical noise into apparent effort changes (1 m elevation, 1 percentage point grade, 0.5 m/s speed, 5 bpm HR, 5 rpm cadence and 10 W recorded power, converted at display). These affect axes, not samples or statistics. Missing optional sensor channels are omitted; missing core channels say Not recorded.

## Terrain hierarchy and corrections

`lib/ride-story.mjs` detects terrain using elevation and source distance, without speed, HR, cadence, power, activity date or bike labels:

- Hills run from an observed low point to a subsequent peak and split after a 3 m drop. Minimum net gain is 10 m over 80 m, with at least 1% average gradient. Level ground at the initial minimum stays in the approach rather than extending a hill backward.
- Ramps sustain at least 6% windowed gradient for 50 m, using a fixed 50 m grade window. They can stand alone below the whole-hill gain threshold. This means sustained *windowed* gradient, not proof that every raw meter has that slope.
- Ascending sequences of hills form a passage when intervening dips are at most 15 m deep and hills are at most 500 m apart. A subsequent peak may be no more than 2 m lower than the previous one. Dip depth and separation are adjustable preview controls under Climb detection assumptions.
- Missing elevation, explicit breaks or observation intervals longer than 30 s split detection and passage joining. No passage bridges an unsupported gap. Hierarchy derives from actual range containment; corrections can change which hill or passage encloses a ramp.

These are inspectable heuristics, not official Garmin climb categories or proof of one riding intention. Altitude drift, sparse sampling and noise can still change suggestions. A staircase-shaped synthetic fixture verifies three hills nested in one passage; this does not establish detection quality on the user's October long ride.

Select a terrain item, change its name/boundaries, then choose Save climb boundaries. Corrections are attached to the activity's stable ID as optional `climbEdits` metadata, retaining the detector ID and original sample range. Restore detected boundaries removes that correction. Saved corrections remain visible even if preview thresholds no longer produce the original node. Source samples, raw filenames and notes are preserved. Comparison entries are independent: explicitly Add/Update a comparison stretch if that is also desired. A climb correction is not an extra timing row.

Limits are 200 corrected ranges per activity, names up to 120 characters and ranges of at least 20 m. Corrections survive reload and workspace backups. Names/notes updates preserve them. Backups merge by import ID and retain existing ride metadata; restore into a fresh workspace/missing ride to recover that backed-up ride's metadata.

## Review whether two ranges are the same road

Suggestions remain the existing conservative endpoint/direction/ordered-shape candidates. **Inspect roads** opens a local Leaflet dialog showing the reference in blue and candidate in orange at their original coordinates. Start/end markers and initial-direction arrows preserve recording order. Metrics show raw endpoint distances, initial headings, and 33 ordered distance-progress shape probes. Divergence connectors and the five largest comparable offsets can be inspected at close zoom. Initial bearing is not a direction check at every switchback. Interior progress probes are approximate and are not an exact road-network projection. Missing GPS is not filled for inspection; discontinuities disable comparable probes.

No track is translated or rotated to force agreement. A parallel road may pass broad GPS tolerances, so the output is a proposal requiring judgement. This foundation does not automatically assign a global hill/road identity from proximity. A dedicated synthetic pair 20 m apart verifies visible offsets and persisted rejection without modifying coordinates.

- Confirm same road records that judgement. An automatic candidate retains `kind: matched` and is still reverified under current settings on use. The quick Add match action is also an explicit same-road confirmation.
- Inspect road pairing lets an independently selected range be reviewed even when automatic matching failed. Manually confirming it preserves `kind: effort`, source boundaries and a same-road label. It does not fabricate automatic verification; terrain attribution stays disabled for manual corrections.
- Compare similar terrain records a separate manual-effort relationship, with no geographic terrain attribution or equal-effort assumption.
- Reject pairing remembers the range and optional reason. Rejections are scoped to the active comparison's road definition; highly overlapping proposals from that same recording pass stay suppressed. Other laps remain independent. Review again can reverse the decision.
- Rejecting an accepted pairing retains its entry but excludes it from analysis. A rejected saved baseline is preserved and explained; no new baseline is silently substituted. Reconfirm or explicitly choose another.

Accepted entries retain optional `relation`, `review` and `reviewReason`; rejected ranges/reasons use the comparison's optional `matchDecisions`. Rejected decisions reset when all entries/its road definition are removed. Deleting an otherwise unused ride cleans decisions referencing it. Validation rejects automatic GPS entries labeled similar-terrain. Failed review saves restore the previous in-memory context and leave the dialog open with an error. CSV includes road relationship and review state; rejected rows are excluded.

No SQL schema migration was required: these are optional JSON metadata fields in existing tables. Track compression, import IDs and source data remain unchanged. Older backups and entries remain compatible. Human confirmation records a correction, not a statistical confidence level or proof of road identity.

## Subsequent roadmap

The remaining seven requested areas are future work, not hidden completed features:

1. A library-wide hill explorer with explicit confirmed hill identities, bike/route filters and terrain-based grouping independent of performance.
2. Effort-shape comparisons on distance, elapsed time and accumulated ascent. This first story view has distance/time for one source recording; accumulated-ascent comparison axes are not implemented.
3. Exploration of possible riding-mode groups with confounders and an explicit no-clear-separation result. User labels such as attack/easy must not be inferred from speed.
4. Richer preceding-climbing and ahead-terrain context across repeated efforts, with alternative explanations instead of emotional interpretation.
5. Point/section annotations and equipment history. Associate supplied corrections with exact activity IDs and times rather than guessing from filenames; retain explicit reference/comparison choices and never hard-code a date as universal baseline.
6. Optional physics-based power estimates, exposed assumptions/sensitivity, channel-consistency checks and strict separation from measured power or tested FTP.
7. An evidence-grounded assistant whose observations link to visible ranges, separate observation/explanation/unknowns and retain user corrections. Keep analysis local and require an explicit data-sharing decision before introducing an external service. Live updates require an actual live feed.
