import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  gradeProfile,
  summarize,
  findMatches,
  anchorVisits,
  terrainBudget,
  deltaCurve,
  hasGPS,
} from "../lib/analysis.mjs";
import { makeDemo } from "../lib/demo.mjs";
const p = (i, over = {}) => ({
  t: 1700000000000 + i * 1000,
  d: i * 5,
  lat: 45 + i * 0.00004,
  lon: -122,
  ele: i * 0.25,
  hr: 150,
  speed: 5,
  cad: 80,
  power: 200,
  temp: null,
  timer: true,
  ...over,
});
const close = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tol, `${actual} ≠ ${expected}`);
test("5% grade is invariant to sampling density and window size", () => {
  for (const step of [1, 2, 5]) {
    const pts = Array.from({ length: 101 }, (_, i) => p(i * step));
    for (const window of [25, 75, 200]) {
      const g = gradeProfile(pts, window);
      for (const v of g.filter((v) => v !== null)) close(v, 5);
    }
  }
});
test("larger distance window reduces elevation jitter", () => {
  const pts = Array.from({ length: 201 }, (_, i) =>
    p(i, { ele: i * 0.25 + (i % 2 ? 2 : -2) }),
  );
  const small = gradeProfile(pts, 10),
    large = gradeProfile(pts, 100);
  assert.ok(
    Math.max(...small.filter((v) => v != null)) >
      Math.max(...large.filter((v) => v != null)),
  );
});
test("missing altitude remains missing and gaps are never differentiated", () => {
  const pts = Array.from({ length: 101 }, (_, i) =>
    p(i, { ele: i === 50 ? null : i * 0.25 }),
  );
  assert.equal(gradeProfile(pts, 75)[50], null);
  const gap = Array.from({ length: 101 }, (_, i) =>
    p(i, { t: 1700000000000 + i * 1000 + (i >= 50 ? 60000 : 0) }),
  );
  assert.equal(gradeProfile(gap, 75)[50], null);
});
test("sensor means are time weighted, with null distinct from zero", () => {
  const pts = [
    p(0, { hr: 100, power: 0 }),
    p(1, { t: 1700000000010, hr: 100, power: 0 }),
    p(2, { t: 1700000010010, hr: 200, power: 100 }),
  ];
  const s = summarize(pts);
  close(s.hr, (100 * 0.01 + 150 * 10) / 10.01);
  assert.ok(s.power > 0);
  const missing = pts.map((p) => ({ ...p, hr: null, cad: null, power: null }));
  assert.equal(summarize(missing).hr, null);
  assert.equal(summarize(missing).cadence, null);
  assert.equal(summarize(missing).power, null);
});
test("moving and timer times are separate from elapsed and gaps", () => {
  const pts = [
      p(0),
      p(10, { d: 50 }),
      p(20, { d: 50, timer: false }),
      p(30, { d: 50, timer: true }),
      p(90, { d: 100 }),
    ],
    s = summarize(pts);
  close(s.elapsed, 90);
  close(s.moving, 10);
  close(s.gaps, 60);
  close(s.timer, 80);
});
test("GPS gates interpolate between recorded samples", () => {
  const pts = [p(0, { lat: 45, d: 0 }), p(10, { lat: 45.001, d: 100 })],
    visits = anchorVisits(pts, { lat: 45.0005, lon: -122 }, 35);
  assert.equal(visits.length, 1);
  close(visits[0].point.d, 50, 1e-5);
  close(visits[0].point.t, 1700000005000, 0.01);
});
test("same road matches across altitude offsets and constant coordinate shifts", () => {
  const { rides, segments } = makeDemo();
  const m = findMatches(rides[1], segments[0].path);
  assert.equal(m.length, 1);
  assert.ok(m[0].startMiss < 4);
  assert.ok(m[0].endMiss < 4);
});
test("two laps produce two distinct matching passes", () => {
  const { rides, segments } = makeDemo(),
    one = rides[0],
    duration = one.points.at(-1).t - one.points[0].t,
    length = one.points.at(-1).d;
  const second = one.points
      .slice(1)
      .map((p) => ({ ...p, t: p.t + duration, d: p.d + length })),
    twice = { ...one, id: "two-laps", points: [...one.points, ...second] };
  const matches = findMatches(twice, segments[0].path);
  assert.equal(matches.length, 2);
  assert.equal(matches[1].pass, 2);
  assert.ok(matches[1].startIndex > matches[0].endIndex);
});
test("opposite direction and alternate roads do not silently match", () => {
  const { rides, segments } = makeDemo(),
    one = rides[0],
    pts = segments[0].path;
  const reverse = {
    ...one,
    points: [...pts]
      .reverse()
      .map((p, i) => ({ ...p, t: 1700000000000 + i * 1000, d: i * 10 })),
  };
  assert.equal(findMatches(reverse, pts).length, 0);
  const alternate = {
    ...one,
    points: one.points.map((p, i) => ({
      ...p,
      lon: p.lon + (i > 430 && i < 530 ? 0.003 : 0),
    })),
  };
  assert.equal(findMatches(alternate, pts).length, 0);
});
test("full loops with coincident start/end gates are supported", () => {
  const { rides } = makeDemo();
  assert.equal(findMatches(rides[1], rides[0].points).length, 1);
});
test("terrain budget conserves elapsed time including pauses and gaps", () => {
  const pts = Array.from({ length: 101 }, (_, i) =>
      p(i, {
        ele: i < 30 ? 100 - i : i < 70 ? 70 : 70 + (i - 70),
        t: 1700000000000 + i * 1000 + (i > 50 ? 60000 : 0),
        timer: i < 20 ? true : i < 25 ? false : true,
      }),
    ),
    s = summarize(pts),
    budget = terrainBudget(pts, pts);
  close(
    Object.values(budget).reduce((a, b) => a + b, 0),
    s.elapsed,
  );
  assert.ok(budget.gap > 0);
  assert.ok(budget.stopped > 0);
});
test("time difference equals summed terrain savings, with one shared elevation reference", () => {
  const { rides } = makeDemo(),
    ref = rides[0].points,
    a = terrainBudget(rides[0].points, ref),
    b = terrainBudget(rides[1].points, ref),
    sa = summarize(rides[0].points),
    sb = summarize(rides[1].points);
  close(
    Object.keys(a).reduce((sum, k) => sum + a[k] - b[k], 0),
    sa.elapsed - sb.elapsed,
  );
  assert.ok(a.descent - b.descent > 0);
});
test("delta curve ends at exact elapsed-time difference", () => {
  const { rides, segments } = makeDemo(),
    a = findMatches(rides[0], segments[0].path)[0],
    b = findMatches(rides[1], segments[0].path)[0],
    curve = deltaCurve(b.points, a.points);
  close(curve[0].y, 0);
  close(
    curve.at(-1).y,
    summarize(b.points).elapsed - summarize(a.points).elapsed,
  );
});
