import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  findMatches,
  summarize,
  terrainBudget,
  DEFAULTS,
} from "../lib/analysis.mjs";
import { parseUpload } from "../lib/import.mjs";
import { publicTrack, realGeometryTruth, perturb } from "./helpers/noise.mjs";
const truth = realGeometryTruth(),
  start = 180,
  end = 540,
  section = truth.points.slice(start, end + 1),
  truthSeconds = (section.at(-1).t - section[0].t) / 1000;
test("pinned upstream public GPX has the documented checksum and imports its original timestamps", () => {
  const meta = JSON.parse(
      readFileSync(new URL("./fixtures/source.json", import.meta.url)),
    ),
    bytes = readFileSync(
      new URL("./fixtures/cerknicko-jezero.gpx", import.meta.url),
    );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), meta.sha256);
  assert.equal(parseUpload(bytes, "cerknicko-jezero.gpx").rides.length, 7);
  const r = publicTrack();
  assert.ok(r.points.length > 100);
  assert.ok(r.points.at(-1).d > 1000);
  assert.ok(r.points[0].t < Date.UTC(2011, 0, 1));
  assert.ok(r.points.every((p) => p.lat !== null && p.lon !== null));
});
test("real track geometry: thirty seeded jitter + correlated drift + irregular sampling variants match", () => {
  const failures = [],
    errors = [];
  for (let seed = 1; seed <= 30; seed++) {
    const ride = perturb(truth, {
        seed,
        jitter: 2,
        drift: 6,
        irregular: true,
        speedFactor: 1.08,
      }),
      matches = findMatches(ride, section);
    if (matches.length !== 1) {
      failures.push(seed);
      continue;
    }
    const seconds = summarize(matches[0].points).elapsed,
      error = Math.abs(seconds - truthSeconds / 1.08);
    errors.push(error);
    if (error > 12) failures.push(`${seed}: ${error.toFixed(2)}s`);
  }
  assert.deepEqual(failures, [], `Failed seeds: ${failures}`);
  console.log(
    `GPS simulation: ${errors.length}/30 matched; max endpoint timing error ${Math.max(...errors).toFixed(2)}s (12s tolerance)`,
  );
});
test("real track geometry: two independently noisy recordings match each other", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const reference = perturb(truth, { seed, jitter: 2, drift: 5 }),
      ride = perturb(truth, {
        seed: seed + 100,
        jitter: 2,
        drift: 5,
        irregular: true,
      });
    assert.equal(
      findMatches(ride, reference.points.slice(start, end + 1)).length,
      1,
      `seed ${seed}`,
    );
  }
});
test("GPS-derived distance with spatially uneven jitter still identifies the same road", () => {
  const noisy = perturb(truth, {
    seed: 41,
    jitter: 3,
    drift: 5,
    distanceFromGPS: true,
  });
  assert.equal(findMatches(noisy, section).length, 1);
});
test("brief interior GPS dropout preserves a match while a long recording gap is rejected", () => {
  const short = perturb(truth, {
    seed: 42,
    jitter: 1,
    drift: 3,
    gpsDropout: [350, 357],
  });
  assert.equal(findMatches(short, section).length, 1);
  const long = perturb(truth, {
    seed: 42,
    jitter: 1,
    drift: 3,
    recordingDropout: [350, 400],
  });
  assert.equal(findMatches(long, section).length, 0);
});
test("large sustained multipath displacement is rejected instead of silently matching", () => {
  const bad = perturb(truth, {
    seed: 8,
    jitter: 2,
    drift: 5,
    outlier: [300, 380, 180],
  });
  assert.equal(findMatches(bad, section).length, 0);
});
test("same endpoint gates do not admit a substantial alternate route", () => {
  const bad = {
    ...truth,
    points: truth.points.map((p, i) => ({
      ...p,
      lon: p.lon + (i > 220 && i < 500 ? 0.003 : 0),
    })),
  };
  assert.equal(findMatches(bad, section).length, 0);
});
test("noisy repeated laps retain distinct passes", () => {
  const noisy = perturb(truth, {
      seed: 9,
      jitter: 2,
      drift: 5,
      irregular: true,
    }),
    duration = noisy.points.at(-1).t - noisy.points[0].t + 1000,
    length = noisy.points.at(-1).d + 5;
  // Each lap restarts at the track origin. Explicit discontinuities avoid inventing the connecting leg.
  const twice = {
    ...noisy,
    points: [
      ...noisy.points,
      ...noisy.points.map((p, i) => ({
        ...p,
        t: p.t + duration,
        d: p.d + length,
        breakBefore: i === 0,
      })),
    ],
  };
  assert.equal(findMatches(twice, section).length, 2);
});
test("noisy matched terrain buckets still conserve elapsed time", () => {
  const ride = perturb(truth, {
      seed: 3,
      jitter: 2,
      drift: 6,
      irregular: true,
    }),
    match = findMatches(ride, section)[0];
  assert.ok(match);
  const b = terrainBudget(match.points, section, DEFAULTS),
    s = summarize(match.points);
  assert.ok(
    Math.abs(Object.values(b).reduce((a, b) => a + b, 0) - s.elapsed) < 1e-7,
  );
});

test("brief GPS bridging is disclosed and never fills the returned source samples", () => {
  const noisy = perturb(truth, {
      seed: 42,
      jitter: 1,
      drift: 3,
      gpsDropout: [350, 357],
    }),
    match = findMatches(noisy, section)[0];
  assert.ok(match);
  assert.equal(match.gpsBridgeSeconds, 9);
  assert.equal(
    match.points.filter((p) => p.lat === null && p.lon === null).length,
    8,
  );
});
test("a long GPS-only outage is rejected even when other sensors still record", () => {
  const noisy = perturb(truth, {
    seed: 42,
    jitter: 1,
    drift: 3,
    gpsDropout: [320, 360],
  });
  assert.equal(findMatches(noisy, section).length, 0);
});
test("known stationary distance with jittering coordinates stays slow/paused", () => {
  const noisy = perturb(truth, { seed: 44, jitter: 3, drift: 8 }),
    points = noisy.points.slice(200, 240).map((p) => ({ ...p, d: 0 }));
  const s = summarize(points),
    budget = terrainBudget(points, section);
  assert.equal(s.moving, 0);
  assert.equal(budget.stopped, s.elapsed);
});

test("unchanged public recording matches its continuous 55-sample section at the original 446-second duration", () => {
  const ride = publicTrack(),
    groups = [];
  let group = [];
  for (const p of ride.points) {
    if (group.length && (p.breakBefore || p.t - group.at(-1).t > 30000)) {
      groups.push(group);
      group = [];
    }
    group.push(p);
  }
  groups.push(group);
  groups.sort((a, b) => b.length - a.length);
  const canonical = groups[0];
  assert.equal(canonical.length, 55);
  const matches = findMatches(ride, canonical);
  assert.equal(matches.length, 1);
  assert.equal(summarize(matches[0].points).elapsed, 446);
  assert.ok(
    Math.abs(summarize(matches[0].points).distance - 645.2210017496891) < 1e-6,
  );
});
