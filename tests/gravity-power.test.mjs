import test from "node:test";
import assert from "node:assert/strict";
import {
  gravityOnlyPower,
  validateGravityMasses,
  validatePowerErrors,
  minimumInputPower,
  minimumInputProfile,
  averageMinimumProfile,
} from "../lib/gravity-power.mjs";
const masses = { riderMassKg: 80, bikeMassKg: 20 };
test("local minimum averages integrate time, retain zeros and disclose missing time instead of filling it", () => {
  // 100 W for 10 s, then a linear fall to zero over 30 s: 2500 J / 40 s.
  const rows = [
    { t: 0, minimumWatts: 100 },
    { t: 10000, minimumWatts: 100 },
    { t: 40000, minimumWatts: 0 },
  ];
  assert.deepEqual(averageMinimumProfile(rows), {
    watts: 62.5,
    supportedSeconds: 40,
    elapsedSeconds: 40,
    coverage: 1,
  });
  const partial = averageMinimumProfile([
    ...rows,
    { t: 50000, minimumWatts: null },
    { t: 60000, minimumWatts: 200 },
  ]);
  assert.equal(partial.watts, 62.5);
  assert.equal(partial.supportedSeconds, 40);
  assert.equal(partial.coverage, 2 / 3);
  assert.equal(
    averageMinimumProfile([
      { t: 0, minimumWatts: null },
      { t: 1000, minimumWatts: null },
    ]).watts,
    null,
  );
});
const track = [
  { t: 0, ele: 100 },
  { t: 10000, ele: 150 },
  { t: 20000, ele: 200 },
];
test("gravity-only power uses net potential energy and elapsed time, independent of sensors or constant altitude offset", () => {
  const result = gravityOnlyPower(track, masses);
  assert.equal(result.watts, 4903.325);
  assert.equal(result.netGainMeters, 100);
  assert.equal(result.elapsedSeconds, 20);
  assert.equal(
    gravityOnlyPower(
      track.map((p) => ({
        ...p,
        ele: p.ele + 500,
        hr: 180,
        power: 999,
        timer: false,
      })),
      masses,
    ).watts,
    result.watts,
  );
  const paused = [
    { t: 0, ele: 100 },
    { t: 10000, ele: 100, timer: false },
    { t: 20000, ele: 100, timer: false },
    { t: 30000, ele: 100 },
    { t: 40000, ele: 200 },
  ];
  assert.equal(gravityOnlyPower(paused, masses).watts, 2451.6625);
});
const energyRide = (startSpeed = 10, endSpeed = 5, height = 10) =>
  Array.from({ length: 21 }, (_, t) => {
    const d =
        t <= 5
          ? startSpeed * t
          : t <= 15
            ? startSpeed * 5 + ((startSpeed + endSpeed) / 2) * (t - 5)
            : startSpeed * 5 +
              (startSpeed + endSpeed) * 5 +
              endSpeed * (t - 15),
      total = startSpeed * 5 + (startSpeed + endSpeed) * 5 + endSpeed * 5;
    return {
      t: t * 1000,
      d,
      ele: 100 + (height * d) / total,
      speed: null,
      lat: 45 + d / 111195,
      lon: -72,
    };
  });
test("minimum input credits lost starting kinetic energy, adds acceleration and never subtracts all starting energy", () => {
  const sameSpeed = minimumInputPower(energyRide(5, 5), masses);
  assert.equal(sameSpeed.minimumWatts, 490.3325);
  assert.equal(sameSpeed.kineticWatts, 0);
  const slowing = minimumInputPower(energyRide(), masses);
  assert.equal(slowing.startSpeed, 10);
  assert.equal(slowing.endSpeed, 5);
  assert.ok(Math.abs(slowing.minimumWatts - 302.8325) < 1e-9);
  assert.equal(slowing.kineticWatts, -187.5);
  assert.ok(
    Math.abs(
      minimumInputPower(energyRide(5, 10), masses).minimumWatts - 677.8325,
    ) < 1e-9,
  );
  assert.equal(minimumInputPower(energyRide(10, 5, 2), masses).minimumWatts, 0);
});
test("minimum input error ranges vary explicit height and endpoint speed assumptions, without claiming measured GPS accuracy", () => {
  const estimate = minimumInputPower(energyRide(), {
    ...masses,
    powerHeightErrorM: 2,
    powerSpeedErrorMps: 1,
  });
  assert.ok(Math.abs(estimate.lowerWatts - 129.766) < 1e-9);
  assert.ok(Math.abs(estimate.upperWatts - 475.899) < 1e-9);
  assert.equal(minimumInputPower(energyRide(), masses).lowerWatts, null);
  for (const bad of [-1, Infinity, "2", 101])
    assert.throws(() => validatePowerErrors({ powerHeightErrorM: bad }));
  assert.throws(() => validatePowerErrors({ powerSpeedErrorMps: 21 }));
});
test("local power follows a physical distance window, reference elevation and each pass's elapsed time", () => {
  const p = Array.from({ length: 101 }, (_, i) => ({
      t: i * 1000,
      d: i * 10,
      ele: 100 + i * 0.5,
    })),
    settings = { ...masses, gradeWindow: 50 },
    profile = minimumInputProfile(p, settings);
  assert.equal(profile.rows.length, 201);
  for (const row of profile.rows) {
    assert.ok(Math.abs(row.gradePercent - 5) < 1e-8);
    assert.ok(Math.abs(row.gravityWatts - 490.3325) < 1e-8);
    assert.ok(Math.abs(row.minimumWatts - 490.3325) < 1e-8);
    assert.ok(row.windowMeters >= 25 && row.windowMeters <= 50);
  }
  // Independent piecewise-linear 3% then 9% ramp: the 50 m window
  // centred at the join contains 25 m of each and must report 6%.
  const ramp = minimumInputProfile(
    p.map((point, i) => ({
      ...point,
      ele: 100 + (i <= 50 ? i * 0.3 : 15 + (i - 50) * 0.9),
    })),
    settings,
  );
  assert.ok(Math.abs(ramp.rows[0].gradePercent - 3) < 1e-8);
  assert.ok(Math.abs(ramp.rows[100].gradePercent - 6) < 1e-8);
  assert.ok(Math.abs(ramp.rows[200].gradePercent - 9) < 1e-8);
  const slow = minimumInputProfile(
    p.map((point) => ({ ...point, t: point.t * 2, ele: null })),
    settings,
    p,
  );
  assert.ok(
    slow.rows.every((row) => Math.abs(row.minimumWatts - 245.16625) < 1e-8),
  );
  const missing = p.map((point, i) => ({
      ...point,
      ele: i === 50 ? null : point.ele,
    })),
    incomplete = minimumInputProfile(missing, settings);
  assert.ok(incomplete.rows.some((row) => row.minimumWatts == null));
  assert.ok(incomplete.rows.some((row) => row.minimumWatts != null));
  const gap = p.map((point, i) => ({ ...point, breakBefore: i === 50 }));
  assert.ok(
    minimumInputProfile(gap, settings).rows.some(
      (row) => row.minimumWatts == null,
    ),
  );
  assert.equal(minimumInputProfile(p, {}).rows.length, 0);
});
test("reference elevation supplies consistent gain while each pass retains its own elapsed time", () => {
  const shifted = track.map((p) => ({ t: p.t * 2, ele: null }));
  assert.equal(gravityOnlyPower(shifted, masses, track).watts, 2451.6625);
  assert.equal(gravityOnlyPower(track, masses).watts, 4903.325);
});
test("contradictory distance jumps leave local momentum unknown instead of fabricating an acceleration spike", () => {
  // Deterministic synthetic channel mismatch: a 40 m cumulative-distance step
  // in one second while the speed channel remains 10 m/s. Not random GPS noise.
  const points = Array.from({ length: 101 }, (_, i) => ({
      t: i * 1000,
      d: i * 10 + (i >= 50 ? 40 : 0),
      ele: 100 + i * 0.5,
      speed: 10,
    })),
    original = structuredClone(points),
    result = minimumInputProfile(points, { ...masses, gradeWindow: 30 });
  const rejected = result.rows.filter((r) => r.reason.includes("disagree"));
  assert.ok(rejected.length > 0);
  assert.ok(
    rejected.every((r) => r.minimumWatts === null && r.kineticWatts === null),
  );
  assert.ok(result.rows.some((r) => r.minimumWatts != null));
  assert.ok(
    result.rows.every((r) => r.minimumWatts == null || r.minimumWatts < 600),
  );
  assert.deepEqual(points, original);
  const badEndpoint = points.map((p, i) => ({
    ...p,
    d: p.d + (i === 100 ? 50 : 0),
  }));
  assert.equal(minimumInputPower(badEndpoint, masses).minimumWatts, null);
  assert.match(minimumInputPower(badEndpoint, masses).reason, /disagree/);
});
test("missing elevations, recording gaps, invalid timing and non-climbs do not yield confident watts", () => {
  for (const points of [
    track.map((p, i) => ({ ...p, ele: i === 1 ? null : p.ele })),
    track.map((p, i) => ({ ...p, breakBefore: i === 1 })),
    [
      { t: 0, ele: 0 },
      { t: 31000, ele: 10 },
    ],
    [
      { t: 0, ele: 0 },
      { t: 0, ele: 10 },
    ],
    track.map((p) => ({ ...p, ele: 100 })),
    [...track, { t: 30000, ele: 100 }],
  ]) {
    const estimate = gravityOnlyPower(points, masses);
    assert.equal(estimate.watts, null);
    assert.ok(estimate.reason);
  }
  assert.equal(gravityOnlyPower(track, {}, track).watts, null);
  assert.equal(
    gravityOnlyPower(
      track,
      masses,
      track.map((p) => ({ ...p, ele: null })),
    ).watts,
    null,
  );
});
test("mass settings accept missing legacy values and reject invalid values", () => {
  assert.deepEqual(validateGravityMasses({}), {
    riderMassKg: null,
    bikeMassKg: null,
  });
  for (const riderMassKg of [0, -1, Infinity, NaN, "80", 351])
    assert.throws(() => validateGravityMasses({ riderMassKg }));
  for (const bikeMassKg of [0, -1, "10", 201])
    assert.throws(() => validateGravityMasses({ bikeMassKg }));
});
