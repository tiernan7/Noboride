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
  assert.equal(result.profile.find((p) => p.progress === 0.5).ele.rides, 2);
  assert.equal(result.profile.at(-1).ele.rides, 1);
  assert.ok(
    Math.abs(result.profile.find((p) => p.progress === 0.5).ele.mean - 50) <
      0.1,
  );
  assert.ok(Math.abs(result.profile.at(-1).ele.mean - 100) < 0.1);
  assert.equal(result.profile.find((p) => p.progress === 0.5).speed.mean, 6);
  assert.equal(result.profile.find((p) => p.progress === 0.5).hr.mean, 0);
  assert.equal(result.profile.find((p) => p.progress === 0.5).hr.rides, 1);
  assert.equal(result.profile.find((p) => p.progress === 0.5).power.mean, 0);
  assert.deepEqual([a, b], original);
});
test("calculation exclusions retain hill geometry and missing channels remain absent", () => {
  const result = hillProfile(observations, get, null, {
    ...DEFAULTS,
    includedObservationIds: ["a-section"],
  });
  assert.equal(result.passes.length, 1);
  assert.ok(Math.abs(result.length - 1000) < 1);
  assert.equal(result.profile.find((p) => p.progress === 0.5).speed.mean, 4);
  assert.equal(result.profile.find((p) => p.progress === 0.5).hr.mean, null);
  assert.equal(result.profile.find((p) => p.progress === 0.9).ele.mean, null);
  const empty = hillProfile(observations, get, null, {
    ...DEFAULTS,
    includedObservationIds: [],
  });
  assert.equal(empty.passes.length, 0);
  assert.ok(empty.profile.every((p) => p.ele.mean == null));
});
test("every supported box midpoint has its own exact geographic display station", () => {
  const result = hillProfile(observations, get, null, DEFAULTS);
  for (const density of [10, 20, 40, 80])
    for (let i = 0; i < density; i++) {
      const progress = (i + 0.5) / density,
        station = result.profile.find(
          (p) => Math.abs(p.progress - progress) < 1e-12,
        );
      assert.ok(station, `Missing ${density}-box station ${i}`);
      // The synthetic road rises 100 m uniformly over 1000 m.
      assert.ok(Math.abs(station.ele.mean - 100 * progress) < 0.1);
    }
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
    assert.notEqual(
      result.profile.find((p) => p.progress === 0.5).speed.mean,
      6,
    );
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
  assert.equal(result.profile.find((p) => p.progress === 0.5).speed.rides, 2);
  assert.equal(result.profile.find((p) => p.progress === 0.5).speed.mean, 6.5);
  assert.ok(
    Math.abs(
      result.profile.find((p) => p.progress === 0.5).speed.sd -
        3 / Math.sqrt(2),
    ) < 1e-9,
  );
  assert.equal(result.profile.find((p) => p.progress === 0.5).speed.q1, 5.75);
  assert.equal(result.profile.find((p) => p.progress === 0.5).speed.q3, 7.25);
});
test("hill distributions use ride means, sample SD and quartiles with min/max whiskers and no exclusions", () => {
  const rides = [1, 2, 3, 4, 10].map((speed, i) => ride(`ride-${i}`, 0, speed)),
    obs = rides.map((r) => ({ id: r.id, rideId: r.id, start: 0, end: 100 })),
    result = hillProfile(
      obs,
      (id) => rides.find((r) => r.id === id),
      null,
      DEFAULTS,
    ),
    value = result.profile.find((p) => p.progress === 0.5).speed;
  assert.equal(value.rides, 5);
  assert.equal(value.mean, 4);
  assert.equal(value.sd, Math.sqrt(12.5));
  assert.equal(value.q1, 2);
  assert.equal(value.median, 3);
  assert.equal(value.q3, 4);
  assert.equal(value.whiskerLow, 1);
  assert.equal(value.whiskerHigh, 10);
  assert.deepEqual(value.outliers, []);
  assert.equal(result.profile.find((p) => p.progress === 0.5).power.sd, 0);
  const elevation = result.profile.find((p) => p.progress === 0.5).ele;
  assert.ok(Math.abs(elevation.median - 50) < 0.1);
  assert.ok(Math.abs(elevation.whiskerLow - 50) < 0.1);
});
test("hill distributions keep missing values absent and a single ride cannot supply sample SD", () => {
  const result = hillProfile(observations, get, null, DEFAULTS),
    single = result.profile[0].speed,
    missing = result.profile[0].hr;
  assert.equal(single.rides, 1);
  assert.equal(single.sd, null);
  assert.equal(single.median, 4);
  assert.equal(missing.rides, 0);
  assert.equal(missing.mean, null);
  assert.equal(missing.sd, null);
  assert.equal(missing.q1, null);
  assert.equal(missing.q3, null);
  assert.deepEqual(missing.outliers, []);
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

test("hill summaries keep estimated minimum power separate, average repeats within rides and preserve missing masses", () => {
  const first = ride("power-a", 0, 5),
    second = ride("power-b", 40, 2.5);
  second.points = second.points.map((p) => ({ ...p, t: p.t * 2 }));
  const original = structuredClone([first, second]);
  const members = [
    { id: "power-a1", rideId: first.id, start: 0, end: 100 },
    { id: "power-a2", rideId: first.id, start: 0, end: 100 },
    { id: "power-b", rideId: second.id, start: 0, end: 100 },
  ];
  const get = (id) => (id === first.id ? first : second);
  const result = hillProfile(members, get, null, {
    ...DEFAULTS,
    includeMinimumPower: true,
    riderMassKg: 80,
    bikeMassKg: 20,
  });
  const middle = result.profile[80];
  // 100 kg × g × (100 m / 200 s), or / 400 s; repeated A is one ride's vote.
  assert.ok(Math.abs(middle.minimumPower.mean - 367.749375) < 1e-8);
  assert.equal(middle.minimumPower.rides, 2);
  assert.equal(middle.power.mean, 0);
  assert.equal(middle.cad.mean, 0);
  assert.deepEqual([first, second], original);
  const noMass = hillProfile(members, get, null, {
    ...DEFAULTS,
    includeMinimumPower: true,
  });
  assert.equal(noMass.profile[80].minimumPower.mean, null);
  assert.equal(noMass.profile[80].power.mean, 0);
});
