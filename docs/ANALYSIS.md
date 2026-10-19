# Analysis methods and limits

## Import normalization

FIT decoding uses Garmin's official JavaScript SDK, with scale/offset, subfields/components, date conversion and heart-rate merging enabled. Semicircle positions are converted to degrees. Enhanced altitude/speed take precedence; array-valued fields are handled. Timer events mark pauses when present. The file's integrity check must pass.

TCX activity/lap/track records preserve recorded distance and supported sensor extensions; device lap timer values are summed. Empty or untimed GPX/TCX sibling tracks/activities are skipped without discarding later usable tracks. GPX requires timestamps, preserves explicit track-segment breaks and supports Garmin TrackPointExtension HR/cadence/temperature. XML external entities/DOCTYPE are rejected.

Points are sorted by timestamp; duplicate timestamps are removed. Implausible sensor values are made missing, not clipped to plausible-looking numbers. Cumulative-distance resets are offset and warned about. When distance is absent, continuous GPS legs supply haversine distance, falling back to recorded speed. No GPS chord is added over explicit breaks or time gaps over 30 seconds. Summary metadata and normalized tracks are kept separately; tracks are gzip-compressed inside SQLite. IDs are hashes of input content plus session/track index, enabling repeat-import deduplication. A FIT and TCX export of the same activity may still produce separate IDs; include only the representation you want.

## GPS gates and passes

Each reference endpoint is projected onto every continuous GPS leg of another ride, using a local tangent-plane projection and clamping to each leg. Adjacent hits within the gate radius are clustered; the nearest projection in each visit supplies an interpolated sample and timestamp. This keeps repeated visits to a gate on different laps separate.

Candidate start/end visits must be chronological and between 0.65 and 1.5 times the reference section's recorded distance. Thirty-three ordered probes compare candidate and reference geometry at equal distance progress. The largest offset must be below max(65 m, 2.5 × gate radius). This rejects opposite-direction passes, substantial detours and routes with only endpoints in common. It is deliberately conservative, not a full road-network map matcher. Automatic matching does not bridge explicit breaks or recording gaps over 30 seconds. A brief interior loss of GPS is bridged only for geometry verification when bounding GPS observations are at most 30 seconds apart. Original missing coordinates and other source samples remain missing. The maximum bridge duration is exposed in the GPS-offset cell and CSV. That fixed matching continuity limit is separate from the configurable statistical gap threshold.

Endpoints are interpolated within samples. The table exposes both gate miss distances and the maximum ordered-route offset (hover the GPS-offset cell). Map markers show the actual matched endpoints. Reference-marker dragging and coordinate snapping select the nearest recorded reference sample. If the road is revisited on several laps, use chart/sliders to disambiguate.

Manual pass selection bypasses route checks and replaces the automatic passes for that ride/section. It is visibly labeled. Save the section to persist the override. Only one manual pass per ride/section is supported in this version; automatic matching supports multiple passes.

## Timing, sensors and missing data

Elapsed time is end timestamp minus start timestamp. Timer time is the integration of FIT timer events when available. Whole-ride source timer/moving metadata are displayed separately. Moving estimate integrates intervals whose distance/time exceeds the selected threshold and whose starting timer state is not paused. Recording gaps are excluded from moving estimates.

HR, cadence and recorded power use trapezoidal time weighting over intervals where both endpoints have data, excluding gaps and explicit breaks. This avoids weighting dense sampling more than sparse sampling. Missing sensor values are never zero-filled. Zero cadence or watts, if recorded, are valid.

## Grade and altitude

For each sample, an adjustable physical-distance window is centered on its cumulative distance and clipped to the section's boundaries. Elevation is interpolated at the window endpoints; grade = 100 × elevation change / distance change. Windows crossing missing elevation, explicit breaks or recording gaps return missing grade. Short edge windows below max(5 m, one quarter of the chosen window) are omitted. This is a defined smoothing method rather than Garmin's proprietary grade calculation.

The display uses the 3/6/9/12% color thresholds. Negative and gentle grades share the lightest color on the elevation profile; use the grade comparison chart for signed slope. A steep-looking edge in a graph can be an elevation-data artifact. The method cannot recover terrain detail absent from the file.

Relative elevation overlays subtract each pass's initial altitude; they do not force its endpoint elevations to match. Estimated ascent/descent use a 3 m deadband to reduce tiny noisy reversals and are not an official Garmin total.

## Terrain time attribution

All passes use the chosen reference's grade profile, with climbs above +threshold and descents below -threshold; the rest is level. The default threshold is ±1%. Each observed moving interval is subdivided into spans no longer than 10 m. At each midpoint, its normalized distance progress is mapped onto the reference profile, and that fraction of elapsed interval time goes to the corresponding terrain class. Slow/known-paused intervals, recording gaps and unknown-grade intervals have separate buckets. Bucket totals equal elapsed time, apart from floating-point rounding.

This produces an approximate answer to “how much of the time gain came downhill?” without relabeling a road because another recording had a shifted altitude. It is not exact geographic alignment at every interior point: differing wheel/GPS distance accumulation or a manual pass on another road can distort allocation. Inspect route overlays and endpoints. Saved overlapping sections are never silently added together into a whole-ride total.

Cumulative delta curves and sensor overlays use the same distance-progress convention. The final delta equals elapsed-time difference. Intermediate values are interpolated observations, not independent measurements. No significance tests, model-derived power or inferred physiological thresholds are presented.

## Public recording and noise regression coverage

`tests/fixtures/cerknicko-jezero.gpx` is a public timed track from gpxpy, pinned to a repository commit with a SHA-256 checksum in `source.json`. The upstream license is alongside it. Its first empty track exposed an import bug now fixed. The unchanged recording's longest continuous 55-sample section matches at its original 446-second duration (about 645.22 m).

Additional tests resample the public GPS polyline to 5 m intervals, assign controlled synthetic timestamps and sensors, and then perturb the observations. This is real recorded track geometry with simulated sampling/performance, not a new real-world ride or a surveyed road centerline. Straight interpolation between sparse source points cannot recover the road's missing curves. The original recording's sport/provenance is not independently verified.

Thirty fixed seeds use independent Gaussian jitter (2 m standard deviation per coordinate axis), temporally correlated drift (6 m marginal standard deviation, AR(1) coefficient 0.96), 1–7-step variable sampling, altitude offset/noise and a known 1.08 speed factor. In the current run all 30 matched and maximum endpoint-duration error was 3.39 s against a 12 s test tolerance. Ten additional independent noisy-reference/noisy-candidate pairs matched. These finite simulations are regression coverage, not a statistical accuracy guarantee for a particular receiver.

Other cases cover GPS-derived distance, repeated noisy passes, short GPS dropout, long GPS-only/recording outages, sustained 180 m displacement, alternate paths, and stationary recorded distance despite GPS jitter. Large or discontinuous errors are deliberately rejected for manual review rather than automatically accepted.
