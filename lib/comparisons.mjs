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

// Source-interval identity only: overlapping laps on a map remain separate in time.
export function sectionCandidates(range, candidates, points, threshold = 60) {
  const distance = (index) => {
    const lo = Math.floor(index),
      hi = Math.ceil(index);
    return points[lo].d + (points[hi].d - points[lo].d) * (index - lo);
  };
  return candidates
    .filter((candidate) => candidate.rideId === range.rideId)
    .map((candidate) => {
      const start = Math.max(range.start, candidate.start),
        end = Math.min(range.end, candidate.end);
      const span =
        distance(Math.max(range.end, candidate.end)) -
        distance(Math.min(range.start, candidate.start));
      return {
        candidate,
        score:
          start < end && span > 0
            ? (100 * (distance(end) - distance(start))) / span
            : 0,
      };
    })
    .filter((item) => item.score + 1e-9 >= threshold)
    .sort((a, b) => b.score - a.score);
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
    const sectionIds = new Set();
    if (
      v.sections !== undefined &&
      (!Array.isArray(v.sections) || v.sections.length > 1000)
    )
      throw new Error("Invalid comparison sections (maximum 1000).");
    const sections = (v.sections || []).map((section) => {
      const source = range(section),
        key = `${source.rideId}:${section.id}`;
      if (
        typeof section.id !== "string" ||
        !section.id ||
        section.id.length > 160 ||
        sectionIds.has(key) ||
        typeof section.name !== "string" ||
        !section.name.trim() ||
        section.name.length > 120 ||
        !["section", "passage", "hill", "ramp"].includes(section.kind) ||
        (section.manual !== undefined && typeof section.manual !== "boolean") ||
        (section.deleted !== undefined && typeof section.deleted !== "boolean")
      )
        throw new Error("Invalid comparison section.");
      const points = getRide(source.rideId).points;
      const distance = (index) =>
        points[Math.floor(index)].d +
        (points[Math.ceil(index)].d - points[Math.floor(index)].d) *
          (index - Math.floor(index));
      if (distance(source.end) - distance(source.start) < 20)
        throw new Error("Sections must span at least 20 meters.");
      sectionIds.add(key);
      return {
        id: section.id,
        ...source,
        kind: section.kind,
        name: section.name.trim(),
        ...(section.manual === true ? { manual: true } : {}),
        ...(section.deleted === true ? { deleted: true } : {}),
      };
    });
    const entryIds = new Set();
    const includedSections = new Set();
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
      if (entry.sectionId !== undefined) {
        const key = `${entry.rideId}:${entry.sectionId}`;
        if (
          typeof entry.sectionId !== "string" ||
          !entry.sectionId ||
          entry.sectionId.length > 160 ||
          includedSections.has(key)
        )
          throw new Error(
            "A section can only be included once in a comparison.",
          );
        includedSections.add(key);
        const section = sections.find(
          (item) => item.rideId === entry.rideId && item.id === entry.sectionId,
        );
        if (
          !section ||
          section.deleted ||
          section.start !== entry.start ||
          section.end !== entry.end
        )
          throw new Error(
            "Included section boundaries must match their comparison section.",
          );
      }
      if (
        entry.relation !== undefined &&
        !["same-road", "similar-terrain"].includes(entry.relation)
      )
        throw new Error("Invalid road relationship.");
      if (
        entry.review !== undefined &&
        !["confirmed", "rejected"].includes(entry.review)
      )
        throw new Error("Invalid match review.");
      if (
        (entry.kind === "source" || entry.kind === "matched") &&
        entry.relation === "similar-terrain"
      )
        throw new Error(
          "Similar-terrain entries must use manual effort pairing.",
        );
      if (entry.kind === "source" && entry.review === "rejected")
        throw new Error(
          "The selected reference road cannot be a rejected pairing.",
        );
      if (
        entry.reviewReason !== undefined &&
        (typeof entry.reviewReason !== "string" ||
          entry.reviewReason.length > 500)
      )
        throw new Error("Invalid match review reason.");
      return {
        id: entry.id,
        ...range(entry),
        kind: entry.kind,
        ...(entry.sectionId === undefined
          ? {}
          : { sectionId: entry.sectionId }),
        ...(entry.relation === undefined ? {} : { relation: entry.relation }),
        ...(entry.review === undefined ? {} : { review: entry.review }),
        ...(entry.reviewReason === undefined
          ? {}
          : { reviewReason: entry.reviewReason }),
      };
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
    if (
      v.matchDecisions !== undefined &&
      (!Array.isArray(v.matchDecisions) || v.matchDecisions.length > 500)
    )
      throw new Error("Invalid match decisions.");
    const matchDecisions = (v.matchDecisions || []).map((decision) => {
      if (
        decision.decision !== "rejected" ||
        typeof decision.reason !== "string" ||
        decision.reason.length > 500
      )
        throw new Error("Invalid match decision.");
      return {
        ...range(decision),
        decision: "rejected",
        reason: decision.reason,
      };
    });
    return {
      id: v.id,
      name,
      entries,
      ...(v.sections === undefined ? {} : { sections }),
      road: v.road ? range(v.road) : null,
      selected,
      drafts,
      matchDecisions,
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
