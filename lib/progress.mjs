import { DEFAULTS, findMatches, interpolate, summarize } from "./analysis.mjs";
import { stretchPoints } from "./comparisons.mjs";

// Descriptive trends of accepted passes only. Never discover or rewrite entries.
export function buildProgress(comparison, getRide, selectedIds) {
  const selected = new Set(selectedIds ?? comparison.selected ?? []);
  const settings = { ...DEFAULTS, ...comparison.settings };
  const referenceRide = comparison.road && getRide(comparison.road.rideId);
  const canonical =
    referenceRide &&
    stretchPoints(
      referenceRide.points,
      comparison.road.start,
      comparison.road.end,
    );
  const cache = new Map(),
    counts = new Map();
  const rows = comparison.entries.map((entry) => {
    const pass = (counts.get(entry.rideId) || 0) + 1;
    counts.set(entry.rideId, pass);
    const row = {
      entryId: entry.id,
      rideId: entry.rideId,
      pass,
      eligible: false,
      reason: "",
      timestamp: null,
      elapsed: null,
      distance: null,
      hr: null,
      speed: null,
      entrySpeed: null,
    };
    if (entry.review === "rejected")
      row.reason = "Pairing rejected in Comparisons.";
    else if (!selected.has(entry.rideId)) row.reason = "Ride is not included.";
    else if (
      comparison.mode === "terrain" ||
      !canonical ||
      comparison.roadPending
    )
      row.reason = "A common comparison road is required.";
    else if (entry.kind === "effort" || entry.relation === "similar-terrain")
      row.reason =
        "Manual range: identical timing endpoints have not been verified.";
    else if (
      entry.kind === "source" &&
      (entry.rideId !== comparison.road.rideId ||
        entry.start !== comparison.road.start ||
        entry.end !== comparison.road.end)
    )
      row.reason = "Source bounds differ from the comparison road.";
    else {
      const ride = getRide(entry.rideId);
      if (!ride) row.reason = "Source track unavailable.";
      else {
        if (!cache.has(ride.id))
          cache.set(
            ride.id,
            findMatches(ride, canonical, settings.matchRadius),
          );
        const match = cache
          .get(ride.id)
          .find(
            (m) =>
              Math.abs(m.startIndex - entry.start) < 0.02 &&
              Math.abs(m.endIndex - entry.end) < 0.02,
          );
        if (!match)
          row.reason =
            "Current common-endpoint, route or continuity checks failed.";
        else {
          const points = match.points,
            stats = summarize(points, settings);
          const endTime = Math.min(points.at(-1).t, points[0].t + 5000);
          const i = points.findIndex((p) => p.t >= endTime);
          const end =
            i > 0
              ? interpolate(
                  points[i - 1],
                  points[i],
                  (endTime - points[i - 1].t) / (points[i].t - points[i - 1].t),
                )
              : points[0];
          Object.assign(row, {
            eligible: true,
            timestamp: points[0].t,
            elapsed: stats.elapsed,
            distance: stats.distance,
            hr: stats.hr,
            speed: stats.speed,
            entrySpeed:
              endTime > points[0].t
                ? (end.d - points[0].d) / ((endTime - points[0].t) / 1000)
                : null,
          });
        }
      }
    }
    return row;
  });
  return {
    rows,
    roadDistance: canonical ? canonical.at(-1).d - canonical[0].d : null,
  };
}

const fields = ["elapsed", "distance", "hr", "speed", "entrySpeed"];
export function progressPoints(rows, mode = "ride-mean") {
  const available = rows.filter((row) => row.eligible);
  if (mode === "passes")
    return available.map((row) => ({
      ...row,
      entryIds: [row.entryId],
      count: 1,
    }));
  const rides = new Map();
  for (const row of available) {
    if (!rides.has(row.rideId)) rides.set(row.rideId, []);
    rides.get(row.rideId).push(row);
  }
  return [...rides.values()].map((passes) => {
    const best = [...passes].sort(
      (a, b) => a.elapsed - b.elapsed || a.timestamp - b.timestamp,
    )[0];
    if (mode === "best")
      return { ...best, entryIds: [best.entryId], count: passes.length };
    const result = {
      rideId: passes[0].rideId,
      entryId: passes.length === 1 ? passes[0].entryId : null,
      entryIds: passes.map((p) => p.entryId),
      count: passes.length,
      timestamp: Math.min(...passes.map((p) => p.timestamp)),
      support: {},
    };
    for (const field of fields) {
      const values = passes.map((p) => p[field]).filter(Number.isFinite);
      result[field] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null;
      result.support[field] = values.length;
    }
    return result;
  });
}
