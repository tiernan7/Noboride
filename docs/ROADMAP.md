# Noboride roadmap

Updated October 27, 2026. This is the current triage of the documented plan, recent implementation and new ideas. The proposed order below is a recommendation for discussion; no new feature or tab has been approved for implementation by this update.

## Original scope and current status

The ten areas below reconstruct the three foundations and seven follow-on areas documented in [RIDE-STORY.md](RIDE-STORY.md). They summarize the repository's plan, rather than claiming to reproduce an unavailable original request word for word. Feature implementation and validation are separate: working controls and passing synthetic/public-fixture tests do not establish correctness on every personal recording.

| Original area | Current status | Work still outstanding |
| --- | --- | --- |
| Inspect an effort in its ride context | Implemented foundation | Further checks on diverse recordings and physical devices. |
| Nested hills, ramps and passages with corrections | Implemented foundation | Further boundary/detection validation; retain manual corrections and identity rules. |
| Inspect and correct same-road relationships | Implemented foundation | Further ambiguous-road and endpoint validation. Interior distance-progress alignment remains approximate. |
| Hill identities, composite profiles and terrain exploration | Main workflow implemented; broader discovery partial | Diverse-recording alignment/coverage checks, broader route filters and terrain grouping. Automatic identity clustering remains unimplemented. |
| Compare effort shapes across hills and channels | Main plots implemented; context extensions partial | Available channels now stack with a shared axis/cursor and collapsible rows. Further context comparisons remain open; this is no longer a request to build the existing plot controls again. |
| Explore possible riding-mode groups | Deferred | Define useful, testable groups with confounders and a no-clear-separation result. Do not infer attack/easy intentions from speed or HR. |
| Preceding-climbing and ahead-terrain context | Basic surrounding-range view implemented; richer summaries pending | Explicit prior climbing/duration and terrain-ahead summaries across repeated efforts, preserving missing-data limits. |
| Point/section annotations and equipment history | Basic ride notes implemented; structured history pending | Time/range-linked observations, equipment changes and corrections tied to stable activity IDs. |
| Optional physics-based power estimates | Minimum-input foundation implemented; fuller model deferred | Momentum-aware local curves, time-weighted averages, endpoint net bounds, exposed assumptions and consistency checks exist. Air/rolling/drivetrain models require a separate model discussion. Estimates remain separate from measured power and FTP. |
| Evidence-grounded assistant | Deferred | Observations linked to visible ranges, user corrections and explicit unknowns. Keep analysis local; external sharing would require a separate decision. |

Detailed behavior and limits live in [ANALYSIS.md](ANALYSIS.md), [HILLS.md](HILLS.md) and [GRAVITY-POWER.md](GRAVITY-POWER.md). Actual check results live in [VALIDATION.md](VALIDATION.md).

## Recommended order

1. **Consolidate the current workflows.** Check a small set of representative recordings end to end: saved hill bounds versus comparison timing bounds, explicit application/reload/backup behavior, elapsed and distance labels, missing power coverage and the stacked plots on mobile. Fix reproducible discrepancies before adding another analysis layer. This is a verification task, not another replacement editor or a new tab.
2. **Structured annotations and equipment history.** Extend the existing notes with supplied observations attached to an activity, point or section, and explicit equipment-change dates. Keep original file IDs and timestamps, allow correction/removal, and make annotations visible in the existing comparison/hill workflows. This was already in the original plan and supplies useful context for later trends. Decide its navigation after defining the workflow; it does not automatically need a standalone tab.
3. **Consider a Progress tab.** This is a new proposal described below, not an outstanding original promise. Its first version could reuse existing ride notes; a complete equipment-history feature is not a hard dependency.

The remaining original work stays on the list: richer approach/aftermath summaries, terrain/route filtering and broader validation. Reprioritize those if a concrete ride question makes them more useful than the next proposed step. Keep riding-mode classification, an assistant and a fuller resistance model deferred until their purpose, inputs and validation are agreed.

## New proposal: Progress

Progress would answer “How have my passes on this road changed over time?” Comparisons inspects particular passes; Hills describes terrain and across-recording variation. A date-based view would add a different workflow rather than duplicate those plots.

A small first version would:

- Select one existing comparison road definition with fixed timing endpoints, optionally found through its named hill.
- Show elapsed time by date, individual passes and a clearly named per-ride summary. Retain repeated laps without giving a ride with more laps extra weight in an overall trend.
- Show available HR and approach/entry speed as context, alongside existing notes and any supplied equipment/condition annotations. Missing metadata stays unknown.
- Filter included rides and dates explicitly and open a selected pass in Comparisons for inspection.

Acceptance conditions should be agreed before implementation:

- A named hill alone does not establish identical timing bounds: its members can have different hill-only coverage. Do not build a time trend directly from those differing durations.
- Use the existing conservative common-endpoint verification. Differently trimmed/manual, rejected or unverified passes need distinct status and are excluded from the verified timing trend by default. Do not silently trim them or change saved sections to manufacture comparability.
- Distinguish best pass, individual passes and per-ride averages; do not silently substitute one for another. Show support counts and gaps.
- Preserve current baseline, accepted ranges, source samples and comparison ownership. Plan any new persistence or migration explicitly.
- Trends describe observations. They do not prove improved fitness, equal effort or an equipment effect, and estimated power must retain its model assumptions.

The open product decision is whether Progress answers a more useful next question than completing structured annotations or richer ride context. Its own tab is justified only if the date-based workflow is worth using separately.

## Other existing proposal

[COMPARISON-DESIGN.md](COMPARISON-DESIGN.md) separately records section coverage across partially overlapping ride groups and discovery of previously unselected shared stretches. Contexts, multiple passes and manually paired efforts are implemented, but broad shared-stretch discovery and a cross-comparison coverage matrix remain proposals. They are not silently added to the next implementation batch.
