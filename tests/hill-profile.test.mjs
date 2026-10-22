import test from "node:test";
import assert from "node:assert/strict";
import { hillProfile } from "../lib/hill-profile.mjs";
import { DEFAULTS } from "../lib/analysis.mjs";
import {
  validateSavedHillObservations,
  buildHillObservations,
} from "../lib/hills.mjs";
const ride = (id, offset = 0, speed = 4) => ({
  id,
  name: id,
  points: Array.from({ length: 101 }, (_, i) => ({
    t: i * 2000,
    d: i * 10,
    lat: 45 + (i * 10) / 111195,
    lon: -72,
    ele: 100 + i + offset,
    speed,
    hr: id === "a" ? null : 0,
    cad: 0,
    power: 0,
    temp: null,
  })),
});
const a = ride("a"),
  b = ride("b", 30, 8),
  observations = [
    { id: "a-section", rideId: "a", start: 0, end: 70 },
    { id: "b-section", rideId: "b", start: 20, end: 100 },
  ];
const get = (id) => (id === "a" ? a : b);
test("hill mapping combines independently bounded sections without selecting shared endpoints or cropping to one member", () => {
  const original = structuredClone([a, b]),
    result = hillProfile(observations, get, null, DEFAULTS);
  assert.equal(result.passes.length, 2);
  assert.equal(result.excluded.length, 0);
  assert.ok(Math.abs(result.length - 1000) < 1);
  assert.equal(result.profile[0].ele.rides, 1);
  assert.equal(result.profile[50].ele.rides, 2);
  assert.equal(result.profile[100].ele.rides, 1);
  assert.ok(Math.abs(result.profile[50].ele.mean - 50) < 0.1);
  assert.ok(Math.abs(result.profile[100].ele.mean - 100) < 0.1);
  assert.equal(result.profile[50].speed.mean, 6);
  assert.equal(result.profile[50].hr.mean, 0);
  assert.equal(result.profile[50].hr.rides, 1);
  assert.equal(result.profile[50].power.mean, 0);
  assert.deepEqual([a, b], original);
});
test("calculation exclusions retain hill geometry and missing channels remain absent", () => {
  const result = hillProfile(observations, get, null, {
    ...DEFAULTS,
    includedObservationIds: ["a-section"],
  });
  assert.equal(result.passes.length, 1);
  assert.ok(Math.abs(result.length - 1000) < 1);
  assert.equal(result.profile[50].speed.mean, 4);
  assert.equal(result.profile[50].hr.mean, null);
  assert.equal(result.profile[90].ele.mean, null);
  const empty = hillProfile(observations, get, null, {
    ...DEFAULTS,
    includedObservationIds: [],
  });
  assert.equal(empty.passes.length, 0);
  assert.ok(empty.profile.every((p) => p.ele.mean == null));
});
test("opposite direction, remote roads and recording gaps remain excluded from the hill calculation", () => {
  for (const change of [
    (r) => r.points.forEach((p) => (p.lon += 0.02)),
    (r) => r.points.forEach((p, i) => (p.lat = 45 + ((100 - i) * 10) / 111195)),
    (r) => (r.points[50].breakBefore = true),
  ]) {
    const bad = structuredClone(b);
    change(bad);
    const result = hillProfile(
      observations,
      (id) => (id === "a" ? a : bad),
      null,
      DEFAULTS,
    );
    assert.equal(result.passes.length, 1);
    assert.equal(result.excluded.length, 1);
    assert.notEqual(result.profile[50].speed.mean, 6);
  }
});
test("repeated passes average within a ride before giving each ride equal weight", () => {
  const repeated = ride("a");
  repeated.points = repeated.points.concat(
    a.points.map((p, i) => ({
      ...p,
      t: (i + 101) * 2000,
      d: (i + 101) * 10,
      speed: 6,
      breakBefore: i === 0,
    })),
  );
  const obs = [
    { id: "a1", rideId: "a", start: 0, end: 100 },
    { id: "a2", rideId: "a", start: 101, end: 201 },
    { id: "b1", rideId: "b", start: 0, end: 100 },
  ];
  const result = hillProfile(
    obs,
    (id) => (id === "a" ? repeated : b),
    null,
    DEFAULTS,
  );
  assert.equal(result.passes.length, 3);
  assert.equal(result.profile[50].speed.rides, 2);
  assert.equal(result.profile[50].speed.mean, 6.5);
});
test("comparison hill snapshots validate exact fractional source ranges and derive metrics without changing imported tracks", () => {
  const original = structuredClone(a),
    saved = validateSavedHillObservations(
      [
        {
          id: "saved-entry",
          rideId: "a",
          start: 10.5,
          end: 50.5,
          name: " My hill ",
        },
      ],
      () => a,
    );
  const result = buildHillObservations([a], saved).find(
    (o) => o.id === "saved-entry",
  );
  assert.equal(result.length, 400);
  assert.equal(result.netGain, 40);
  assert.equal(result.name, "My hill");
  assert.equal(result.start, 10.5);
  assert.equal(result.steepestRamp.start, 10.5);
  assert.equal(result.steepestRamp.end, 15.5);
  assert.deepEqual(a, original);
  for (const bad of [
    { start: -1 },
    { end: 1000 },
    { id: "not-saved" },
    { name: "" },
    { start: 10, end: 11 },
    {
      alignment: {
        version: 1,
        reviewed: false,
        sourceStart: 10,
        sourceEnd: 50,
      },
    },
    {
      alignment: {
        version: 1,
        reviewed: true,
        sourceStart: 10,
        sourceEnd: 1000,
      },
    },
  ])
    assert.throws(() =>
      validateSavedHillObservations([{ ...saved[0], ...bad }], () => a),
    );
});
