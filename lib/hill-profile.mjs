import { haversine, hasGPS, gradeProfile } from "./analysis.mjs";
import { stretchPoints } from "./comparisons.mjs";

const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    k = sorted.length >> 1;
  return sorted.length % 2 ? sorted[k] : (sorted[k - 1] + sorted[k]) / 2;
};
const mix = (a, b, f) => (a == null || b == null ? null : a + (b - a) * f);
function byRide(rows, key) {
  const rides = new Map();
  for (const row of rows)
    if (row[key] != null) {
      if (!rides.has(row.rideId)) rides.set(row.rideId, []);
      rides.get(row.rideId).push(row[key]);
    }
  const values = [...rides.values()].map(mean);
  return {
    mean: mean(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    rides: values.length,
  };
}
function geometry(points) {
  const result = [];
  for (const point of points)
    if (
      hasGPS(point) &&
      (!result.length ||
        haversine(result.at(-1).point, point) >= 5 ||
        point === points.at(-1))
    ) {
      const previous = result.at(-1);
      result.push({
        point,
        s: previous ? previous.s + haversine(previous.point, point) : 0,
      });
    }
  return result;
}
function project(point, line, minimum = -Infinity) {
  let best = null;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i];
    if (b.s < minimum) continue;
    const scale = 111195,
      cosine = Math.cos((point.lat * Math.PI) / 180),
      dx = (b.point.lon - a.point.lon) * scale * cosine,
      dy = (b.point.lat - a.point.lat) * scale;
    const px = (point.lon - a.point.lon) * scale * cosine,
      py = (point.lat - a.point.lat) * scale,
      length = dx * dx + dy * dy;
    const fraction = length
        ? Math.max(0, Math.min(1, (px * dx + py * dy) / length))
        : 0,
      s = a.s + (b.s - a.s) * fraction;
    if (s < minimum) continue;
    const error = Math.hypot(px - dx * fraction, py - dy * fraction);
    if (!best || error < best.error) best = { s, error };
  }
  return best;
}
function atStation(line, s) {
  let i = 1;
  while (i < line.length - 1 && line[i].s < s) i++;
  const a = line[i - 1],
    b = line[i],
    f = (s - a.s) / Math.max(1e-9, b.s - a.s);
  return {
    lat: mix(a.point.lat, b.point.lat, f),
    lon: mix(a.point.lon, b.point.lon, f),
  };
}

// Geographic source-to-hill mapping, without a user-selected endpoint template.
// The display spine preserves recorded coordinates; it is not a surveyed centerline.
export function hillProfile(observations, getRide, _unused, settings) {
  const source = observations.map((observation) => {
    const ride = getRide(observation.rideId),
      points = stretchPoints(ride.points, observation.start, observation.end);
    const gps = points.filter(hasGPS);
    const continuous =
      points.every(
        (p, i) => !i || (!p.breakBefore && p.t - points[i - 1].t <= 30000),
      ) && gps.every((p, i) => !i || p.t - gps[i - 1].t <= 30000);
    return {
      observation,
      points,
      geometry: geometry(points),
      continuous,
      grades: gradeProfile(points, settings.gradeWindow, settings.gapSeconds),
    };
  });
  const preferredIds =
    settings.preferredObservationIds || settings.includedObservationIds;
  const preferred = preferredIds ? new Set(preferredIds) : null;
  const eligible = source
    .filter((p) => p.continuous && p.geometry.length > 1)
    .sort(
      (a, b) =>
        (preferred
          ? Number(preferred.has(b.observation.id)) -
            Number(preferred.has(a.observation.id))
          : 0) ||
        b.geometry.at(-1).s - a.geometry.at(-1).s ||
        a.observation.id.localeCompare(b.observation.id),
    );
  if (!eligible.length)
    return { reference: null, passes: [], excluded: observations, profile: [] };
  const seed = eligible[0],
    radius = Math.max(20, Math.min(65, settings.matchRadius * 2.5));
  let spine = seed.geometry;
  // Extend the recorded spine where a vetted member supplies a continuous overlapping end.
  for (const candidate of eligible.slice(1)) {
    const first = project(candidate.geometry[0].point, spine),
      last = project(candidate.geometry.at(-1).point, spine);
    if (!first || !last || last.s - first.s < 10) continue;
    const head = project(spine[0].point, candidate.geometry),
      tail = project(spine.at(-1).point, candidate.geometry);
    const prefix =
      head?.error <= radius && head.s >= 10
        ? candidate.geometry.filter((p) => p.s < head.s - 5).map((p) => p.point)
        : [];
    const suffix =
      tail?.error <= radius && candidate.geometry.at(-1).s - tail.s >= 10
        ? candidate.geometry.filter((p) => p.s > tail.s + 5).map((p) => p.point)
        : [];
    if (prefix.length || suffix.length)
      spine = geometry([...prefix, ...spine.map((p) => p.point), ...suffix]);
  }
  const passes = [],
    excluded = [];
  for (const candidate of source) {
    if (!candidate.continuous || candidate.geometry.length < 2) {
      excluded.push(candidate.observation);
      continue;
    }
    const first = project(candidate.geometry[0].point, spine),
      last = project(candidate.geometry.at(-1).point, spine);
    if (!first || !last || last.s - first.s < 10) {
      excluded.push(candidate.observation);
      continue;
    }
    let previous = -Infinity,
      maxOffset = 0;
    const mapped = [];
    for (const [index, point] of candidate.points.entries())
      if (hasGPS(point)) {
        const position = project(point, spine, previous - 15);
        if (!position || position.error > radius) {
          maxOffset = Infinity;
          break;
        }
        const s = Math.max(previous, position.s);
        previous = s;
        maxOffset = Math.max(maxOffset, position.error);
        mapped.push({ s, point, grade: candidate.grades[index] });
      }
    if (
      !Number.isFinite(maxOffset) ||
      mapped.length < 2 ||
      mapped.at(-1).s - mapped[0].s < 10
    ) {
      excluded.push(candidate.observation);
      continue;
    }
    passes.push({ ...candidate, mapped, maxOffset });
  }
  const included = settings.includedObservationIds
    ? new Set(settings.includedObservationIds)
    : null;
  if (included)
    for (let i = passes.length - 1; i >= 0; i--)
      if (!included.has(passes[i].observation.id)) passes.splice(i, 1);
  const length = spine.at(-1).s;
  const samples = Array.from({ length: 101 }, (_, i) => ({
    progress: i / 100,
    s: (length * i) / 100,
    point: atStation(spine, (length * i) / 100),
  }));
  const raw = passes.map((pass) =>
    samples.map(({ s }) => {
      const rows = pass.mapped;
      if (s < rows[0].s - 1e-6 || s > rows.at(-1).s + 1e-6) return null;
      let lo = 1,
        hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].s < s) lo = mid + 1;
        else hi = mid;
      }
      const a = rows[lo - 1],
        b = rows[lo];
      if (b.point.t - a.point.t > 30000 || b.point.breakBefore) return null;
      const f = Math.max(0, Math.min(1, (s - a.s) / Math.max(1e-9, b.s - a.s)));
      return {
        rideId: pass.observation.rideId,
        ele: mix(a.point.ele, b.point.ele, f),
        grade: mix(a.grade, b.grade, f),
        speed: mix(a.point.speed, b.point.speed, f),
        hr: mix(a.point.hr, b.point.hr, f),
        power: mix(a.point.power, b.point.power, f),
      };
    }),
  );
  // Estimate only constant altitude offsets from overlapping observations, using all members.
  let offsets = passes.map(() => 0);
  for (let iteration = 0; iteration < 8; iteration++) {
    const next = offsets.map((old, index) => {
      const differences = [];
      for (let k = 0; k < samples.length; k++)
        if (raw[index][k]?.ele != null) {
          const others = raw.flatMap((values, j) =>
            j !== index && values[k]?.ele != null
              ? [values[k].ele - offsets[j]]
              : [],
          );
          if (others.length)
            differences.push(raw[index][k].ele - median(others));
        }
      return differences.length >= 3
        ? old + 0.5 * (median(differences) - old)
        : old;
    });
    const center = median(next);
    offsets = next.map((v) => v - center);
  }
  let base = null;
  const profile = samples.map((sample, k) => {
    const rows = raw.flatMap((values, j) =>
      values[k]
        ? [
            {
              ...values[k],
              ele: values[k].ele == null ? null : values[k].ele - offsets[j],
            },
          ]
        : [],
    );
    const fields = Object.fromEntries(
      ["ele", "grade", "speed", "hr", "power"].map((key) => [
        key,
        byRide(rows, key),
      ]),
    );
    if (base == null && fields.ele.mean != null) base = fields.ele.mean;
    if (fields.ele.mean != null)
      for (const key of ["mean", "min", "max"]) fields.ele[key] -= base;
    return { ...sample, ...fields };
  });
  passes.forEach((pass, i) => {
    pass.altitudeOffset = offsets[i];
  });
  return { reference: seed.observation, passes, excluded, profile, length };
}
