# Section-centered comparisons — proposal

This is the broader design proposal. The dev branch now implements named comparison contexts, source ride tabs, multiple accepted stretches per ride, manual effort pairing and reviewable matches against the first selected road. Automatic discovery of previously unselected shared subsections and a cross-comparison coverage matrix remain future work. The sequence below records that broader direction rather than claiming every part is shipped.

## Organize around shared sections, not one global base ride

Three rides need not all share the same road. If A and B share a hill, while B and C share a descent, show two comparison cards:

| Section | A | B | C |
| --- | --- | --- | --- |
| Hill | Matched pass | Matched pass | No shared pass found |
| Descent | No shared pass found | Matched pass | Matched pass |

B participates in both comparisons. A and C are not implicitly compatible just because each overlaps B. A recording may contribute several distinct passes to one section, and sections may overlap. Do not add overlapping sections into a whole-ride result.

The current map, profiles and pass table can remain the editor for the active card. A section list or small coverage table above them answers which rides are comparable and where. Each section owns its geometry reference and timing baseline. Defaults can use the same ride/pass, with a clearly named advanced choice if needed; changing one card must not silently alter another.

## Reuse known sections first

On an explicit Compare action, check included rides against relevant saved sections using endpoint, direction, shape and continuity verification. Show each section's matched rides and passes. Keep unavailable reference rides distinguishable from a failed match. Search other imported rides only when requested, fetching tracks on demand rather than loading the entire library.

A saved section is a reusable road definition, not a fixed pair of activities. A comparison selects passes against that definition. Keep saved section definitions separate from unconfirmed suggestions and from manually paired efforts.

## Suggest new sections when whole routes differ

For included rides, discover candidate shared stretches using local GPS geometry. Use bounding boxes or a spatial index to avoid scanning every point against every other point. Pairwise overlapping intervals can generate candidate road definitions, but each participating pass must independently verify against the same proposed section geometry.

Suggest sustained common stretches, not every short crossing. Require consistent direction and ordered geometry; split at divergence, explicit breaks and unsupported GPS gaps. Consolidate near-duplicate suggestions without merging distinct repeated passes or combining stretches across a detour. Reuse the current conservative verifier where applicable. Discovery thresholds and endpoint rules require independent tests before release; do not invent confidence percentages.

Show suggestions such as “Shared hill · A and B · inspect endpoints,” with length, participating rides, miss distances and any gap bridging. “No shared pass found” means not established, not proof that the roads differ. Distinguish verified matches, suggestions needing review, unavailable tracks and manual selections with reasons. The user can preview, adjust boundaries, accept/save or dismiss a suggestion. Automatic proposals must not overwrite named sections or manual corrections.

## Ask for the missing information at the relevant section

If a candidate is ambiguous, ask the user to select the intended stretch on one ride, then try finding that same stretch in the others. If a particular ride still fails, offer manual endpoint selection for that ride. Keep every source ride's original endpoints, direction and sample provenance, along with the automatic checks or explicit manual override used.

Offer a separate “Compare different stretches” action for unrelated roads. Each effort gets its own start/end range. Show distance, duration, elevation/grade and recorded sensors so users can judge comparability. Similar duration or gradient can aid discovery but cannot establish equal effort. Do not use same-road terrain time-savings attribution for unrelated stretches. Label these comparisons as manually paired efforts; do not merge them into shared-road suggestions.

## Implementation sequence and validation

1. Build section cards/coverage from existing saved definitions and verified matches, including partially overlapping ride groups. This solves organization before introducing new discovery algorithms.
2. Add reviewable shared-stretch suggestions with explicit bounds and reasons.
3. Add saved groups of independently selected efforts.

Keep these as separate changes. Schema work needs a backup/migration strategy; this proposal changes no schema. Tests should cover A/B and B/C overlaps without A/C inference, disjoint overlaps on B, common subsections, reverse directions, crossings, nearby parallel roads, repeated laps, gaps, uneven/noisy GPS, duplicate suggestions and retained manual edits. Use seeded simulations and independent ground truth. All discovery stays local, with bounded work and honest uncertainty.
