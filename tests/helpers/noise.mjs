import { readFileSync } from "node:fs";
import { parseUpload } from "../../lib/import.mjs";
import { atDistance, haversine, hasGPS } from "../../lib/analysis.mjs";

/** Reproducible simulations, not a claim about any particular Garmin receiver. */
export function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let x = value;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rng) {
  return (
    Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) *
    Math.cos(2 * Math.PI * rng())
  );
}
export function publicTrack() {
  return parseUpload(
    readFileSync(new URL("../fixtures/cerknicko-jezero.gpx", import.meta.url)),
    "cerknicko-jezero.gpx",
  ).rides[0];
}
export function realGeometryTruth() {
  // Retain actual public track geometry. Timing/sensors below are controlled synthetic ground truth.
  const source = publicTrack(),
    geometry = [];
  let d = 0;
  for (const p of source.points) {
    if (!hasGPS(p)) continue;
    if (geometry.length) d += haversine(geometry.at(-1), p);
    geometry.push({ ...p, d, breakBefore: false });
  }
  const points = [];
  for (let d = 0; d <= Math.min(geometry.at(-1).d, 4500); d += 5) {
    const p = atDistance(geometry, d);
    points.push({
      ...p,
      t: 1700000000000 + (d / 5) * 1000,
      d,
      hr: 150 + 8 * Math.sin(d / 250),
      speed: 5,
      cad: 80,
      power: null,
      temp: null,
      timer: true,
      breakBefore: false,
    });
  }
  return {
    ...source,
    id: "real-geometry-truth",
    name: "Public GPX geometry · simulated sensors",
    points,
  };
}
export function perturb(
  ride,
  {
    seed = 1,
    jitter = 2,
    drift = 6,
    rho = 0.96,
    irregular = false,
    speedFactor = 1,
    distanceFromGPS = false,
    gpsDropout = null,
    recordingDropout = null,
    outlier = null,
  } = {},
) {
  const rng = random(seed),
    points = [],
    t0 = ride.points[0].t;
  let north = 0,
    east = 0;
  for (let i = 0; i < ride.points.length; i++) {
    const p = ride.points[i],
      index = i;
    north = rho * north + Math.sqrt(1 - rho * rho) * drift * gaussian(rng);
    east = rho * east + Math.sqrt(1 - rho * rho) * drift * gaussian(rng);
    const n = north + jitter * gaussian(rng),
      e =
        east +
        jitter * gaussian(rng) +
        (outlier && index >= outlier[0] && index <= outlier[1]
          ? outlier[2]
          : 0);
    const q = {
      ...p,
      t: t0 + (p.t - t0) / speedFactor,
      lat: p.lat + n / 111195,
      lon: p.lon + e / (111195 * Math.cos((p.lat * Math.PI) / 180)),
      ele: p.ele == null ? null : p.ele + 12 + 0.4 * gaussian(rng),
      truthIndex: index,
    };
    if (gpsDropout && index >= gpsDropout[0] && index <= gpsDropout[1])
      q.lat = q.lon = null;
    if (
      !recordingDropout ||
      index < recordingDropout[0] ||
      index > recordingDropout[1]
    )
      points.push(q);
    if (irregular && i < ride.points.length - 1)
      i = Math.min(ride.points.length - 2, i + Math.floor(rng() * 7));
  }
  if (distanceFromGPS) {
    let d = 0;
    points.forEach((p, i) => {
      if (i && hasGPS(p) && hasGPS(points[i - 1]))
        d += haversine(points[i - 1], p);
      p.d = d;
    });
  }
  return { ...ride, id: `perturbed-${seed}`, points };
}
