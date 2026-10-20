/** Pure, unit-tested analysis. All internal units are meters, seconds and watts. */
export const DEFAULTS = Object.freeze({
  units: "imperial",
  gradeWindow: 75,
  gradeThreshold: 1,
  movingThreshold: 1,
  gapSeconds: 30,
  matchRadius: 35,
  suggestionOverlap: 60,
});
export const PALETTE = [
  "#287bd5",
  "#e98544",
  "#8160c4",
  "#14977d",
  "#ce5574",
  "#95792d",
];
export const TERRAIN = {
  climb: "Climbing",
  descent: "Descending",
  level: "Level road",
  stopped: "Slow / paused",
  gap: "Recording gaps",
  unknown: "Unknown grade",
};
export const hasGPS = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);
export function haversine(a, b) {
  const r = Math.PI / 180,
    x =
      Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
      Math.cos(a.lat * r) *
        Math.cos(b.lat * r) *
        Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742017.6 * Math.asin(Math.min(1, Math.sqrt(x)));
}
export function interpolate(a, b, f) {
  const p = {};
  for (const k of [
    "t",
    "d",
    "lat",
    "lon",
    "ele",
    "hr",
    "speed",
    "cad",
    "power",
    "temp",
  ])
    p[k] =
      Number.isFinite(a[k]) && Number.isFinite(b[k])
        ? a[k] + (b[k] - a[k]) * f
        : null;
  p.timer = f < 1 ? a.timer : b.timer;
  p.breakBefore = f === 1 && b.breakBefore;
  return p;
}
export function lowerBound(points, d) {
  let l = 0,
    h = points.length - 1;
  while (l < h) {
    const m = (l + h) >>> 1;
    if (points[m].d < d) l = m + 1;
    else h = m;
  }
  return l;
}
export function atDistance(points, d) {
  if (!points.length) return null;
  const i = lowerBound(points, d);
  if (!i) return points[0];
  const a = points[i - 1],
    b = points[i];
  return interpolate(
    a,
    b,
    b.d > a.d ? Math.max(0, Math.min(1, (d - a.d) / (b.d - a.d))) : 1,
  );
}
export function atProgress(points, f) {
  return atDistance(points, points[0].d + (points.at(-1).d - points[0].d) * f);
}
/** Endpoint slope across an explicit physical distance window, never across gaps. */
export function gradeProfile(points, window = 75, gapSeconds = 30) {
  if (points.length < 2) return points.map(() => null);
  const prefix = [0],
    missing = [0];
  points.forEach((p, i) => {
    prefix.push(
      prefix.at(-1) +
        Number(
          i > 0 && (p.breakBefore || p.t - points[i - 1].t > gapSeconds * 1000),
        ),
    );
    missing.push(missing.at(-1) + Number(p.ele == null));
  });
  return points.map((p) => {
    const dl = Math.max(points[0].d, p.d - window / 2),
      dr = Math.min(points.at(-1).d, p.d + window / 2);
    const l = lowerBound(points, dl),
      r = lowerBound(points, dr),
      a = atDistance(points, dl),
      b = atDistance(points, dr);
    if (
      a.ele == null ||
      b.ele == null ||
      dr - dl < Math.max(5, window / 4) ||
      prefix[r + 1] - prefix[Math.min(l + 1, r + 1)] ||
      missing[r + 1] - missing[Math.max(0, l - 1)]
    )
      return null;
    return (100 * (b.ele - a.ele)) / (dr - dl);
  });
}
export function intervalSpeed(a, b) {
  return b.t > a.t ? Math.max(0, b.d - a.d) / ((b.t - a.t) / 1000) : 0;
}
function weighted(points, key, gap) {
  let sum = 0,
    total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dt = (b.t - a.t) / 1000;
    if (
      a[key] != null &&
      b[key] != null &&
      dt > 0 &&
      dt <= gap &&
      !b.breakBefore
    ) {
      sum += ((a[key] + b[key]) / 2) * dt;
      total += dt;
    }
  }
  return total ? sum / total : null;
}
export function summarize(points, s = DEFAULTS) {
  if (points.length < 2) return null;
  const distance = points.at(-1).d - points[0].d,
    elapsed = (points.at(-1).t - points[0].t) / 1000;
  let moving = 0,
    movingDistance = 0,
    timer = 0,
    timerKnown = false,
    gaps = 0,
    observed = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    if (a.timer != null) {
      timerKnown = true;
      if (a.timer) timer += dt;
    }
    if (dt > s.gapSeconds || b.breakBefore) {
      gaps += dt;
      continue;
    }
    observed += dt;
    if (a.timer !== false && intervalSpeed(a, b) >= s.movingThreshold) {
      moving += dt;
      movingDistance += b.d - a.d;
    }
  }
  let up = 0,
    down = 0,
    anchor = null,
    alt = false;
  for (const p of points) {
    if (p.breakBefore || p.ele == null) {
      anchor = null;
      continue;
    }
    alt = true;
    if (anchor === null) anchor = p.ele;
    const delta = p.ele - anchor;
    if (Math.abs(delta) >= 3) {
      if (delta > 0) up += delta;
      else down -= delta;
      anchor = p.ele;
    }
  }
  const grades = gradeProfile(points, s.gradeWindow, s.gapSeconds).filter(
    (v) => v != null,
  );
  return {
    distance,
    elapsed,
    timer: timerKnown ? timer : null,
    moving,
    speed: elapsed ? distance / elapsed : 0,
    movingSpeed: moving ? movingDistance / moving : 0,
    ascent: alt ? up : null,
    descent: alt ? down : null,
    grade:
      distance && points[0].ele != null && points.at(-1).ele != null
        ? (100 * (points.at(-1).ele - points[0].ele)) / distance
        : null,
    maxGrade: grades.length
      ? grades.reduce((a, b) => Math.max(a, b), -Infinity)
      : null,
    hr: weighted(points, "hr", s.gapSeconds),
    maxHr: points.reduce(
      (a, p) => (p.hr == null ? a : a == null ? p.hr : Math.max(a, p.hr)),
      null,
    ),
    cadence: weighted(points, "cad", s.gapSeconds),
    power: weighted(points, "power", s.gapSeconds),
    gaps,
    coverage: elapsed ? observed / elapsed : 0,
  };
}
/** Continuous projection onto GPS legs, with distinct visits for repeated laps. */
export function anchorVisits(points, location, radius) {
  const candidates = [],
    sx =
      ((6371008.8 * Math.PI) / 180) * Math.cos((location.lat * Math.PI) / 180),
    sy = (6371008.8 * Math.PI) / 180;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (!hasGPS(a) || !hasGPS(b) || b.breakBefore || b.t - a.t > 30000)
      continue;
    const ax = (a.lon - location.lon) * sx,
      ay = (a.lat - location.lat) * sy,
      dx = (b.lon - a.lon) * sx,
      dy = (b.lat - a.lat) * sy,
      l = dx * dx + dy * dy;
    const f = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0,
      miss = Math.hypot(ax + f * dx, ay + f * dy);
    if (miss <= radius)
      candidates.push({ index: i + f, point: interpolate(a, b, f), miss });
  }
  const groups = [];
  for (const c of candidates) {
    const g = groups.at(-1);
    if (g && c.index - g.at(-1).index <= 1.01) g.push(c);
    else groups.push([c]);
  }
  return groups.map((g) => g.reduce((a, b) => (a.miss <= b.miss ? a : b)));
}
export function nearestIndex(points, ll) {
  let best = -1,
    min = Infinity;
  points.forEach((p, i) => {
    if (hasGPS(p)) {
      const d = haversine(p, ll);
      if (d < min) {
        min = d;
        best = i;
      }
    }
  });
  return best;
}
export function manualMatch(ride, start, end) {
  return {
    id: `${ride.id}:manual`,
    rideId: ride.id,
    pass: 1,
    points: ride.points.slice(start, end + 1),
    startIndex: start,
    endIndex: end,
    startMiss: 0,
    endMiss: 0,
    routeError: 0,
    manual: true,
  };
}
export function findMatches(ride, canonical, radius = 35) {
  if (
    canonical.length < 2 ||
    !hasGPS(canonical[0]) ||
    !hasGPS(canonical.at(-1))
  )
    return [];
  const length = canonical.at(-1).d - canonical[0].d;
  if (length < 20) return [];
  const referenceGPS = gpsGeometry(canonical);
  if (!referenceGPS) return [];
  const starts = anchorVisits(ride.points, canonical[0], radius),
    ends = anchorVisits(ride.points, canonical.at(-1), radius),
    result = [];
  let usedEnd = -1;
  for (const a of starts) {
    if (a.index < usedEnd - 0.01) continue;
    for (const b of ends) {
      if (b.index <= a.index || b.index <= usedEnd) continue;
      const len = b.point.d - a.point.d;
      if (len < length * 0.65 || len > length * 1.5) continue;
      const points = [
        a.point,
        ...ride.points.slice(Math.floor(a.index) + 1, Math.ceil(b.index)),
        b.point,
      ].filter((p, i, all) => !i || p.t > all[i - 1].t);
      if (
        points.some(
          (p, i) => i > 0 && (p.breakBefore || p.t - points[i - 1].t > 30000),
        )
      )
        continue;
      const observedGPS = gpsGeometry(points);
      if (!observedGPS) continue;
      let routeError = 0;
      for (let j = 0; j <= 32; j++) {
        // A short loss of position must not erase valid time/distance/sensor
        // samples. Bridge only the geometry used to verify the road; retain
        // the original missing GPS values in the returned comparison track.
        const actual = atProgress(observedGPS.points, j / 32),
          expected = atProgress(referenceGPS.points, j / 32);
        routeError = Math.max(
          routeError,
          hasGPS(actual) && hasGPS(expected)
            ? haversine(actual, expected)
            : Infinity,
        );
      }
      if (routeError > Math.max(65, radius * 2.5)) continue;
      result.push({
        id: `${ride.id}:${result.length + 1}`,
        rideId: ride.id,
        pass: result.length + 1,
        points,
        startIndex: a.index,
        endIndex: b.index,
        startMiss: a.miss,
        endMiss: b.miss,
        routeError,
        gpsBridgeSeconds: Math.max(
          observedGPS.bridgeSeconds,
          referenceGPS.bridgeSeconds,
        ),
      });
      usedEnd = b.index;
      break;
    }
  }
  return result;
}

/** Geometry-only view for route verification. Never fills recorded samples. */
function gpsGeometry(points) {
  const valid = [];
  let previousIndex = -1,
    bridgeSeconds = 0;
  for (let i = 0; i < points.length; i++) {
    if (i && (points[i].breakBefore || points[i].t - points[i - 1].t > 30000))
      return null;
    if (!hasGPS(points[i])) continue;
    if (previousIndex >= 0) {
      const dt = (points[i].t - points[previousIndex].t) / 1000;
      if (dt > 30) return null;
      if (i - previousIndex > 1) bridgeSeconds = Math.max(bridgeSeconds, dt);
    }
    valid.push(points[i]);
    previousIndex = i;
  }
  return valid.length >= 2 ? { points: valid, bridgeSeconds } : null;
}
/** Common reference terrain prevents recording-to-recording altitude noise reclassifying road. */
export function terrainBudget(points, canonical, s = DEFAULTS) {
  const out = Object.fromEntries(Object.keys(TERRAIN).map((k) => [k, 0]));
  if (points.length < 2 || canonical.length < 2) return out;
  const grades = gradeProfile(canonical, s.gradeWindow, s.gapSeconds),
    len = points.at(-1).d - points[0].d,
    refLen = canonical.at(-1).d - canonical[0].d;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    if (dt > s.gapSeconds || b.breakBefore) {
      out.gap += dt;
      continue;
    }
    if (a.timer === false || intervalSpeed(a, b) < s.movingThreshold) {
      out.stopped += dt;
      continue;
    }
    const n = Math.max(1, Math.ceil((b.d - a.d) / 10));
    for (let k = 0; k < n; k++) {
      const d = a.d + ((b.d - a.d) * (k + 0.5)) / n,
        refD = canonical[0].d + (len ? (d - points[0].d) / len : 0) * refLen,
        g = grades[lowerBound(canonical, refD)];
      const key =
        g == null
          ? "unknown"
          : g > s.gradeThreshold
            ? "climb"
            : g < -s.gradeThreshold
              ? "descent"
              : "level";
      out[key] += dt / n;
    }
  }
  return out;
}
export function deltaCurve(points, baseline) {
  return Array.from({ length: 101 }, (_, i) => ({
    x: i / 100,
    y:
      (atProgress(points, i / 100).t -
        points[0].t -
        (atProgress(baseline, i / 100).t - baseline[0].t)) /
      1000,
  }));
}
