import test from "node:test";
import assert from "node:assert/strict";
import { hillChartDomain, spreadInterval } from "../public/hill-chart.js";

test("heart-rate axes fit observed values with padding, including flat, zero and missing channels", () => {
  assert.deepEqual(
    hillChartDomain([{ min: 170, max: 180, mean: 175 }], "hr", "range"),
    { low: 165, high: 185 },
  );
  assert.deepEqual(
    hillChartDomain([{ min: 180, max: 180, mean: 180 }], "hr", "range"),
    { low: 175, high: 185 },
  );
  assert.deepEqual(
    hillChartDomain([{ min: 0, max: 0, mean: 0 }], "hr", "range"),
    { low: 0, high: 5 },
  );
  assert.deepEqual(
    hillChartDomain([{ min: null, max: null, mean: null }], "hr", "sd"),
    { low: 0, high: 1 },
  );
});
test("SD axes include the entire statistical interval and box axes retain outliers", () => {
  assert.deepEqual(
    hillChartDomain([{ min: 170, max: 180, mean: 175, sd: 20 }], "hr", "sd"),
    { low: 150, high: 200 },
  );
  assert.deepEqual(spreadInterval({ mean: 175, sd: null }, "sd"), null);
  const box = hillChartDomain([{ min: 130, max: 200, mean: 175 }], "hr", "box");
  assert.ok(box.low < 130 && box.high > 200);
  assert.deepEqual(
    hillChartDomain([{ min: -5, max: 8, mean: 2 }], "grade", "range"),
    { low: -5, high: 8 },
  );
});
