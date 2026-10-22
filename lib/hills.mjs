import { atDistance, lowerBound, summarize } from "./analysis.mjs";
import { comparisonNameKey, stretchPoints } from "./comparisons.mjs";
import { detectClimbs } from "./ride-story.mjs";

const indexAtDistance = (points, distance) => {
  const i = lowerBound(points, distance);
  if (!i || points[i].d === distance) return i;
  const a = points[i - 1],
    b = points[i];
  return i - 1 + (distance - a.d) / (b.d - a.d);
};

/** A full physical 50 m window, contained in the observed hill; never an edge spike. */
function steepestRamp(points, sourcePoints) {
  const first = points[0].d,
    last = points.at(-1).d,
    window = 50;
  if (last - first < window) return null;
  const starts = new Set([first, last - window]);
  for (const p of points) {
    if (p.d + window <= last) starts.add(p.d);
    if (p.d - window >= first) starts.add(p.d - window);
  }
  const bad = [0];
  for (let i = 0; i < points.length; i++)
    bad.push(
      bad.at(-1) +
        Number(
          points[i].ele == null ||
            (i > 0 &&
              (points[i].breakBefore || points[i].t - points[i - 1].t > 30000)),
        ),
    );
  let best = null;
  for (const distance of [...starts].sort((a, b) => a - b)) {
    const endDistance = distance + window,
      start = indexAtDistance(points, distance),
      end = indexAtDistance(points, endDistance),
      a = atDistance(points, distance),
      b = atDistance(points, endDistance);
    if (
      a.ele == null ||
      b.ele == null ||
      bad[Math.ceil(end) + 1] - bad[Math.floor(start) + 1]
    )
      continue;
    const grade = (100 * (b.ele - a.ele)) / window;
    if (!best || grade > best.grade + 1e-9)
      best = {
        grade,
        start: indexAtDistance(sourcePoints, distance),
        end: indexAtDistance(sourcePoints, endDistance),
        length: window,
        progress: (distance + window / 2 - first) / (last - first),
      };
  }
  return best;
}

/** Derived observations only. Library identity never rewrites imported points or comparison sections. */
export function buildHillObservations(rides, saved = []) {
  const observations = [];
  for (const ride of rides) {
    if (!Array.isArray(ride.points) || ride.points.length < 2) continue;
    for (const hill of [
      ...detectClimbs(ride.points).filter((node) => node.kind === "hill"),
      ...saved
        .filter((item) => item.rideId === ride.id)
        .map((item) => ({ ...item, saved: true })),
    ]) {
      const samples = stretchPoints(ride.points, hill.start, hill.end),
        stats = summarize(samples),
        ramp = steepestRamp(samples, ride.points),
        before = Math.max(ride.points[0].d, samples[0].d - 100),
        approachStart = indexAtDistance(ride.points, before),
        approach =
          approachStart < hill.start
            ? summarize(stretchPoints(ride.points, approachStart, hill.start))
            : null;
      observations.push({
        id: hill.saved ? hill.id : `${ride.id}:${hill.id}`,
        rideId: ride.id,
        start: hill.start,
        end: hill.end,
        kind: "hill",
        name: hill.name,
        ...(hill.alignment ? { alignment: hill.alignment } : {}),
        rideName: ride.name || "Unnamed ride",
        date: ride.date || null,
        bike: ride.notes?.bike || "",
        length: stats.distance,
        netGain:
          stats.grade == null ? null : (stats.grade * stats.distance) / 100,
        avgGrade: stats.grade,
        ascent: hill.saved ? stats.ascent : hill.ascent,
        startTime: samples[0].t,
        elapsed: stats.elapsed,
        positionDistance: samples[0].d - ride.points[0].d,
        positionSeconds: (samples[0].t - ride.points[0].t) / 1000,
        steepestGrade: ramp?.grade ?? null,
        steepestProgress: ramp?.progress ?? null,
        steepestRamp: ramp,
        meanSpeed: stats.speed,
        meanHr: stats.hr,
        meanCad: stats.cadence,
        meanPower: stats.power,
        approachSpeed: approach && !approach.gaps ? approach.speed : null,
      });
    }
  }
  return observations;
}

/** Human-reviewed physical hill identities; names and membership are explicitly reversible. */
export function validateHillLibrary(value, observations) {
  if (!value || !Array.isArray(value.groups) || value.groups.length > 1000)
    throw new Error("Invalid hill library (maximum 1000 hill identities).");
  const available = new Set(observations.map((o) => o.id)),
    ids = new Set(),
    names = new Set(),
    assigned = new Set();
  return {
    ...(value.observations?.length ? { observations: value.observations } : {}),
    groups: value.groups.map((group) => {
      if (
        !group ||
        typeof group.id !== "string" ||
        !group.id.trim() ||
        group.id.length > 240 ||
        ids.has(group.id)
      )
        throw new Error("Hill identity IDs must be nonempty and unique.");
      if (
        typeof group.name !== "string" ||
        !group.name.trim() ||
        group.name.length > 120
      )
        throw new Error("Name each hill identity using 1–120 characters.");
      const name = group.name.trim().replace(/\s+/g, " "),
        key = comparisonNameKey(name);
      if (names.has(key))
        throw new Error("Hill identity names must be unique.");
      if (
        !Array.isArray(group.observationIds) ||
        !group.observationIds.length ||
        group.observationIds.length > 2000
      )
        throw new Error("A hill identity needs 1–2000 observed hill passes.");
      ids.add(group.id);
      names.add(key);
      const observationIds = group.observationIds.map((id) => {
        if (typeof id !== "string" || !available.has(id))
          throw new Error(
            "A hill identity references an unavailable hill observation.",
          );
        if (assigned.has(id))
          throw new Error(
            "Each hill observation can belong to only one hill identity.",
          );
        assigned.add(id);
        return id;
      });
      return { id: group.id, name, observationIds };
    }),
  };
}

/** Removing a source ride drops only its identity memberships; retained observations keep their names. */
export function pruneHillLibrary(library, observations) {
  const available = new Set(observations.map((o) => o.id));
  return {
    ...(library.observations?.length
      ? {
          observations: library.observations.filter((o) => available.has(o.id)),
        }
      : {}),
    groups: library.groups
      .map((group) => ({
        ...group,
        observationIds: group.observationIds.filter((id) => available.has(id)),
      }))
      .filter((group) => group.observationIds.length),
  };
}

export function validateSavedHillObservations(value, getRide) {
  if (!Array.isArray(value) || value.length > 2000)
    throw new Error("Invalid saved hill passes (maximum 2000).");
  const ids = new Set();
  return value.map((item) => {
    const ride = item && getRide(item.rideId);
    if (
      !ride ||
      typeof item.id !== "string" ||
      !item.id.startsWith("saved-") ||
      item.id.length > 240 ||
      ids.has(item.id) ||
      !Number.isFinite(item.start) ||
      !Number.isFinite(item.end) ||
      item.start < 0 ||
      item.end > ride.points.length - 1 ||
      item.start >= item.end ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 120
    )
      throw new Error(
        "A saved hill pass has an unavailable ride or invalid source range/name.",
      );
    const points = stretchPoints(ride.points, item.start, item.end);
    if (points.at(-1).d - points[0].d < 20)
      throw new Error("Saved hill passes must span at least 20 meters.");
    if (
      item.alignment !== undefined &&
      (!item.alignment ||
        item.alignment.version !== 1 ||
        item.alignment.reviewed !== true ||
        !Number.isFinite(item.alignment.sourceStart) ||
        !Number.isFinite(item.alignment.sourceEnd) ||
        item.alignment.sourceStart < 0 ||
        item.alignment.sourceEnd > ride.points.length - 1 ||
        item.alignment.sourceStart >= item.alignment.sourceEnd)
    )
      throw new Error("Invalid saved hill alignment review.");
    ids.add(item.id);
    return {
      id: item.id,
      rideId: ride.id,
      start: item.start,
      end: item.end,
      name: item.name.trim(),
      ...(item.alignment
        ? {
            alignment: {
              version: 1,
              reviewed: true,
              sourceStart: item.alignment.sourceStart,
              sourceEnd: item.alignment.sourceEnd,
            },
          }
        : {}),
    };
  });
}

/** One plotted item per reviewed hill; repeated passes do not become extra hills. */
export function summarizeHillGroups(library, observations) {
  const indexed = new Map(observations.map((o) => [o.id, o]));
  return library.groups
    .map((group) => {
      const members = group.observationIds
          .map((id) => indexed.get(id))
          .filter(Boolean),
        result = {
          id: group.id,
          name: group.name,
          members,
          ranges: {},
          rideIds: [...new Set(members.map((o) => o.rideId))],
        };
      for (const metric of [
        "length",
        "netGain",
        "avgGrade",
        "meanSpeed",
        "meanHr",
      ]) {
        const byRide = new Map();
        for (const o of members) {
          if (!Number.isFinite(o[metric])) continue;
          if (!byRide.has(o.rideId)) byRide.set(o.rideId, []);
          byRide.get(o.rideId).push(o[metric]);
        }
        const values = [...byRide.values()].map(
          (vs) => vs.reduce((a, b) => a + b, 0) / vs.length,
        );
        result[metric] = values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null;
        result.ranges[metric] = values.length
          ? {
              min: Math.min(...values),
              max: Math.max(...values),
              rides: values.length,
            }
          : null;
      }
      return result;
    })
    .filter((hill) => hill.members.length);
}

/** Identity follows saved provenance, independently of GPS-trimmed comparison bounds. */
export function hillMembership(entry, library, observations) {
  const member = (observation) => {
    const group = library.groups.find((g) =>
      g.observationIds.includes(observation.id),
    );
    return group ? { observation, group } : null;
  };
  for (const id of [entry.hillObservationId, `saved-${entry.id}`]) {
    const observation = observations.find(
      (o) => o.id === id && o.rideId === entry.rideId,
    );
    const found = observation && member(observation);
    if (found) return found;
  }
  const origin = observations.find(
    (o) => o.id === entry.hillObservationId && o.rideId === entry.rideId,
  );
  let matches = observations
    .filter(
      (o) =>
        o.rideId === entry.rideId &&
        ((o.start === entry.start && o.end === entry.end) ||
          (o.alignment?.sourceStart === entry.start &&
            o.alignment?.sourceEnd === entry.end) ||
          (origin &&
            o.alignment?.sourceStart === origin.start &&
            o.alignment?.sourceEnd === origin.end)),
    )
    .map(member)
    .filter(Boolean);
  if (matches.length > 1 && entry.hillGroupId)
    matches = matches.filter((m) => m.group.id === entry.hillGroupId);
  return matches.length === 1 ? matches[0] : null;
}
