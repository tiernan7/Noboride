import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../lib/store.mjs";
import {
  validateComparisons,
  stretchPoints,
  coversSuggestedPass,
} from "../lib/comparisons.mjs";

test("adjustable shared-over-combined distance hides overlapping suggestions while preserving distinct laps", () => {
  const points = Array.from({ length: 501 }, (_, i) => ({ d: i * 10 }));
  const match = { startIndex: 100, endIndex: 200 };
  assert.equal(
    coversSuggestedPass({ start: 102, end: 198 }, match, points),
    true,
  );
  assert.equal(
    coversSuggestedPass({ start: 99.5, end: 200.5 }, match, points),
    true,
  );
  assert.equal(
    coversSuggestedPass({ start: 100, end: 150 }, match, points),
    false,
  );
  assert.equal(
    coversSuggestedPass({ start: 110, end: 210 }, match, points),
    true,
  );
  assert.equal(
    coversSuggestedPass({ start: 110, end: 210 }, match, points, 85),
    false,
  );
  assert.equal(
    coversSuggestedPass({ start: 100, end: 150 }, match, points, 50),
    true,
  );
  assert.equal(
    coversSuggestedPass({ start: 100, end: 150 }, match, points, 55),
    false,
  );
  assert.equal(
    coversSuggestedPass({ start: 100, end: 200 }, match, points, 100),
    true,
  );
  assert.equal(
    coversSuggestedPass({ start: 100.01, end: 200 }, match, points, 100),
    false,
  );
  // Approximate distances in the screenshot: .38 mi suggestion, .32 mi saved,
  // with .27 mi shared. Their combined span is .43 mi: 62.79% overlap.
  const screenshotPoints = [
    { d: 0 },
    { d: 0.11 * 1609.344 },
    { d: 0.38 * 1609.344 },
    { d: 0.43 * 1609.344 },
  ];
  assert.equal(
    coversSuggestedPass(
      { start: 1, end: 3 },
      { startIndex: 0, endIndex: 2 },
      screenshotPoints,
      60,
    ),
    true,
  );
  assert.equal(
    coversSuggestedPass(
      { start: 1, end: 3 },
      { startIndex: 0, endIndex: 2 },
      screenshotPoints,
      65,
    ),
    false,
  );
  assert.equal(
    coversSuggestedPass({ start: 300, end: 400 }, match, points),
    false,
  );
  // Short ranges use the same percentage rule.
  assert.equal(
    coversSuggestedPass(
      { start: 100.5, end: 104.5 },
      { startIndex: 100, endIndex: 105 },
      points,
    ),
    true,
  );
  assert.equal(
    coversSuggestedPass(
      { start: 102, end: 103 },
      { startIndex: 100, endIndex: 105 },
      points,
    ),
    false,
  );
});

const ride = {
  id: "ride",
  points: [
    { t: 0, d: 0, lat: null, lon: null, ele: 0, hr: 100 },
    { t: 10000, d: 100, lat: null, lon: null, ele: 10, hr: 120 },
    { t: 20000, d: 200, lat: null, lon: null, ele: 20, hr: null },
  ],
};
const range = { rideId: "ride", start: 0, end: 2 };
const context = (id, name) => ({
  id,
  name,
  entries: [
    { id: `${id}-first`, ...range, kind: "source" },
    { id: `${id}-second`, ...range, start: 1, kind: "effort" },
  ],
  road: range,
  selected: ["ride"],
  baseline: `${id}-second`,
  metric: "hr",
});
const validate = (value) =>
  validateComparisons(
    value,
    (id) => (id === "ride" ? ride : null),
    (s) => s,
  );
test("comparisons retain multiple entries from one ride and an independent baseline", () => {
  const result = validate({ activeId: "one", items: [context("one", "Hill")] });
  assert.equal(result.items[0].entries.length, 2);
  assert.equal(result.items[0].baseline, "one-second");
  assert.equal(result.items[0].entries[1].kind, "effort");
});
test("comparison names cannot collide after whitespace, case and Unicode normalization", () => {
  assert.throws(
    () =>
      validate({
        activeId: "one",
        items: [context("one", ""), context("two", "")],
      }),
    /unnamed/,
  );
  for (const name of [" hill ", "HILL", "Ｈｉｌｌ"])
    assert.throws(
      () =>
        validate({
          activeId: "one",
          items: [context("one", "Hill"), context("two", name)],
        }),
      /already exists/,
    );
  assert.throws(
    () =>
      validate({
        activeId: "one",
        items: [context("one", "Long hill"), context("two", "Long   hill")],
      }),
    /already exists/,
  );
});
test("invalid comparison ranges, duplicate entry IDs and active IDs are rejected", () => {
  const c = context("one", "Hill");
  assert.throws(() => validate({ activeId: "missing", items: [c] }), /Active/);
  for (const start of [-1, 2, NaN])
    assert.throws(
      () =>
        validate({
          activeId: "one",
          items: [{ ...c, entries: [{ ...c.entries[0], start }] }],
        }),
      /endpoints/,
    );
  assert.throws(
    () =>
      validate({
        activeId: "one",
        items: [{ ...c, entries: [c.entries[0], c.entries[0]] }],
      }),
    /entry/,
  );
  assert.throws(
    () =>
      validate({
        activeId: "one",
        items: [{ ...c, entries: [{ ...c.entries[0], end: 2.1 }] }],
      }),
    /endpoints/,
  );
  assert.throws(
    () => validate({ activeId: "one", items: [{ ...c, entries: [null] }] }),
    /entry/,
  );
  assert.throws(
    () =>
      validate({
        activeId: "one",
        items: [{ ...c, entries: [{ ...c.entries[0], rideId: "missing" }] }],
      }),
    /unavailable/,
  );
});
test("fractional stretch endpoints preserve interpolated timing and missing GPS", () => {
  const points = stretchPoints(ride.points, 0.5, 1.5);
  assert.deepEqual(
    points.map((p) => p.t),
    [5000, 10000, 15000],
  );
  assert.deepEqual(
    points.map((p) => p.d),
    [50, 100, 150],
  );
  assert.equal(points[0].lat, null);
  assert.equal(points.at(-1).hr, null);
});

test("per-ride source selections persist separately from accepted stretches", () => {
  const c = {
    ...context("one", "Hill"),
    browse: { rideId: "ride", start: 1, end: 2 },
    drafts: [{ rideId: "ride", start: 0, end: 1 }],
  };
  const result = validate({ activeId: "one", items: [c] }).items[0];
  assert.deepEqual(result.drafts, c.drafts);
  assert.deepEqual(result.browse, c.browse);
  assert.equal(result.entries[0].end, 2);
  assert.throws(
    () =>
      validate({
        activeId: "one",
        items: [{ ...c, drafts: [...c.drafts, ...c.drafts] }],
      }),
    /Duplicate source/,
  );
  assert.throws(
    () =>
      validate({
        activeId: "one",
        items: [{ ...c, browse: { rideId: "ride", start: 0.5, end: 2 } }],
      }),
    /recorded sample/,
  );
  assert.deepEqual(
    validate({ activeId: "one", items: [context("one", "Old context")] })
      .items[0].drafts,
    [],
  );
});
test("comparison storage persists and migration backs up existing databases before adding a table", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "noboride-contexts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "old.sqlite");
  let store = new Store(path);
  store.saveSettings({ gradeWindow: 90 });
  store.db.exec("DROP TABLE comparison_workspace");
  store.close();
  store = new Store(path);
  const value = validate({ activeId: "one", items: [context("one", "Hill")] });
  store.saveComparisons(value);
  store.close();
  const backups = readdirSync(dir).filter((p) =>
    p.includes("before-comparisons"),
  );
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(dir, backups[0]), { readOnly: true });
  assert.equal(
    backup
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='comparison_workspace'",
      )
      .get(),
    undefined,
  );
  backup.close();
  store = new Store(path);
  assert.deepEqual(store.comparisons(), value);
  assert.equal(store.settings().gradeWindow, 90);
  store.close();
  assert.equal(
    readdirSync(dir).filter((p) => p.includes("before-comparisons")).length,
    1,
  );
});
