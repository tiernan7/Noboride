import { haversine, hasGPS, gradeProfile } from "./analysis.mjs";
import { stretchPoints } from "./comparisons.mjs";
import { minimumInputProfile } from "./gravity-power.mjs";

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
  const values = [...rides.values()].map(mean).sort((a, b) => a - b),
    average = mean(values),
    quantile = (fraction) => {
      if (!values.length) return null;
      const index = (values.length - 1) * fraction,
        low = Math.floor(index),
        high = Math.ceil(index);
      return values[low] + (values[high] - values[low]) * (index - low);
    },
    q1 = quantile(0.25),
    q3 = quantile(0.75);
  return {
    mean: average,
    min: values[0] ?? null,
    max: values.at(-1) ?? null,
    rides: values.length,
    sd:
      values.length > 1
        ? Math.sqrt(
            values.reduce((sum, v) => sum + (v - average) ** 2, 0) /
              (values.length - 1),
          )
        : null,
    q1,
    median: quantile(0.5),
    q3,
    whiskerLow: values[0] ?? null,
    whiskerHigh: values.at(-1) ?? null,
    outliers: [],
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
    passes.push({
      ...candidate,
      mapped,
      maxOffset,
      minimumRows: settings.includeMinimumPower
        ? minimumInputProfile(candidate.points, settings).rows
        : [],
    });
  }
  const included = settings.includedObservationIds
    ? new Set(settings.includedObservationIds)
    : null;
  if (included)
    for (let i = passes.length - 1; i >= 0; i--)
      if (!included.has(passes[i].observation.id)) passes.splice(i, 1);
  const length = spine.at(-1).s;
  // 160 intervals put all 10/20/40/80 box midpoints on exact display stations.
  const steps = 160,
    samples = Array.from({ length: steps + 1 }, (_, i) => ({
      progress: i / steps,
      s: (length * i) / steps,
      point: atStation(spine, (length * i) / steps),
    }));
  const atSample = (pass, s) => {
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
    const time = a.point.t + (b.point.t - a.point.t) * f,
      powerRows = pass.minimumRows;
    let minimumPower = null;
    if (powerRows.length) {
      let low = 0,
        high = powerRows.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (powerRows[mid].t < time) low = mid + 1;
        else high = mid;
      }
      const right = powerRows[low],
        left = powerRows[Math.max(0, low - 1)];
      minimumPower =
        right.t === time
          ? right.minimumWatts
          : mix(
              left.minimumWatts,
              right.minimumWatts,
              (time - left.t) / (right.t - left.t),
            );
    }
    return {
      rideId: pass.observation.rideId,
      ele: mix(a.point.ele, b.point.ele, f),
      grade: mix(a.grade, b.grade, f),
      speed: mix(a.point.speed, b.point.speed, f),
      hr: mix(a.point.hr, b.point.hr, f),
      cad: mix(a.point.cad, b.point.cad, f),
      power: mix(a.point.power, b.point.power, f),
      minimumPower,
    };
  };
  const raw = passes.map((pass) => samples.map(({ s }) => atSample(pass, s))),
    // Retain the original calibration stations so a display-spacing correction
    // does not change the constant elevation-offset estimates.
    offsetRaw = passes.map((pass) =>
      Array.from({ length: 101 }, (_, i) => atSample(pass, (length * i) / 100)),
    );
  // Estimate only constant altitude offsets from overlapping observations, using all members.
  let offsets = passes.map(() => 0);
  for (let iteration = 0; iteration < 8; iteration++) {
    const next = offsets.map((old, index) => {
      const differences = [];
      for (let k = 0; k < 101; k++)
        if (offsetRaw[index][k]?.ele != null) {
          const others = offsetRaw.flatMap((values, j) =>
            j !== index && values[k]?.ele != null
              ? [values[k].ele - offsets[j]]
              : [],
          );
          if (others.length)
            differences.push(offsetRaw[index][k].ele - median(others));
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
      ["ele", "grade", "speed", "hr", "cad", "power", "minimumPower"].map(
        (key) => [key, byRide(rows, key)],
      ),
    );
    if (base == null && fields.ele.mean != null) base = fields.ele.mean;
    if (fields.ele.mean != null)
      for (const key of [
        "mean",
        "min",
        "max",
        "q1",
        "median",
        "q3",
        "whiskerLow",
        "whiskerHigh",
      ])
        fields.ele[key] -= base;
    fields.ele.outliers = fields.ele.outliers.map((v) => v - base);
    return { ...sample, ...fields };
  });
  passes.forEach((pass, i) => {
    pass.altitudeOffset = offsets[i];
  });
  return { reference: seed.observation, passes, excluded, profile, length };
}
