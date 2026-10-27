import { test, expect } from "@playwright/test";
import { makeDemo } from "../../lib/demo.mjs";
import { DEFAULTS } from "../../lib/analysis.mjs";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
const settled = (page) =>
  expect(page.locator("body")).not.toHaveClass(/working/);
async function seed(request, repeat = false) {
  const base = makeDemo().rides[0],
    rides = Array.from({ length: 8 }, (_, run) => ({
      ...base,
      id: `${repeat ? "repeat-" : ""}plot-${run}`,
      name: `Synthetic climb ${run}`,
      date: new Date(Date.UTC(2026, 9, 1 + run)).toISOString(),
      points: Array.from({ length: 101 }, (_, i) => ({
        ...base.points[0],
        t: Date.UTC(2026, 9, 1 + run) + i * (1000 + run * 100),
        d: i * 10,
        lat: 45 + (i * 10) / 111195,
        lon: -72,
        ele: 100 + run * 20 + i * (0.5 + run * 0.1),
        power: null,
        speed: 10 / (1 + run * 0.1),
      })),
    })),
    comparison = {
      id: "plot-comparison",
      name: "Plot comparison",
      sections: [],
      entries: rides.map((r, i) => ({
        id: `entry-${i}`,
        rideId: r.id,
        start: 0,
        end: 100,
        kind: i ? "matched" : "source",
      })),
      road: { rideId: rides[0].id, start: 0, end: 100 },
      roadEntryId: "entry-0",
      selected: rides.map((r) => r.id),
      browse: { rideId: rides[0].id, start: 0, end: 100 },
      baseline: "entry-0",
      comparison: "entry-1",
      metric: "delta",
      settings: { ...DEFAULTS, units: "metric" },
    };
  if (repeat) {
    rides[0].points = rides[0].points.concat(
      rides[0].points.map((p, i) => ({
        ...p,
        t: p.t + 101000,
        d: p.d + 1010,
        breakBefore: i === 0,
      })),
    );
    comparison.entries.push({
      id: "entry-loop",
      rideId: rides[0].id,
      start: 101,
      end: 201,
      kind: "matched",
    });
  }
  expect(
    (
      await request.post("/api/restore", {
        data: { schemaVersion: 1, rides, settings: {}, segments: [] },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: comparison.id, items: [comparison] },
      })
    ).ok(),
  ).toBeTruthy();
  return { rides, comparison };
}
test("comparison plots have distinct pass colors, independent visibility and a persistent date gradient", async ({
  page,
  request,
}) => {
  const { comparison } = await seed(request);
  await page.goto("/");
  await settled(page);
  await expect(page.locator("[data-plot-line]")).toHaveCount(8);
  const colors = await page
    .locator("[data-plot-line]")
    .evaluateAll((es) => es.map((e) => e.getAttribute("stroke")));
  expect(new Set(colors).size).toBe(8);
  const before = await (await request.get("/api/workspace")).json();
  await page.locator('[data-plot-entry="entry-0"]').uncheck();
  await expect(page.locator("[data-plot-line]")).toHaveCount(7);
  await expect(page.locator("#plot-visibility")).toContainText(
    "baseline line is hidden",
  );
  await expect(page.locator("#matches tbody tr")).toHaveCount(8);
  await expect(page.locator("#baseline")).toHaveValue("entry-0");
  await page.locator("#plot-colors").selectOption("date");
  await expect(page.locator("#plot-date-key")).toContainText("Oldest");
  await expect(page.locator('[data-plot-entry="entry-0"]')).toBeEnabled();
  await page.reload();
  await settled(page);
  await expect(page.locator('[data-plot-entry="entry-0"]')).not.toBeChecked();
  await expect(page.locator("#plot-colors")).toHaveValue("date");
  await page.locator("#plot-none").click();
  await expect(page.locator("[data-plot-line]")).toHaveCount(0);
  await expect(page.locator("#comparison-chart")).toContainText(
    "No passes selected for this plot",
  );
  await page.locator("#plot-all").click();
  await expect(page.locator("[data-plot-line]")).toHaveCount(8);
  await expect(page.locator('[data-plot-line="entry-0"]')).toHaveAttribute(
    "stroke",
    "rgb(106 164 211)",
  );
  await expect(page.locator('[data-plot-line="entry-7"]')).toHaveAttribute(
    "stroke",
    "rgb(10 45 100)",
  );
  const after = await (await request.get("/api/workspace")).json(),
    saved = after.comparisons.items.find((c) => c.id === comparison.id);
  expect(saved.entries).toEqual(before.comparisons.items[0].entries);
  expect(saved.baseline).toBe("entry-0");
  const backup = JSON.parse(
    gunzipSync(await (await request.get("/api/backup")).body()),
  );
  expect(
    backup.comparisons.items.find((c) => c.id === comparison.id).plot,
  ).toEqual({ colorMode: "date", hidden: [] });
  const invalid = structuredClone(backup);
  invalid.comparisons.items.find((c) => c.id === comparison.id).plot.colorMode =
    "invalid";
  expect(
    (await request.post("/api/restore", { data: invalid })).ok(),
  ).toBeFalsy();
  expect(
    (await request.post("/api/restore", { data: backup })).ok(),
  ).toBeTruthy();
  await page
    .locator("#comparison-chart")
    .locator("..")
    .screenshot({ path: "test-results/plot-controls-desktop.png" });
  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { error: "Plot save failed" } })
      : route.continue(),
  );
  await page.locator('[data-plot-entry="entry-2"]').click();
  await expect(page.locator("#messages")).toContainText("Plot save failed");
  await expect(page.locator('[data-plot-entry="entry-2"]')).toBeChecked();
  await page.unroute("**/api/comparisons");
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});
test("solid line swatches label dates, sequential palettes persist and hover/focus identifies repeated passes", async ({
  page,
  request,
}) => {
  await seed(request, true);
  await page.goto("/");
  await settled(page);
  await expect(page.locator("[data-plot-line]")).toHaveCount(9);
  const label = page.locator('[data-plot-key="entry-loop"]'),
    curve = page.locator('[data-plot-line="entry-loop"]');
  await expect(label).toContainText("pass 2");
  await expect(label.locator(".plot-swatch line")).toHaveAttribute(
    "stroke-dasharray",
    "",
  );
  await expect(curve).toHaveAttribute("stroke-dasharray", "");
  await page.locator("#plot-colors").selectOption("date");
  await expect(page.locator("#plot-visibility")).toContainText(
    "Equal dates share a color",
  );
  for (const id of ["entry-0", "entry-3", "entry-7", "entry-loop"]) {
    const line = page.locator(`[data-plot-line="${id}"]`),
      swatch = page.locator(`[data-plot-key="${id}"] .plot-swatch line`);
    await expect(swatch).toHaveAttribute(
      "stroke",
      await line.getAttribute("stroke"),
    );
    await expect(swatch).toHaveAttribute(
      "stroke-dasharray",
      await line.getAttribute("stroke-dasharray"),
    );
  }
  await label.hover();
  await expect(curve).toHaveCSS("opacity", "1");
  await expect(page.locator('[data-plot-line="entry-3"]')).toHaveCSS(
    "opacity",
    "0.18",
  );
  await page.locator("#plot-colors").hover();
  await expect(page.locator('[data-plot-line="entry-3"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(label.locator("input")).toBeEnabled();
  await label.locator("input").focus();
  await expect(label.locator("input")).toBeFocused();
  await expect(page.locator('[data-plot-line="entry-3"]')).toHaveCSS(
    "opacity",
    "0.18",
  );
  await page.locator("#plot-colors").focus();
  await page.locator("#plot-colors").selectOption("date-gray");
  await expect(page.locator('[data-plot-line="entry-0"]')).toHaveAttribute(
    "stroke",
    "rgb(168 168 168)",
  );
  await expect(page.locator('[data-plot-line="entry-7"]')).toHaveAttribute(
    "stroke",
    "rgb(30 30 30)",
  );
  const expectedDate = await page.evaluate(() =>
    new Date("2026-10-01T00:00:00.000Z").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  );
  await expect(label).toContainText(expectedDate);
  await expect(label).not.toContainText("dashed");
  await page.reload();
  await settled(page);
  await expect(page.locator("#plot-colors")).toHaveValue("date-gray");
  await expect(page.locator('[data-plot-line="entry-loop"]')).toHaveAttribute(
    "stroke-dasharray",
    "",
  );
  await page
    .locator("#comparison-chart")
    .locator("..")
    .screenshot({ path: "test-results/plot-solid-date-colors.png" });
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});

test("minimum-input estimates persist weights, share verified reference gain and export separately from recorded power", async ({
  page,
  request,
}) => {
  const { comparison, rides } = await seed(request);
  await page.goto("/");
  await settled(page);
  await page.locator("#gravity-power > summary").click();
  await expect(
    page.locator('[data-gravity-entry="entry-0"] [data-gravity-watts]'),
  ).toContainText("Enter rider");
  await page.locator("#gravity-rider").fill("75");
  await page.locator("#gravity-bike").fill("10");
  await page.locator("#gravity-apply").click();
  await expect(page.locator("#gravity-status")).toContainText("Weights saved");
  await expect(
    page.locator('[data-gravity-entry="entry-0"] [data-gravity-watts]'),
  ).toHaveText("417 W");
  // The second recording climbs 60 m in its own elevation channel. Both
  // verified passes deliberately use the reference's 50 m endpoint difference.
  await expect(
    page.locator('[data-gravity-entry="entry-1"] [data-gravity-watts]'),
  ).toHaveText("379 W");
  await expect(page.locator("#gravity-basis")).toContainText(
    "shared road reference",
  );
  await page.locator("#settings-button").click();
  await page.locator("#units").selectOption("imperial");
  await page.locator('[data-close="settings"]').click();
  expect(Number(await page.locator("#gravity-rider").inputValue())).toBeCloseTo(
    165.346697,
    5,
  );
  expect(Number(await page.locator("#gravity-bike").inputValue())).toBeCloseTo(
    22.046226,
    5,
  );
  await page.reload();
  await settled(page);
  await page.locator("#gravity-power > summary").click();
  await expect(
    page.locator('[data-gravity-entry="entry-0"] [data-gravity-watts]'),
  ).toHaveText("417 W");
  const backup = JSON.parse(
      gunzipSync(await (await request.get("/api/backup")).body()),
    ),
    saved = backup.comparisons.items.find((c) => c.id === comparison.id);
  expect(saved.settings.riderMassKg).toBe(75);
  expect(saved.settings.bikeMassKg).toBe(10);
  expect(
    (await request.put("/api/settings", { data: { riderMassKg: -1 } })).ok(),
  ).toBeFalsy();
  const invalid = structuredClone(backup);
  invalid.comparisons.items.find(
    (c) => c.id === comparison.id,
  ).settings.riderMassKg = -1;
  expect(
    (await request.post("/api/restore", { data: invalid })).ok(),
  ).toBeFalsy();
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const csv = readFileSync(await (await download).path(), "utf8"),
    rows = csv
      .trim()
      .split(/\r?\n/)
      .map((r, i) => r.split(",").map((v) => (i ? v.slice(1, -1) : v))),
    headers = rows[0];
  expect(rows[1][headers.indexOf("recorded_power_w")]).toBe("");
  expect(Number(rows[1][headers.indexOf("gravity_only_power_w")])).toBeCloseTo(
    416.782625,
    6,
  );
  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { error: "Weight save failed" } })
      : route.continue(),
  );
  await page.locator("#gravity-rider").fill("180");
  await page.locator("#gravity-apply").click();
  await expect(page.locator("#gravity-status")).toContainText(
    "Weight save failed",
  );
  await expect(page.locator("#gravity-rider")).toHaveValue("180");
  await expect(
    page.locator('[data-gravity-entry="entry-0"] [data-gravity-watts]'),
  ).toHaveText("417 W");
  await page.unroute("**/api/comparisons");
  await page.locator("#gravity-apply").click();
  await expect(page.locator("#gravity-status")).toContainText("Weights saved");
  const current = (await (await request.get("/api/workspace")).json())
    .comparisons;
  const independent = current.items.find((c) => c.id === comparison.id);
  independent.mode = "terrain";
  independent.road = null;
  delete independent.roadEntryId;
  independent.entries = independent.entries
    .slice(0, 2)
    .map((e) => ({ ...e, kind: "effort", relation: "similar-terrain" }));
  await request.put("/api/comparisons", { data: current });
  await page.reload();
  await settled(page);
  await page.locator("#gravity-power > summary").click();
  await expect(page.locator("#gravity-basis")).toContainText(
    "Each pass uses its own",
  );
  const own = (
      await (await request.get("/api/workspace")).json()
    ).comparisons.items.find((c) => c.id === comparison.id),
    total = own.settings.riderMassKg + own.settings.bikeMassKg;
  await expect(
    page.locator('[data-gravity-entry="entry-1"] [data-gravity-watts]'),
  ).toHaveText(`${Math.round((total * 9.80665 * 60) / 110)} W`);
  expect(
    (await (await request.get(`/api/rides/${rides[0].id}`)).json()).points,
  ).toEqual(rides[0].points);
  expect(
    (await request.post("/api/restore", { data: backup })).ok(),
  ).toBeTruthy();
  const restored = (
    await (await request.get("/api/workspace")).json()
  ).comparisons.items.find((c) => c.id === comparison.id);
  expect(restored.settings.riderMassKg).toBe(75);
  await page.reload();
  await settled(page);
  await page.locator("#gravity-power > summary").click();
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page
    .locator("#gravity-power")
    .screenshot({ path: "test-results/gravity-power-mobile.png" });
});
test("momentum correction and windowed slope display use explicit error sensitivity and preserve source power", async ({
  page,
  request,
}) => {
  const { rides, comparison } = await seed(request),
    base = rides[0],
    energyRides = [false, true].map((constant, run) => ({
      ...base,
      id: `windowed-energy-${run}`,
      name: `Windowed energy ${run}`,
      points: Array.from({ length: 21 }, (_, t) => {
        const d = constant
          ? t * 7.5
          : t <= 5
            ? 10 * t
            : t <= 15
              ? 50 + 7.5 * (t - 5)
              : 125 + 5 * (t - 15);
        return {
          ...base.points[0],
          t: Date.UTC(2026, 9, 1 + run) + t * 1000,
          d,
          lat: 45 + d / 111195,
          lon: -72,
          ele: 100 + d / 15,
          speed: null,
          power: null,
        };
      }),
    }));
  expect(
    (
      await request.post("/api/restore", {
        data: {
          schemaVersion: 1,
          rides: energyRides,
          settings: {},
          segments: [],
        },
      })
    ).ok(),
  ).toBeTruthy();
  const originalEnergyPoints = (
    await (await request.get(`/api/rides/${energyRides[0].id}`)).json()
  ).points;
  comparison.entries = energyRides.map((r, i) => ({
    id: `energy-${i}`,
    rideId: r.id,
    start: 0,
    end: 20,
    kind: i ? "matched" : "source",
  }));
  comparison.road = { rideId: energyRides[0].id, start: 0, end: 20 };
  comparison.roadEntryId = "energy-0";
  comparison.selected = energyRides.map((r) => r.id);
  comparison.baseline = "energy-0";
  comparison.comparison = "energy-1";
  comparison.browse = { ...comparison.road };
  comparison.settings = {
    ...DEFAULTS,
    units: "metric",
    riderMassKg: 80,
    bikeMassKg: 20,
    gradeWindow: 30,
  };
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: comparison.id, items: [comparison] },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await settled(page);
  await page.locator("#gravity-power > summary").click();
  await expect(
    page.locator('[data-gravity-entry="energy-0"] [data-minimum-watts]'),
  ).toHaveText("303 W");
  await expect(
    page.locator('[data-gravity-entry="energy-1"] [data-minimum-watts]'),
  ).toHaveText("490 W");
  await expect(page.locator("#mechanical-profile-status")).toContainText(
    "30 m physical window",
  );
  await expect(
    page.locator('[data-gravity-entry="energy-0"] [data-power-error-range]'),
  ).toHaveText("Error range unquantified");
  await expect(page.locator("[data-mechanical-band]")).toHaveCount(0);
  // The exact synthetic reference slope is 1 m per 15 m (6⅔%).
  // Grade stays orange even where acceleration changes the power trace.
  expect(
    await page
      .locator("#mechanical-profile stop")
      .evaluateAll((es) => [
        ...new Set(es.map((e) => e.getAttribute("stop-color"))),
      ]),
  ).toEqual(["#e5a16c"]);
  await expect(page.locator("#mechanical-grade-legend")).toContainText("6–9%");
  for (const selector of [
    "[data-mechanical-slope]",
    "[data-mechanical-power]",
  ]) {
    const box = await page.locator(selector).evaluate((e) => {
      const b = e.getBBox();
      return { w: b.width, h: b.height };
    });
    expect(box.w).toBeGreaterThan(100);
    expect(box.h).toBeGreaterThan(1);
  }
  await page.locator("#power-height-error").fill("2");
  await page.locator("#power-speed-error").fill("1");
  await page.locator("#gravity-apply").click();
  await expect(
    page.locator('[data-gravity-entry="energy-0"] [data-power-error-range]'),
  ).toContainText("130–476 W");
  await expect(page.locator("[data-mechanical-band]")).toHaveCount(200);
  await page.locator("#mechanical-axis").selectOption("time");
  await expect(page.locator("#mechanical-profile")).toContainText(
    "Elapsed time in selected range",
  );
  const svg = page.locator("#mechanical-profile");
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await expect(page.locator("#mechanical-profile-value")).toContainText(
    "grade 6.7%",
  );
  await expect(page.locator("#mechanical-profile-value")).toContainText(
    "momentum",
  );
  await expect(page.locator("#mechanical-profile-value")).toContainText(
    "assumed-error sensitivity",
  );
  await page.locator("#mechanical-window").evaluate((input) => {
    input.value = "60";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#mechanical-profile-status")).toContainText(
    "60 m physical window",
  );
  await page.locator("#mechanical-pass").selectOption("energy-1");
  await page
    .locator("#gravity-profile")
    .screenshot({ path: "test-results/minimum-input-profile.png" });
  await page.reload();
  await settled(page);
  await page.locator("#gravity-power > summary").click();
  await expect(page.locator("#power-height-error")).toHaveValue("2");
  await expect(page.locator("#power-speed-error")).toHaveValue("1");
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  expect(
    (await (await request.get(`/api/rides/${energyRides[0].id}`)).json())
      .points,
  ).toEqual(originalEnergyPoints);
});

test("comparison minimum-power sweeps and table averages share settings, visibility, units and persistence", async ({
  page,
  request,
}) => {
  const { comparison } = await seed(request);
  comparison.settings = {
    ...DEFAULTS,
    units: "metric",
    riderMassKg: 80,
    bikeMassKg: 20,
    gradeWindow: 50,
  };
  comparison.metric = "minimumPower";
  await request.put("/api/comparisons", {
    data: { activeId: comparison.id, items: [comparison] },
  });
  await page.goto("/");
  await settled(page);
  await expect(page.locator("#metric")).toHaveValue("minimumPower");
  await expect(page.locator("[data-estimated-average=entry-0]")).toHaveText(
    "490 W",
  );
  await expect(page.locator("[data-estimated-average=entry-1]")).toHaveText(
    "446 W",
  );
  await expect(page.locator("#comparison-chart [data-plot-line]")).toHaveCount(
    8,
  );
  const svg = page.locator("#comparison-chart svg");
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#legend")).toContainText("490.3 W");
  await page.locator('[data-plot-entry="entry-0"]').uncheck();
  await expect(page.locator("#comparison-chart [data-plot-line]")).toHaveCount(
    7,
  );
  await expect(page.locator("[data-estimated-average=entry-0]")).toHaveText(
    "490 W",
  );
  await page.locator("#gravity-power > summary").click();
  await page.locator("#gravity-rider").fill("70");
  await page.locator("#gravity-apply").click();
  await expect(page.locator("[data-estimated-average=entry-0]")).toHaveText(
    "441 W",
  );
  await expect(page.locator('[data-windowed-average="entry-0"]')).toContainText(
    "441 W",
  );
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const rows = readFileSync(await (await download).path(), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((row, i) => row.split(",").map((v) => (i ? v.slice(1, -1) : v)));
  expect(
    Number(rows[1][rows[0].indexOf("windowed_minimum_average_w")]),
  ).toBeCloseTo(441.29925, 6);
  expect(
    Number(rows[1][rows[0].indexOf("windowed_minimum_time_coverage")]),
  ).toBeCloseTo(1, 9);
  await page.reload();
  await settled(page);
  await expect(page.locator("#metric")).toHaveValue("minimumPower");
  await expect(page.locator("[data-estimated-average=entry-0]")).toHaveText(
    "441 W",
  );
  await page.locator("#metric").selectOption("power");
  await expect(page.locator("#comparison-chart")).toContainText(
    "wasn’t recorded",
  );
  await page.locator("#metric").selectOption("minimumPower");
  await page
    .locator("#comparison-chart")
    .screenshot({ path: "test-results/comparison-minimum-power.png" });
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/workspace")).json()).comparisons
          .items[0].metric,
    )
    .toBe("minimumPower");
  const contexts = (await (await request.get("/api/workspace")).json())
    .comparisons;
  const independent = contexts.items.find((c) => c.id === comparison.id);
  independent.mode = "terrain";
  independent.road = null;
  delete independent.roadEntryId;
  independent.entries = independent.entries.map((e) => ({
    ...e,
    kind: "effort",
    relation: "similar-terrain",
  }));
  expect(
    (await request.put("/api/comparisons", { data: contexts })).ok(),
  ).toBeTruthy();
  await page.reload();
  await settled(page);
  for (const axis of ["progress", "elapsed", "distance", "ascent"]) {
    await page.locator("#effort-axis").selectOption(axis);
    await expect(
      page.locator("#comparison-chart [data-plot-line]"),
    ).toHaveCount(7);
    expect(
      await page
        .locator("#comparison-chart [data-plot-line]")
        .first()
        .getAttribute("d"),
    ).not.toMatch(/NaN|Infinity/);
  }
});

test("missing local power stays a gap and its average reports supported time coverage", async ({
  page,
  request,
}) => {
  const { rides, comparison } = await seed(request);
  const ride = {
    ...rides[0],
    id: "partial-power",
    name: "Synthetic distance correction",
    points: rides[0].points.map((p, i) => ({
      ...p,
      d: p.d + (i >= 50 ? 40 : 0),
      speed: 10,
    })),
  };
  expect(
    (
      await request.post("/api/restore", {
        data: { schemaVersion: 1, rides: [ride], settings: {}, segments: [] },
      })
    ).ok(),
  ).toBeTruthy();
  comparison.entries = [
    {
      id: "partial-entry",
      rideId: ride.id,
      start: 0,
      end: 100,
      kind: "source",
    },
  ];
  comparison.road = { rideId: ride.id, start: 0, end: 100 };
  comparison.roadEntryId = "partial-entry";
  comparison.selected = [ride.id];
  comparison.baseline = "partial-entry";
  comparison.comparison = "";
  comparison.browse = comparison.road;
  comparison.metric = "minimumPower";
  comparison.settings = {
    ...DEFAULTS,
    riderMassKg: 80,
    bikeMassKg: 20,
    gradeWindow: 30,
  };
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: comparison.id, items: [comparison] },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await settled(page);
  await expect(
    page.locator('[data-estimated-average="partial-entry"]'),
  ).toContainText("Partial");
  const path = await page
    .locator('[data-plot-line="partial-entry"]')
    .getAttribute("d");
  expect((path.match(/M/g) || []).length).toBeGreaterThan(1);
  await page.locator("#gravity-power > summary").click();
  await expect(
    page.locator('[data-windowed-average="partial-entry"]'),
  ).toContainText("Partial");
  await expect(
    page.locator('[data-gravity-entry="partial-entry"] [data-minimum-watts]'),
  ).toHaveText("490 W");
});
