import { interpolate } from "./analysis.mjs";

export const comparisonNameKey = (name) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

// Suggestion de-duplication only: this does not verify a manual edit as a GPS match.
export function coversSuggestedPass(entry, match, points, threshold = 60) {
  if (entry.start === match.startIndex && entry.end === match.endIndex)
    return true;
  const start = Math.max(entry.start, match.startIndex),
    end = Math.min(entry.end, match.endIndex);
  if (start >= end) return false; // Separate laps must remain separate suggestions.
  const distance = (index) => {
    const lo = Math.floor(index),
      hi = Math.ceil(index);
    return points[lo].d + (points[hi].d - points[lo].d) * (index - lo);
  };
  const shared = distance(end) - distance(start),
    combined =
      distance(Math.max(entry.end, match.endIndex)) -
      distance(Math.min(entry.start, match.startIndex));
  return combined > 0 && shared / combined + 1e-9 >= threshold / 100;
}

export function stretchPoints(points, start, end) {
  const sample = (index) => {
    const lo = Math.floor(index),
      hi = Math.ceil(index);
    return lo === hi
      ? { ...points[lo] }
      : interpolate(points[lo], points[hi], index - lo);
  };
  return [
    sample(start),
    ...points.slice(Math.floor(start) + 1, Math.ceil(end)),
    sample(end),
  ];
}

export function validateComparisons(value, getRide, settings) {
  if (!value || !Array.isArray(value.items) || value.items.length > 100)
    throw new Error("Invalid comparisons workspace (maximum 100 comparisons).");
  const ids = new Set(),
    names = new Set();
  const readRide = getRide,
    cache = new Map();
  getRide = (id) => {
    if (!cache.has(id)) cache.set(id, readRide(id));
    return cache.get(id);
  };
  const range = (v) => {
    const ride = v && getRide(v.rideId);
    if (
      !ride ||
      !Number.isFinite(v.start) ||
      !Number.isFinite(v.end) ||
      v.start < 0 ||
      v.end > ride.points.length - 1 ||
      v.start >= v.end
    )
      throw new Error(
        "A comparison stretch has an unavailable ride or invalid endpoints.",
      );
    return { rideId: ride.id, start: v.start, end: v.end };
  };
  const selectionRange = (v) => {
    const selected = range(v);
    if (!Number.isInteger(selected.start) || !Number.isInteger(selected.end))
      throw new Error("Source selections must use recorded sample endpoints.");
    return selected;
  };
  const items = value.items.map((v) => {
    if (
      !v ||
      typeof v.id !== "string" ||
      !v.id ||
      v.id.length > 120 ||
      ids.has(v.id) ||
      typeof v.name !== "string" ||
      v.name.length > 120 ||
      !Array.isArray(v.entries) ||
      v.entries.length > 200
    )
      throw new Error("Invalid comparison.");
    ids.add(v.id);
    const name = v.name.trim().replace(/\s+/g, " "),
      key = comparisonNameKey(name);
    if (names.has(key))
      throw new Error(
        key
          ? "A comparison with that name already exists."
          : "Name the existing unnamed comparison before adding another.",
      );
    names.add(key);
    const entryIds = new Set();
    const entries = v.entries.map((entry) => {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !entry.id ||
        entry.id.length > 120 ||
        entryIds.has(entry.id) ||
        !["source", "matched", "effort"].includes(entry.kind)
      )
        throw new Error("Invalid comparison entry.");
      entryIds.add(entry.id);
      return { id: entry.id, ...range(entry), kind: entry.kind };
    });
    if (entries.length && !v.road)
      throw new Error("A comparison with stretches needs a road definition.");
    const selected = Array.isArray(v.selected)
      ? [...new Set(v.selected)]
          .filter((id) => typeof id === "string" && getRide(id))
          .slice(0, 1000)
      : [];
    if (
      v.drafts !== undefined &&
      (!Array.isArray(v.drafts) || v.drafts.length > 1000)
    )
      throw new Error("Invalid source selections.");
    const draftRides = new Set();
    const drafts = (v.drafts || []).map((d) => {
      const draft = selectionRange(d);
      if (draftRides.has(draft.rideId))
        throw new Error("Duplicate source selection.");
      draftRides.add(draft.rideId);
      return draft;
    });
    return {
      id: v.id,
      name,
      entries,
      road: v.road ? range(v.road) : null,
      selected,
      drafts,
      browse: v.browse ? selectionRange(v.browse) : null,
      baseline: entryIds.has(v.baseline) ? v.baseline : entries[0]?.id || "",
      comparison: entryIds.has(v.comparison) ? v.comparison : "",
      metric: ["ele", "speed", "hr", "cad", "power", "grade", "delta"].includes(
        v.metric,
      )
        ? v.metric
        : "ele",
      settings: settings(v.settings || {}),
    };
  });
  if (items.length && !ids.has(value.activeId))
    throw new Error("Active comparison not found.");
  return { activeId: items.length ? value.activeId : "", items };
}
