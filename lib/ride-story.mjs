import {
  gradeProfile,
  hasGPS,
  haversine,
  atProgress,
  lowerBound,
} from "./analysis.mjs";
import { stretchPoints, sectionCandidates } from "./comparisons.mjs";

export const CLIMB_DEFAULTS = Object.freeze({
  hillDrop: 3,
  minGain: 10,
  minLength: 80,
  rampGrade: 6,
  rampLength: 50,
  passageDip: 15,
  passageGap: 500,
});

export function validateClimbEdits(value, points) {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("Invalid climb corrections (maximum 200).");
  const ids = new Set();
  return value.map((edit) => {
    if (
      !edit ||
      typeof edit.id !== "string" ||
      !edit.id ||
      edit.id.length > 120 ||
      ids.has(edit.id) ||
      !["passage", "hill", "ramp"].includes(edit.kind) ||
      (edit.manual != null && typeof edit.manual !== "boolean") ||
      typeof edit.name !== "string" ||
      !edit.name.trim() ||
      edit.name.length > 120 ||
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end >= points.length ||
      edit.start >= edit.end ||
      points[edit.end].d - points[edit.start].d < 20
    )
      throw new Error(
        "Climb corrections need a name and valid boundaries of at least 20 meters.",
      );
    ids.add(edit.id);
    return {
      id: edit.id,
      kind: edit.kind,
      name: edit.name.trim(),
      start: edit.start,
      end: edit.end,
      ...(edit.manual === true ? { manual: true } : {}),
    };
  });
}

/** Terrain-only suggestions. No speed, HR, power or activity date enters detection. */
export function detectClimbs(points, edits = [], options = {}) {
  const o = { ...CLIMB_DEFAULTS, ...options },
    hills = [];
  let valley = 0,
    peak = 0;
  const emit = () => {
    const length = points[peak].d - points[valley].d,
      gain = points[peak].ele - points[valley].ele;
    if (length >= o.minLength && gain >= o.minGain && gain / length >= 0.01)
      hills.push({
        id: `hill-${valley}-${peak}`,
        kind: "hill",
        start: valley,
        end: peak,
      });
  };
  for (let i = 0; i < points.length; i++) {
    if (
      points[i].ele == null ||
      (i &&
        (points[i].breakBefore ||
          points[i].t - points[i - 1].t > 30000 ||
          points[i - 1].ele == null))
    ) {
      if (i && points[i - 1].ele != null) emit();
      valley = peak = i;
      continue;
    }
    if (points[valley].ele == null || points[i].ele <= points[valley].ele)
      valley = peak = i;
    if (points[i].ele > points[peak].ele) peak = i;
    if (points[peak].ele - points[i].ele >= o.hillDrop) {
      emit();
      valley = peak = i;
    }
  }
  if (points.length && points.at(-1).ele != null) emit();
  const nodes = [...hills];
  // Merge ascending hills separated by bounded, observed dips; never across data gaps.
  let group = [];
  const passage = () => {
    if (group.length > 1)
      nodes.push({
        id: `passage-${group[0].start}-${group.at(-1).end}`,
        kind: "passage",
        start: group[0].start,
        end: group.at(-1).end,
      });
  };
  for (const hill of hills) {
    const previous = group.at(-1);
    let joins = !!previous;
    if (previous) {
      let lowest = points[previous.end].ele;
      for (let i = previous.end + 1; i <= hill.start; i++) {
        if (
          points[i].ele == null ||
          points[i].breakBefore ||
          points[i].t - points[i - 1].t > 30000
        ) {
          joins = false;
          break;
        }
        lowest = Math.min(lowest, points[i].ele);
      }
      joins &&=
        points[hill.start].d - points[previous.end].d <= o.passageGap &&
        points[previous.end].ele - lowest <= o.passageDip &&
        points[hill.end].ele >= points[previous.end].ele - 2;
    }
    if (!joins) {
      passage();
      group = [];
    }
    group.push(hill);
  }
  passage();
  const grades = gradeProfile(points, 50, 30);
  let rampStart = null;
  const ramp = (end) => {
    if (
      rampStart != null &&
      points[end].d - points[rampStart].d >= o.rampLength
    )
      nodes.push({
        id: `ramp-${rampStart}-${end}`,
        kind: "ramp",
        start: rampStart,
        end,
      });
    rampStart = null;
  };
  for (let i = 0; i < points.length; i++) {
    if (grades[i] != null && grades[i] >= o.rampGrade) rampStart ??= i;
    else if (rampStart != null) ramp(i - 1);
  }
  if (points.length) ramp(points.length - 1);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edit of edits)
    byId.set(edit.id, { ...edit, corrected: !edit.manual });
  // A saved range supersedes an equivalent fresh detector proposal, never another saved range.
  for (const node of nodes) {
    if (edits.some((edit) => edit.id === node.id)) continue;
    if (
      sectionCandidates(
        { ...node, rideId: "" },
        edits
          .filter((edit) => edit.kind === node.kind)
          .map((edit) => ({ ...edit, rideId: "" })),
        points,
        90,
      ).length
    )
      byId.delete(node.id);
  }
  const rank = { passage: 0, hill: 1, section: 1, ramp: 2 },
    counts = { passage: 0, hill: 0, section: 0, ramp: 0 };
  const result = [...byId.values()]
    .filter((node) => !node.deleted)
    .sort(
      (a, b) =>
        a.start - b.start || rank[a.kind] - rank[b.kind] || b.end - a.end,
    );
  for (const node of result) {
    const parent = result
      .filter(
        (p) =>
          rank[p.kind] < rank[node.kind] &&
          p.start <= node.start &&
          p.end >= node.end,
      )
      .sort(
        (a, b) =>
          rank[b.kind] - rank[a.kind] || a.end - a.start - (b.end - b.start),
      )[0];
    node.parentId = parent?.id || "";
    counts[node.kind]++;
    node.name ||= `${node.kind[0].toUpperCase() + node.kind.slice(1)} ${counts[node.kind]}`;
    const samples = stretchPoints(points, node.start, node.end),
      first = samples[0],
      last = samples.at(-1);
    node.startTime = first.t;
    node.length = last.d - first.d;
    node.netGain =
      last.ele != null && first.ele != null ? last.ele - first.ele : null;
    node.avgGrade =
      node.netGain == null ? null : (100 * node.netGain) / node.length;
    let ascent = 0,
      known = false;
    for (let i = 1; i < samples.length; i++)
      if (
        samples[i].ele != null &&
        samples[i - 1].ele != null &&
        !samples[i].breakBefore &&
        samples[i].t - samples[i - 1].t <= 30000
      ) {
        ascent += Math.max(0, samples[i].ele - samples[i - 1].ele);
        known = true;
      }
    node.ascent = known ? ascent : null;
  }
  return result;
}

export function storyWindow(points, start, end, context = 500, full = false) {
  return full
    ? { start: 0, end: points.length - 1 }
    : {
        start: Math.max(0, lowerBound(points, points[start].d - context) - 1),
        end: Math.min(
          points.length - 1,
          lowerBound(points, points[end].d + context),
        ),
      };
}

/** Raw-coordinate, ordered-distance inspection, without spatial translation. */
export function inspectRoute(reference, candidate) {
  const probes = [];
  const usable = (points) => {
    for (let i = 1; i < points.length; i++)
      if (points[i].breakBefore || points[i].t - points[i - 1].t > 30000)
        return false;
    return true;
  };
  const continuous = usable(reference) && usable(candidate);
  for (let j = 0; j <= 32; j++) {
    const expected = atProgress(reference, j / 32),
      actual = atProgress(candidate, j / 32);
    probes.push({
      progress: j / 32,
      expected,
      actual,
      offset:
        continuous && hasGPS(expected) && hasGPS(actual)
          ? haversine(expected, actual)
          : null,
    });
  }
  const heading = (points) => {
    const first = points.find(hasGPS),
      next = first && points.find((p) => hasGPS(p) && haversine(first, p) >= 5);
    if (!next) return null;
    const radians = Math.PI / 180,
      dLon = (next.lon - first.lon) * radians;
    return (
      (Math.atan2(
        Math.sin(dLon) * Math.cos(next.lat * radians),
        Math.cos(first.lat * radians) * Math.sin(next.lat * radians) -
          Math.sin(first.lat * radians) *
            Math.cos(next.lat * radians) *
            Math.cos(dLon),
      ) /
        radians +
        360) %
      360
    );
  };
  const worst = probes
    .filter((p) => p.offset != null)
    .sort((a, b) => b.offset - a.offset);
  return {
    probes,
    worst,
    continuous,
    referenceHeading: heading(reference),
    candidateHeading: heading(candidate),
    startMiss:
      hasGPS(reference[0]) && hasGPS(candidate[0])
        ? haversine(reference[0], candidate[0])
        : null,
    endMiss:
      hasGPS(reference.at(-1)) && hasGPS(candidate.at(-1))
        ? haversine(reference.at(-1), candidate.at(-1))
        : null,
  };
}
