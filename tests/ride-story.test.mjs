import test from "node:test";
import assert from "node:assert/strict";
import {
  detectClimbs,
  storyWindow,
  inspectRoute,
  validateClimbEdits,
} from "../lib/ride-story.mjs";

const stairs = () =>
  Array.from({ length: 161 }, (_, i) => {
    const d = i * 10;
    const ele =
      d < 100
        ? 100
        : d < 500
          ? 100 + (d - 100) * 0.08
          : d < 600
            ? 132 - (d - 500) * 0.05
            : d < 1000
              ? 127 + (d - 600) * 0.1
              : d < 1100
                ? 167 - (d - 1000) * 0.05
                : d < 1500
                  ? 162 + (d - 1100) * 0.08
                  : 194;
    return {
      t: i * 2000,
      d,
      ele,
      lat: 45 + d / 111195,
      lon: -72,
      hr: null,
      cad: null,
      speed: 5,
      power: null,
    };
  });
test("three hills with small dips form one nested climbing passage without effort inputs", () => {
  const points = stairs(),
    nodes = detectClimbs(points);
  const hills = nodes.filter((n) => n.kind === "hill"),
    passages = nodes.filter((n) => n.kind === "passage"),
    ramps = nodes.filter((n) => n.kind === "ramp");
  assert.equal(hills.length, 3);
  assert.equal(passages.length, 1);
  assert.equal(passages[0].start, 10); // Level approach is context, not part of the hill.
  assert.equal(passages[0].end, 150);
  assert.ok(hills.every((hill) => hill.parentId === passages[0].id));
  assert.ok(ramps.length >= 3);
  assert.ok(
    ramps.every((ramp) => hills.some((hill) => hill.id === ramp.parentId)),
  );
  const changedEffort = points.map((p) => ({
    ...p,
    speed: 1,
    hr: 200,
    power: 600,
    cad: 110,
  }));
  assert.deepEqual(detectClimbs(changedEffort), nodes);
  assert.equal(
    detectClimbs(points, [], { passageDip: 2 }).filter(
      (n) => n.kind === "passage",
    ).length,
    0,
  );
});
test("a short standalone steep ramp is retained even below the whole-hill gain threshold", () => {
  const points = Array.from({ length: 141 }, (_, i) => ({
    t: i * 1000,
    d: i,
    ele: Math.min(100, Math.max(0, i - 20)) * 0.08,
  }));
  const nodes = detectClimbs(points);
  assert.equal(nodes.filter((node) => node.kind === "hill").length, 0);
  const ramps = nodes.filter((node) => node.kind === "ramp");
  assert.equal(ramps.length, 1);
  assert.equal(ramps[0].parentId, "");
  assert.ok(ramps[0].length >= 50);
});

test("missing elevation, explicit breaks and long recording gaps split passage suggestions", () => {
  for (const correction of [
    { ele: null },
    { breakBefore: true },
    { gap: true },
  ]) {
    const points = stairs();
    if (correction.gap)
      for (let i = 55; i < points.length; i++) points[i].t += 60000;
    else Object.assign(points[55], correction);
    assert.ok(
      detectClimbs(points)
        .filter((n) => n.kind === "passage")
        .every((node) => !(node.start < 55 && node.end > 55)),
    );
  }
  assert.deepEqual(
    detectClimbs(stairs().map((p) => ({ ...p, ele: null }))),
    [],
  );
});
test("saved corrections are validated, reversible and attached to original sample ranges", () => {
  const points = stairs(),
    hill = detectClimbs(points).find((n) => n.kind === "hill");
  const edits = validateClimbEdits(
    [{ id: hill.id, kind: "hill", name: "First step", start: 10, end: 48 }],
    points,
  );
  const corrected = detectClimbs(points, edits).find((n) => n.id === hill.id);
  assert.equal(corrected.start, 10);
  assert.equal(corrected.end, 48);
  assert.equal(corrected.name, "First step");
  assert.equal(corrected.corrected, true);
  assert.equal(
    detectClimbs(points).find((n) => n.id === hill.id).start,
    hill.start,
  );
  assert.throws(
    () => validateClimbEdits([{ ...edits[0], start: -1 }], points),
    /boundaries/,
  );
  assert.throws(
    () => validateClimbEdits([edits[0], edits[0]], points),
    /boundaries/,
  );
});
test("focused ride windows retain both approach and aftermath and use elapsed recording time", () => {
  const points = stairs();
  assert.deepEqual(storyWindow(points, 60, 100, 200), { start: 39, end: 120 });
  assert.deepEqual(storyWindow(points, 60, 100, 200, true), {
    start: 0,
    end: 160,
  });
});
test("route inspection exposes parallel offsets and direction without translating either track", () => {
  const reference = stairs(),
    candidate = reference.map((p) => ({
      ...p,
      lon: p.lon + 20 / (111195 * Math.cos((45 * Math.PI) / 180)),
    }));
  const original = structuredClone(candidate),
    inspected = inspectRoute(reference, candidate);
  assert.ok(inspected.worst[0].offset > 19 && inspected.worst[0].offset < 21);
  assert.ok(inspected.startMiss > 19);
  assert.deepEqual(candidate, original);
  assert.ok(inspected.referenceHeading < 1);
  const reverse = candidate
    .toReversed()
    .map((p, i) => ({ ...p, d: i * 10, t: i * 2000 }));
  assert.ok(
    Math.abs(inspectRoute(reference, reverse).candidateHeading - 180) < 1,
  );
  candidate[40].lat = candidate[40].lon = null;
  assert.ok(
    inspectRoute(reference, candidate).probes.some((p) => p.offset == null),
  );
});
