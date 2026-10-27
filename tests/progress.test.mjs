import test from "node:test";
import assert from "node:assert/strict";
import { buildProgress, progressPoints } from "../lib/progress.mjs";
import { DEFAULTS } from "../lib/analysis.mjs";

export function progressFixture() {
  const points = (seconds, day, hr, offset = 0) =>
    Array.from({ length: 101 }, (_, i) => ({
      t: Date.UTC(2026, 9, 10 + day, 12) + i * seconds * 10,
      d: i * 10,
      lat: 45 + (i * 10) / 111195,
      lon: -72 + offset,
      ele: 100 + i * 0.5,
      speed: 1000 / seconds,
      hr,
      cad: null,
      power: null,
      temp: null,
      timer: true,
    }));
  const a = {
    id: "progress-a",
    name: "Two passes <A>",
    date: "2026-10-10T12:00:00Z",
    notes: { bike: "Bike A", conditions: "Dry", notes: "<Keep this literal>" },
    points: points(100, 0, 140),
  };
  a.points.push(
    ...points(80, 0, 160).map((p, i) => ({
      ...p,
      t: p.t + 200000,
      d: p.d + 1100,
      breakBefore: i === 0,
    })),
  );
  const b = {
    id: "progress-b",
    name: "Single pass B",
    date: "2026-10-11T12:00:00Z",
    notes: { bike: "Bike B" },
    points: points(120, 1, null),
  };
  const c = {
    id: "progress-c",
    name: "Different road C",
    date: "2026-10-12T12:00:00Z",
    notes: {},
    points: points(90, 2, 0, 0.02),
  };
  const comparison = {
    id: "progress-context",
    name: "Progress fixed road",
    road: { rideId: a.id, start: 0, end: 100 },
    roadEntryId: "a-first",
    entries: [
      { id: "a-first", rideId: a.id, start: 0, end: 100, kind: "source" },
      { id: "a-second", rideId: a.id, start: 101, end: 201, kind: "matched" },
      { id: "b-first", rideId: b.id, start: 0, end: 100, kind: "matched" },
      {
        id: "b-manual",
        rideId: b.id,
        start: 20,
        end: 90,
        kind: "effort",
        relation: "same-road",
      },
      {
        id: "b-rejected",
        rideId: b.id,
        start: 0,
        end: 95,
        kind: "matched",
        review: "rejected",
      },
      { id: "c-wrong", rideId: c.id, start: 0, end: 100, kind: "matched" },
    ],
    selected: [a.id, b.id, c.id],
    settings: { ...DEFAULTS, units: "metric" },
    baseline: "b-first",
    comparison: "a-first",
    metric: "delta",
    browse: { rideId: a.id, start: 0, end: 100 },
  };
  return { rides: [a, b, c], comparison };
}
test("Progress verifies accepted common endpoints, retains laps and excludes manual/rejected/wrong-road ranges without mutation", () => {
  const fixture = progressFixture(),
    before = structuredClone(fixture),
    get = (id) => fixture.rides.find((r) => r.id === id);
  const result = buildProgress(fixture.comparison, get);
  assert.deepEqual(
    result.rows.filter((r) => r.eligible).map((r) => r.entryId),
    ["a-first", "a-second", "b-first"],
  );
  assert.deepEqual(
    result.rows.filter((r) => r.eligible).map((r) => r.elapsed),
    [100, 80, 120],
  );
  assert.equal(result.rows[0].entrySpeed, 10);
  assert.equal(result.rows[2].hr, null);
  assert.match(result.rows[3].reason, /Manual/);
  assert.match(result.rows[4].reason, /rejected/);
  assert.match(result.rows[5].reason, /failed/);
  assert.deepEqual(fixture, before);
});
test("Progress per-ride means and fastest passes keep explicit weighting and the same representative pass's sensors", () => {
  const { rides, comparison } = progressFixture(),
    rows = buildProgress(comparison, (id) =>
      rides.find((r) => r.id === id),
    ).rows;
  const means = progressPoints(rows),
    best = progressPoints(rows, "best");
  assert.deepEqual(
    means.map((p) => p.elapsed),
    [90, 120],
  );
  assert.equal(means[0].hr, 150);
  assert.equal(means[0].entryId, null);
  assert.deepEqual(means[0].entryIds, ["a-first", "a-second"]);
  assert.equal(means[1].support.hr, 0);
  assert.equal(best[0].entryId, "a-second");
  assert.equal(best[0].elapsed, 80);
  assert.equal(best[0].hr, 160);
  assert.equal(progressPoints(rows, "passes").length, 3);
});
test("Progress honors ride inclusion without loading excluded tracks and rejects changed reference bounds and broken geometry", () => {
  const { rides, comparison } = progressFixture(),
    get = (id) => rides.find((r) => r.id === id);
  const selected = buildProgress(
    comparison,
    (id) => {
      assert.equal(id, "progress-a");
      return get(id);
    },
    ["progress-a"],
  );
  assert.equal(selected.rows.filter((r) => r.eligible).length, 2);
  assert.match(selected.rows[2].reason, /not included/);
  const changed = structuredClone(comparison);
  changed.entries[0].end = 90;
  assert.match(buildProgress(changed, get).rows[0].reason, /Source bounds/);
  const broken = structuredClone(rides);
  broken[0].points[50].breakBefore = true;
  assert.equal(
    buildProgress(comparison, (id) =>
      broken.find((r) => r.id === id),
    ).rows.filter((r) => r.eligible).length,
    0,
  );
  assert.equal(
    buildProgress({ ...comparison, mode: "terrain" }, get).rows.filter(
      (r) => r.eligible,
    ).length,
    0,
  );
});
