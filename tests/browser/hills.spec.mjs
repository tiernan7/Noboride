import { test, expect } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { DEFAULTS } from "../../lib/analysis.mjs";
const settled = (page) =>
  expect(page.locator("body")).not.toHaveClass(/working/);
const workspace = async (request) =>
  (await (await request.get("/api/workspace")).json()).comparisons;
const active = async (request) => {
  const w = await workspace(request);
  return w.items.find((c) => c.id === w.activeId);
};
const catalog = async (request) => (await request.get("/api/hills")).json();
const put = async (request, path, data) => {
  const r = await request.put(path, { data });
  expect(r.ok(), await r.text()).toBeTruthy();
};
async function seed(request, count = 2, fractional = false) {
  const data = await catalog(request),
    observations = ["demo-0", "demo-1", "demo-2"]
      .slice(0, count)
      .map((id) => data.observations.find((o) => o.rideId === id)),
    entries = observations.map((o, i) => ({
      id: `e${i}`,
      sectionId: `s${i}`,
      rideId: o.rideId,
      start: o.start + (fractional ? 0.25 : 0),
      end: o.end - (fractional ? 0.25 : 0),
      kind: i ? "effort" : "source",
      relation: "same-road",
      ...(i ? { review: "confirmed" } : {}),
    })),
    sections = entries.map((e, i) => ({
      id: e.sectionId,
      rideId: e.rideId,
      start: e.start,
      end: e.end,
      kind: "hill",
      name: `Source hill ${i}`,
    })),
    c = {
      id: "source",
      name: "Source comparison",
      mode: "same-road",
      entries,
      sections,
      road: {
        rideId: entries[0].rideId,
        start: entries[0].start,
        end: entries[0].end,
      },
      roadEntryId: "e0",
      selected: observations.map((o) => o.rideId),
      browse: {
        rideId: entries[0].rideId,
        start: Math.floor(entries[0].start),
        end: Math.ceil(entries[0].end),
      },
      baseline: "e0",
      comparison: "e1",
      settings: DEFAULTS,
    };
  await put(request, "/api/comparisons", { activeId: c.id, items: [c] });
  return { data, observations, c };
}
async function group(
  request,
  observations,
  id = "shared",
  name = "Shared hill",
) {
  await put(request, "/api/hills", {
    groups: [{ id, name, observationIds: observations.map((o) => o.id) }],
    observations: [],
  });
}
async function reviewSelected(page) {
  const ids = await page
    .locator("[data-publish-entry]:checked")
    .evaluateAll((es) => es.map((e) => e.dataset.publishEntry));
  for (const id of ids) {
    await page.locator(`[data-hill-align="${id}"]`).click();
    await expect(page.locator("#hill-align-confirm")).toBeEnabled();
    await page.locator("#hill-align-confirm").click();
  }
}
test.beforeEach(async ({ request }) => {
  await put(request, "/api/comparisons", { activeId: "", items: [] });
  await put(request, "/api/hills", { groups: [], observations: [] });
  expect((await request.post("/api/demo", { data: {} })).ok()).toBeTruthy();
});
test("Comparisons publishes vetted source snapshots with recoverable failures, escaped names and transactional backups", async ({
  page,
  request,
}) => {
  const { c } = await seed(request, 2, true),
    original = await (await request.get("/api/rides/demo-0")).json();
  await page.goto("/");
  await settled(page);
  await page.locator("#open-hill-publish").click();
  await expect(page.locator("#hill-publish-save")).toBeDisabled();
  await expect(page.locator("[data-publish-entry]")).toHaveCount(2);
  await page.locator("#hill-publish-name").fill("Home <hill>");
  await reviewSelected(page);
  await page.locator('[data-hill-align="e0"]').click();
  const hillStart = c.entries[0].start + 2;
  await page.locator("#hill-align-start").evaluate((e, v) => {
    e.value = v;
    e.dispatchEvent(new Event("input", { bubbles: true }));
  }, hillStart);
  await expect(page.locator("#hill-publish-save")).toBeDisabled();
  await expect(page.locator("#hill-align-confirm")).toBeEnabled();
  await page.locator("#hill-align-confirm").click();
  await page.route("**/api/hills", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 500,
          json: { error: "Simulated hill failure" },
        })
      : route.continue(),
  );
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText("Not saved");
  expect((await catalog(request)).library.groups).toEqual([]);
  await page.unroute("**/api/hills");
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Hill saved",
  );
  const saved = (await catalog(request)).library;
  expect(saved.observations[0].alignment).toEqual({
    version: 1,
    reviewed: true,
    sourceStart: c.entries[0].start,
    sourceEnd: c.entries[0].end,
  });
  expect(saved.observations).toHaveLength(2);
  expect(saved.observations.map((o) => [o.rideId, o.start, o.end])).toEqual(
    c.entries.map((e, i) => [e.rideId, i === 0 ? hillStart : e.start, e.end]),
  );
  await expect(page.locator("#hill-group-members input")).toHaveValue(
    "Home <hill>",
  );
  await expect(page.locator("#hill-group-members hill")).toHaveCount(0);
  await page.locator("#hill-publish-target").selectOption(saved.groups[0].id);
  await reviewSelected(page);
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Hill saved",
  );
  expect((await catalog(request)).library.observations).toHaveLength(2);
  expect((await active(request)).sections).toEqual(c.sections);
  expect(await (await request.get("/api/rides/demo-0")).json()).toEqual(
    original,
  );
  const backup = JSON.parse(
    gunzipSync(await (await request.get("/api/backup")).body()),
  );
  expect(backup.hillLibrary).toEqual(saved);
  const bad = structuredClone(backup);
  bad.hillLibrary.observations[0].end = 999999;
  expect((await request.post("/api/restore", { data: bad })).ok()).toBeFalsy();
  expect((await catalog(request)).library).toEqual(saved);
  await page.reload();
  await settled(page);
  await page.locator("#comparison-hill-editor > summary").click();
  await page.locator('[data-hill-align="e0"]').click();
  await expect(page.locator("#hill-align-start")).toHaveValue(
    String(hillStart),
  );
  await page.locator("#hill-group-management > summary").click();
  await page.locator('[data-hill-group-action="dissolve"]').click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Comparison sections are unchanged",
  );
  expect((await active(request)).sections).toEqual(c.sections);
  expect((await catalog(request)).library.groups).toEqual([]);
  expect(
    (await request.post("/api/restore", { data: backup })).ok(),
  ).toBeTruthy();
  expect((await catalog(request)).library).toEqual(saved);
});
test("extending a saved hill reviews only new passes and retains the draft after a connection failure", async ({
  page,
  request,
}) => {
  const { c } = await seed(request, 3, true),
    records = c.entries.slice(0, 2).map((e, i) => ({
      id: `saved-${e.id}`,
      rideId: e.rideId,
      start: e.start,
      end: e.end,
      name: c.sections[i].name,
      alignment: {
        version: 1,
        reviewed: true,
        sourceStart: e.start,
        sourceEnd: e.end,
      },
    })),
    library = {
      groups: [
        {
          id: "existing",
          name: "Existing hill",
          observationIds: records.map((o) => o.id),
        },
      ],
      observations: records,
    };
  await put(request, "/api/hills", library);
  await page.goto("/");
  await settled(page);
  await page.locator("#open-hill-publish").click();
  const reviews = page.locator("#hill-publish-review-count");
  await expect(reviews).toContainText("2 of 3 selected passes reviewed");
  await expect(page.locator('[data-hill-align="e0"]')).toHaveText(
    "✓ Reviewed — adjust",
  );
  await expect(page.locator('[data-hill-align="e1"]')).toHaveText(
    "✓ Reviewed — adjust",
  );
  await expect(page.locator("#hill-publish-save")).toBeDisabled();
  await page.locator('[data-publish-entry="e2"]').uncheck();
  await expect(reviews).toContainText("2 of 2 selected passes reviewed");
  await expect(page.locator("#hill-publish-save")).toBeEnabled();
  await page.locator("#hill-publish-all").click();
  await expect(reviews).toContainText("2 of 3 selected passes reviewed");
  // Changing the physical identity still requires a fresh review. Returning to
  // the saved identity restores its unchanged members' persisted approvals.
  await page.locator("#hill-publish-target").selectOption("");
  await expect(reviews).toContainText("0 of 3 selected passes reviewed");
  await expect(page.locator('[data-hill-membership="e0"]')).toContainText(
    "alignment review needed",
  );
  await page.locator("#hill-publish-target").selectOption("existing");
  await expect(reviews).toContainText("2 of 3 selected passes reviewed");
  await page.locator("#hill-publish-none").click();
  await expect(reviews).toContainText("Select at least one pass");
  await page.locator("#hill-publish-all").click();
  await expect(reviews).toContainText("2 of 3 selected passes reviewed");
  await page.locator('[data-hill-align="e2"]').click();
  await expect(page.locator("#hill-align-confirm")).toBeEnabled();
  await page.locator("#hill-align-confirm").click();
  await expect(reviews).toContainText("3 of 3 selected passes reviewed");
  await expect(page.locator('[data-hill-membership="e2"]')).toContainText(
    "Not yet in hill library · alignment reviewed · not saved yet",
  );
  await page.locator('[data-publish-entry="e0"]').uncheck();
  await page.locator('[data-publish-entry="e0"]').check();
  await expect(reviews).toContainText("3 of 3 selected passes reviewed");
  await page.route("**/api/hills", (route) =>
    route.request().method() === "PUT"
      ? route.abort("connectionrefused")
      : route.continue(),
  );
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Cannot reach Noboride’s local server",
  );
  await expect(page.locator("#hill-publish-status")).toContainText(
    "your draft and alignment reviews are retained",
  );
  await expect(page.locator("#hill-publish-save")).toBeEnabled();
  await expect(reviews).toContainText("3 of 3 selected passes reviewed");
  expect((await catalog(request)).library).toEqual(library);
  await page.unroute("**/api/hills");
  // A lost refresh response can follow a successful write. Keep the same draft
  // IDs so retrying confirms the save without adding another pass or hill.
  await page.route("**/api/hills", (route) =>
    route.request().method() === "GET"
      ? route.abort("connectionrefused")
      : route.continue(),
  );
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Save could not be confirmed",
  );
  expect((await catalog(request)).library.observations).toHaveLength(3);
  await expect(reviews).toContainText("3 of 3 selected passes reviewed");
  await page.unroute("**/api/hills");
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Hill saved",
  );
  const saved = (await catalog(request)).library;
  expect(saved.groups).toEqual([
    {
      ...library.groups[0],
      observationIds: ["saved-e0", "saved-e1", "saved-e2"],
    },
  ]);
  expect(saved.observations.slice(0, 2)).toEqual(records);
  expect(saved.observations).toHaveLength(3);
  expect((await active(request)).entries).toEqual(c.entries);
  expect((await active(request)).sections).toEqual(c.sections);
  await page.reload();
  await settled(page);
  await page.locator("#open-hill-publish").click();
  await expect(reviews).toContainText("3 of 3 selected passes reviewed");
});

test("reopened hill passes remember membership and separate crest edits update the existing hill only", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    window.resizeErrors = [];
    window.addEventListener("error", (e) => {
      if (e.message?.includes("ResizeObserver"))
        window.resizeErrors.push(e.message);
    });
  });
  const original = await (await request.get("/api/rides/demo-0")).json();
  const rides = [0, 1].map((run) => ({
    ...original,
    id: `crest-review-${run}`,
    name: `Crest recording ${run}`,
    points: Array.from({ length: 101 }, (_, i) => ({
      ...original.points[0],
      t: Date.UTC(2026, 9, 15 + run) + i * 2000,
      d: i * 10,
      lat: 45 + (i * 10) / 111195,
      lon: -72,
      ele:
        (run ? 120 : 100) +
        (i <= (run ? 65 : 60)
          ? i * 0.5
          : (run ? 65 : 60) * 0.5 - (i - (run ? 65 : 60)) * 0.2),
      speed: 5,
      hr: 100 + i,
    })),
  }));
  expect(
    (
      await request.post("/api/restore", {
        data: { schemaVersion: 1, rides, segments: [], settings: {} },
      })
    ).ok(),
  ).toBeTruthy();
  const records = rides.map((r, i) => ({
      id: `saved-crest-${i}`,
      rideId: r.id,
      start: 10,
      end: i === 0 ? 70.123456 : 70,
      name: "Shared crest",
      alignment: { version: 1, reviewed: true, sourceStart: 10, sourceEnd: 70 },
    })),
    library = {
      observations: records,
      groups: [
        {
          id: "crest-hill",
          name: "Shared crest",
          observationIds: records.map((o) => o.id),
        },
      ],
    };
  await put(request, "/api/hills", library);
  const c = {
    id: "copied-hill-context",
    name: "Shared crest passes",
    mode: "same-road",
    road: { rideId: rides[0].id, start: 10, end: 70 },
    roadEntryId: "copied-0",
    selected: rides.map((r) => r.id),
    baseline: "copied-0",
    settings: { ...DEFAULTS, riderMassKg: 80, bikeMassKg: 20, gradeWindow: 50 },
    metric: "minimumPower",
    entries: records.map((o, i) => ({
      id: `copied-${i}`,
      sectionId: `section-${i}`,
      rideId: o.rideId,
      start: i ? 10.5 : 10,
      end: i ? 69.5 : 70,
      kind: i ? "effort" : "source",
      relation: "same-road",
      hillObservationId: o.id,
      hillGroupId: "crest-hill",
    })),
    sections: records.map((o, i) => ({
      id: `section-${i}`,
      rideId: o.rideId,
      start: i ? 10.5 : 10,
      end: i ? 69.5 : 70,
      kind: "hill",
      name: "Shared crest",
    })),
  };
  const other = {
    ...structuredClone(c),
    id: "unaffected-crest",
    name: "Unaffected crest comparison",
  };
  await put(request, "/api/comparisons", { activeId: c.id, items: [c, other] });
  const before = await active(request),
    otherBefore = (await workspace(request)).items.find(
      (item) => item.id === other.id,
    ),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await settled(page);
  await expect(page.locator("#open-hill-publish")).toHaveText(
    "Edit saved hill",
  );
  await page.locator("#open-hill-publish").click();
  await expect(page.locator("#hill-publish-target")).toHaveValue("crest-hill");
  await expect(page.locator("#hill-publish-name-label")).toBeHidden();
  await expect(page.locator("#hill-publish-review-count")).toContainText(
    "2 of 2 selected passes reviewed",
  );
  await expect(page.locator('[data-hill-membership="copied-1"]')).toContainText(
    "In Shared crest · saved alignment",
  );
  await page.locator('[data-hill-align="copied-0"]').click();
  await expect(page.locator("#hill-align-end")).toHaveValue("70.123456");
  await page.locator("#hill-align-confirm").click();
  await page.locator('[data-hill-align="copied-1"]').click();
  // Saved hill bounds survive the different timing/GPS bounds in this comparison.
  await expect(page.locator("#hill-align-start")).toHaveValue("10");
  await expect(page.locator("#hill-align-end")).toHaveValue("70");
  await expect(page.locator("#hill-align-status")).toContainText(
    "GPS geometry check passed",
  );
  await expect(page.locator("#hill-align-status")).toContainText(
    "does not verify matching crests",
  );
  await expect(page.locator("#hill-align-end-context")).toContainText(
    "50 m after the nearby recorded high point",
  );
  await expect(page.locator("[data-hill-elevation]")).toHaveCount(2);
  await expect(page.locator("[data-hill-gradient]")).toHaveCount(2);
  expect(
    await page
      .locator('[data-hill-elevation="draft-copied-1"]')
      .getAttribute("d"),
  ).not.toEqual(
    await page
      .locator('[data-hill-elevation="draft-copied-0"]')
      .getAttribute("d"),
  );
  await page.locator("#hill-align-crest").click();
  await expect(page.locator("#hill-align-end")).toHaveValue("65");
  await expect(page.locator('[data-hill-membership="copied-1"]')).toContainText(
    "boundary changes need review",
  );
  await expect(page.locator("#hill-publish-save")).toBeDisabled();
  await expect(page.locator("#hill-publish-review-count")).toContainText(
    "1 of 2 selected passes reviewed",
  );
  await expect(page.locator("#hill-publish-save")).toHaveCSS(
    "cursor",
    "not-allowed",
  );
  await expect(page.locator("#hill-publish-review-count")).toContainText(
    "Use Review alignment and confirm each selected pass to enable Save",
  );
  await expect(page.locator("#hill-align-confirm")).toBeEnabled();
  await page.locator("#hill-align-confirm").click();
  let finishSave;
  const saving = new Promise((resolve) => {
    finishSave = resolve;
  });
  await page.route("**/api/hills", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await saving;
    await route.fulfill({ status: 500, json: { error: "Crest save failed" } });
  });
  await page.locator("#hill-publish-save").click();
  try {
    await expect(page.locator("#hill-publish-save")).toHaveText("Saving…");
    await expect(page.locator("#hill-publish-save")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("#hill-publish-save")).toHaveCSS(
      "cursor",
      "wait",
    );
  } finally {
    finishSave();
  }
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Crest save failed",
  );
  await expect(page.locator("#hill-publish-save")).toBeEnabled();
  await expect(page.locator("#hill-publish-save")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect((await catalog(request)).library).toEqual(library);
  await page.unroute("**/api/hills");
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Hill saved",
  );
  const updated = (await catalog(request)).library;
  expect(updated.groups).toEqual(library.groups);
  expect(updated.observations).toHaveLength(2);
  expect(updated.observations.find((o) => o.id === records[1].id).end).toBe(65);
  expect(
    updated.observations.find((o) => o.id === records[1].id).alignment,
  ).toEqual(records[1].alignment);
  expect((await active(request)).sections).toEqual(before.sections);
  expect((await active(request)).entries).toEqual(before.entries);
  const backup = JSON.parse(
    gunzipSync(await (await request.get("/api/backup")).body()),
  );
  expect(backup.hillLibrary).toEqual(updated);
  await page.reload();
  await settled(page);
  await page.locator("#open-hill-publish").click();
  await expect(page.locator("#hill-publish-target")).toHaveValue("crest-hill");
  await expect(page.locator("#hill-publish-review-count")).toContainText(
    "2 of 2 selected passes reviewed",
  );
  await page.locator('[data-hill-align="copied-1"]').click();
  await expect(page.locator("#hill-align-end")).toHaveValue("65");
  await page
    .locator("#hill-publish-alignment")
    .screenshot({ path: "test-results/hill-crest-review.png" });
  // Library saves remain independent; only this explicit action changes timing.
  const sourceBeforeApply = (
    await (await request.get("/api/rides/crest-review-1")).json()
  ).points;
  expect(
    await page
      .locator('[data-plot-line="copied-1"]')
      .evaluate((path) => path.getBBox().height),
  ).toBeGreaterThan(1);
  await expect(
    page.locator('[data-hill-comparison-range="copied-1"]'),
  ).toContainText("elapsed 1:58");
  await expect(
    page.locator('[data-hill-draft-range="copied-1"]'),
  ).toContainText("elapsed 1:50");
  await expect(page.locator("#hill-publish-apply")).toBeEnabled();
  // A merely open section editor must not block applying saved hill bounds.
  await page.locator('[data-entry-edit="copied-1"]').first().click();
  await page.locator("#climb-name").fill("Unsaved section name");
  await page.locator("#hill-publish-apply").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "unsaved section changes",
  );
  await expect(page.locator("#climb-name")).toHaveValue("Unsaved section name");
  await page.locator("#climb-name").fill("Shared crest");

  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { error: "Apply bounds failed" } })
      : route.continue(),
  );
  await page.locator("#hill-publish-apply").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Apply bounds failed",
  );
  expect((await active(request)).entries).toEqual(before.entries);
  await expect(
    page.locator('[data-analysis-entry="copied-1"] td').nth(1),
  ).toHaveText("1:58");
  await page.unroute("**/api/comparisons");
  await page.locator("#hill-publish-apply").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Hill bounds applied",
  );
  const applied = await active(request);
  expect(applied.entries.map((e) => e.id)).toEqual(
    before.entries.map((e) => e.id),
  );
  expect(applied.baseline).toBe(before.baseline);
  expect(applied.road).toEqual(before.road);
  expect(
    (await workspace(request)).items.find((item) => item.id === other.id),
  ).toEqual(otherBefore);
  const pass = applied.entries.find((e) => e.id === "copied-1");
  expect(pass.start).toBe(10);
  expect(pass.end).toBe(65);
  expect(pass.kind).toBe("effort");
  expect(applied.sections.find((s) => s.id === "section-1")).toMatchObject({
    start: 10,
    end: 65,
  });
  await expect(
    page.locator('[data-analysis-entry="copied-1"] td').nth(1),
  ).toHaveText("1:50");
  await expect(page.locator('[data-analysis-entry="copied-1"]')).toContainText(
    "0.34 mi",
  );
  await expect(
    page.locator('[data-analysis-entry="copied-1"] td').nth(5),
  ).toContainText("138");
  await expect(page.locator('[data-estimated-average="copied-1"]')).toHaveText(
    "245 W",
  );
  expect(
    await page
      .locator('[data-plot-line="copied-1"]')
      .evaluate((path) => path.getBBox().height),
  ).toBeLessThan(0.01);
  expect(
    (await (await request.get("/api/rides/crest-review-1")).json()).points,
  ).toEqual(sourceBeforeApply);
  await expect(
    page.locator('[data-windowed-average="copied-1"]'),
  ).toContainText("245 W");
  await expect(page.locator("#hill-apply-controls")).toBeHidden();
  expect((await catalog(request)).library).toEqual(updated);
  await page.reload();
  await settled(page);
  await expect(
    page.locator('[data-analysis-entry="copied-1"] td').nth(1),
  ).toHaveText("1:50");
  await expect(page.locator('[data-estimated-average="copied-1"]')).toHaveText(
    "245 W",
  );
  // Opening the real library handoff creates new entry IDs without losing this link.
  await page.locator("#hills-tab").click();
  await page.locator("#hill-summary-select").selectOption("crest-hill");
  await page.locator("#hill-summary-compare").click();
  await settled(page);
  const copied = await active(request);
  expect(copied.id).not.toBe(c.id);
  await page.locator("#open-hill-publish").click();
  await expect(page.locator("#hill-publish-target")).toHaveValue("crest-hill");
  const linked = copied.entries.find(
    (e) => e.hillObservationId === records[1].id,
  );
  await page.locator(`[data-hill-align="${linked.id}"]`).click();
  await expect(page.locator("#hill-align-end")).toHaveValue("65");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await expect
    .poll(async () =>
      Math.round(
        await page
          .locator("#hill-align-profile")
          .evaluate((svg) => svg.viewBox.baseVal.width),
      ),
    )
    .toBeGreaterThan(299);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#new-comparison").click();
  await settled(page);
  await expect(page.locator("#hill-publish-target")).toHaveValue("");
  await page.locator("#comparison-switch").selectOption(copied.id);
  await settled(page);
  await expect(page.locator("#hill-publish-target")).toHaveValue("crest-hill");
  await page.locator("#hill-publish-target").selectOption("");
  await expect(page.locator("#hill-publish-name-label")).toBeVisible();
  await expect(page.locator("#hill-publish-review-count")).toContainText(
    "0 of 2",
  );
  // Unknown elevation must stay unknown, even when GPS and remembered identity agree.
  await page.route("**/api/rides/crest-review-1", async (route) => {
    const r = await route.fetch(),
      v = await r.json();
    v.points[66].ele = null;
    await route.fulfill({ response: r, json: v });
  });
  await page.reload();
  await settled(page);
  await page.locator("#open-hill-publish").click();
  const current = await active(request),
    entry = current.entries.find((e) => e.rideId === "crest-review-1");
  await page.locator(`[data-hill-align="${entry.id}"]`).click();
  await expect(page.locator("#hill-align-crest")).toBeDisabled();
  await expect(page.locator("#hill-align-end-context")).toContainText(
    "missing elevation",
  );
  const d = await page
    .locator(`[data-hill-elevation="draft-${entry.id}"]`)
    .getAttribute("d");
  expect((d.match(/M/g) || []).length).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.resizeErrors)).toEqual([]);
  expect(errors).toEqual([]);
});

test("Hills calculation exclusions never omit passes from handoff; colours and missing channels remain inspectable", async ({
  page,
  request,
}) => {
  const { observations, c } = await seed(request, 3);
  await group(request, observations);
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4318")) external.push(r.url());
  });
  // Synthetic missing power in the browser's source data, without changing stored imports.
  await page.route("**/api/rides/demo-*", async (route) => {
    const r = await route.fetch(),
      v = await r.json();
    v.points.forEach((p) => (p.power = null));
    await route.fulfill({ response: r, json: v });
  });
  await page.goto("/");
  await settled(page);
  await page.locator("#comparison-hill-editor > summary").click();
  await page.locator("#hill-publish-target").selectOption("shared");
  await expect(page.locator("[data-hill-membership]")).toHaveText(
    Array(3).fill("In Shared hill · alignment review needed"),
  );
  await reviewSelected(page);
  await expect(page.locator("[data-hill-membership]")).toHaveText(
    Array(3).fill("In Shared hill · alignment reviewed · not saved yet"),
  );
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Hill saved",
  );
  expect(
    (await catalog(request)).library.groups[0].observationIds,
  ).toHaveLength(3);
  await expect(page.locator("[data-hill-membership]")).toHaveText(
    Array(3).fill("In Shared hill · saved alignment"),
  );
  await page.locator("#hills-tab").click();
  await expect(page.locator("#hill-summary-status")).toContainText(
    "3 of 3 included sections mapped",
  );
  await expect(
    page.locator("#hill-summary-profile [data-summary-fill]").first(),
  ).toBeVisible();
  await expect(page.locator('[data-feature-y-tick="hr"]')).toHaveCount(3);
  await expect(page.locator("#hill-summary-profile")).toContainText(
    "Mapped hill progress (%)",
  );
  await expect(
    page.locator("#hill-route-svg, #hill-open-passes, #hill-profile-reference"),
  ).toHaveCount(0);
  await expect(page.locator('[data-summary-row="power"]')).toHaveCount(0);
  const gradeColours = await page
    .locator("[data-summary-position]")
    .evaluateAll((es) => es.map((e) => e.getAttribute("stop-color")));
  expect(gradeColours.some((colour) => colour !== "#bec8d0")).toBeTruthy();
  await page.locator('[data-summary-toggle="hr"]').click();
  await expect(page.locator('[data-summary-row="hr"]')).toHaveCount(0);
  await expect(page.locator('[data-summary-toggle="hr"]')).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(
    await page
      .locator("[data-summary-position]")
      .evaluateAll((es) => es.map((e) => e.getAttribute("stop-color"))),
  ).toEqual(gradeColours);
  await page.locator('[data-summary-toggle="hr"]').click();
  await expect(page.locator('[data-summary-row="hr"]')).toHaveCount(1);
  expect(
    await page.locator("[data-summary-fill]").getAttribute("opacity"),
  ).toBe(".85");
  await page.locator("#hill-summary-axis").selectOption("distance");
  await expect(page.locator("#hill-summary-profile")).toContainText(
    "Mapped distance (mi)",
  );
  await page.locator("#hill-summary-recordings > summary").click();
  await page.locator("[data-summary-member]").first().uncheck();
  await expect(page.locator("#hill-summary-status")).toContainText(
    "2 of 2 included sections mapped",
  );
  expect(
    (await catalog(request)).library.groups[0].observationIds,
  ).toHaveLength(3);
  await page.reload();
  await settled(page);
  await page.locator("#hills-tab").click();
  await expect(page.locator("#hill-summary-recording-count")).toHaveText(
    "(2/3)",
  );
  await page.locator("#hill-summary-recordings > summary").click();
  await page.locator("#hill-summary-none").click();
  await expect(page.locator("#hill-summary-profile")).toContainText(
    "Include a recording",
  );
  await expect(page.locator("#hill-summary-compare")).toBeEnabled();
  await page.locator("#hill-summary-all").click();
  await expect(page.locator("#hill-summary-status")).toContainText("3 of 3");
  await page.locator("[data-summary-member]").first().uncheck();
  await expect(page.locator("#hill-summary-status")).toContainText("2 of 2");
  const old = await workspace(request);
  let writes = 0;
  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT" && ++writes === 2
      ? route.fulfill({
          status: 500,
          json: { error: "Simulated handoff failure" },
        })
      : route.continue(),
  );
  await page.locator("#hill-summary-compare").click();
  await expect(page.locator("#hill-summary-status")).toContainText(
    "Simulated handoff failure",
  );
  expect((await workspace(request)).activeId).toBe(old.activeId);
  await page.unroute("**/api/comparisons");
  await page.locator("#hill-summary-compare").click();
  await settled(page);
  await expect(page.locator("#comparisons-view")).toBeVisible();
  const created = await active(request);
  expect(created.entries).toHaveLength(3);
  expect(created.selected).toHaveLength(3);
  expect(created.mode).toBe("same-road");
  expect(
    (await workspace(request)).items.find((x) => x.id === c.id).sections,
  ).toEqual(c.sections);
  await expect(page.locator("#matches tbody tr")).toHaveCount(3);
  await expect(page.locator("#hill-guidance [data-hill-preview]")).toHaveCount(
    0,
  );
  await expect(page.locator("#hill-guidance")).toContainText(
    "All library passes are included",
  );
  await page.locator("#hills-tab").click();
  await page.screenshot({
    path: "test-results/hills-summary-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: "test-results/hills-summary-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("hill charts fit heart-rate axes and switch range, SD and box plots without changing membership", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/rides/demo-0")).json(),
    rides = [170, 172, 174, 176, 190].map((hr, run) => ({
      ...original,
      id: `distribution-${run}`,
      name: `Distribution ride ${run}`,
      points: Array.from({ length: 101 }, (_, i) => ({
        ...original.points[0],
        t: Date.UTC(2026, 9, 10 + run) + i * 2000,
        d: i * 10,
        lat: 45 + (i * 10) / 111195,
        lon: -72,
        ele: 100 + i,
        hr,
        speed: 5,
        cad: 80,
        power: null,
      })),
    })),
    observations = rides.flatMap((r) =>
      [0, 1].map((hill) => ({
        id: `saved-${r.id}-${hill}`,
        rideId: r.id,
        start: 10 + hill * 40,
        end: 50 + hill * 40,
        name: `Hill ${hill}`,
      })),
    ),
    library = {
      groups: [0, 1].map((hill) => ({
        id: `distribution-hill-${hill}`,
        name: `Distribution hill ${hill}`,
        observationIds: observations
          .filter((o) => o.name === `Hill ${hill}`)
          .map((o) => o.id),
      })),
      observations,
    };
  expect(
    (
      await request.post("/api/restore", {
        data: {
          schemaVersion: 1,
          rides,
          segments: [],
          settings: { riderMassKg: 80, bikeMassKg: 20 },
        },
      })
    ).ok(),
  ).toBeTruthy();
  await put(request, "/api/hills", library);
  await page.goto("/");
  await settled(page);
  await page.locator("#hills-tab").click();
  await expect(page.locator('[data-feature-y-tick="hr"]')).toHaveText([
    "165",
    "180",
    "195",
  ]);
  await page.locator("#hill-summary-spread").selectOption("sd");
  await expect(page.locator("#hill-summary-spread-description")).toContainText(
    "sample standard deviation of ride means",
  );
  await expect(page.locator('[data-spread-band="hr"]')).toHaveCount(160);
  const hover = async (id) => {
    await page.locator(id).scrollIntoViewIfNeeded();
    const box = await page.locator(id).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8);
  };
  await hover('#hill-summary-profile [data-summary-row="hr"]');
  await expect(page.locator("#hill-summary-value")).toContainText("SD 7.9 bpm");
  await page.locator("#hill-summary-spread").selectOption("box");
  await expect(page.locator('[data-spread-box="hr"]')).toHaveCount(20);
  await page.locator("#hill-summary-density").selectOption("40");
  await expect(page.locator('[data-spread-box="hr"]')).toHaveCount(40);
  await page.locator("#hill-summary-density").selectOption("80");
  await expect(page.locator('[data-spread-box="hr"]')).toHaveCount(80);
  const checkSpacing = async (selector, count) => {
    const xs = await page
      .locator(selector)
      .evaluateAll((es) =>
        es.map((e) => +e.getAttribute("x") + +e.getAttribute("width") / 2),
      );
    expect(xs).toHaveLength(count);
    const step = (xs.at(-1) - xs[0]) / (count - 1);
    expect(step).toBeGreaterThan(0);
    expect(
      xs.slice(1).every((x, i) => Math.abs(x - xs[i] - step) < 1e-7),
    ).toBeTruthy();
  };
  for (const count of [10, 20, 40, 80]) {
    await page.locator("#hill-summary-density").selectOption(String(count));
    await checkSpacing('[data-spread-box="hr"] rect', count);
    await checkSpacing('[data-spread-box="ele"] rect', count);
  }
  await page
    .locator("#hill-summary-profile")
    .screenshot({ path: "test-results/hr-summary-even-spacing.png" });
  await page.locator("#hill-summary-density").selectOption("10");
  await expect(page.locator('[data-spread-box="hr"]')).toHaveCount(10);
  await expect(
    page.locator('[data-spread-box="hr"] [data-spread-outlier]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-spread-box="hr"] [data-box-whisker]').first(),
  ).toHaveAttribute("d", /,589 V529 /);
  await expect(page.locator("#hill-summary-spread-description")).toContainText(
    "minimum and maximum of all included ride means",
  );
  await hover('#hill-summary-profile [data-summary-row="hr"]');
  await expect(page.locator("#hill-summary-value")).toContainText(
    "median 174.0 bpm · middle 50% 172.0–176.0 bpm",
  );
  await expect(page.locator("#hill-summary-value")).toContainText(
    "min–max 170.0–190.0 bpm",
  );
  const geometry = await page
    .locator('[data-spread-box="hr"] rect')
    .evaluateAll((es) =>
      es.map((e) => ({
        y: +e.getAttribute("y"),
        h: +e.getAttribute("height"),
      })),
    );
  expect(
    geometry.every((r) => r.h > 0 && r.y >= 514 && r.y + r.h <= 605),
  ).toBeTruthy();
  await page.locator("#hill-summary-axis").selectOption("distance");
  await expect(page.locator("#hill-summary-profile")).toContainText(
    "Mapped distance (mi)",
  );
  await page.locator("#hill-summary-recordings > summary").click();
  for (let i = 1; i < 5; i++)
    await page.locator("[data-summary-member]").nth(i).uncheck();
  await expect(page.locator("#hill-summary-recording-count")).toHaveText(
    "(1/5)",
  );
  await expect(page.locator('[data-spread-box="hr"]')).toHaveCount(0);
  await page.locator("#hill-summary-spread").selectOption("sd");
  await expect(page.locator('[data-spread-band="hr"]')).toHaveCount(0);
  await hover('#hill-summary-profile [data-summary-row="hr"]');
  await expect(page.locator("#hill-summary-value")).toContainText(
    "SD unavailable (needs 2 rides)",
  );
  await page.locator("#hill-summary-all").click();
  await expect(page.locator('[data-summary-row="power"]')).toHaveCount(0);
  await expect(page.locator('[data-spread-band="power"]')).toHaveCount(0);
  await page.locator("#hill-summary-spread").selectOption("box");
  await page
    .locator("#hill-summary-profile")
    .screenshot({ path: "test-results/hr-summary-box.png" });
  await page.locator("#hill-terrain-explorer > summary").click();
  await page.locator("#hill-select-shown").click();
  await page.locator("#hill-create-comparison").click();
  await expect(page.locator("#hill-cross-metric")).toHaveCount(0);
  const rowKeys = await page
    .locator("[data-cross-row]")
    .evaluateAll((rows) => rows.map((row) => row.dataset.crossRow));
  expect(rowKeys).toEqual([
    "ele",
    "grade",
    "speed",
    "hr",
    "cad",
    "minimumPower",
  ]);
  const layout = await page.locator("[data-cross-row]").evaluateAll((rows) =>
    rows.map((row) => {
      const b = row.getBBox();
      return { top: b.y, bottom: b.y + b.height };
    }),
  );
  expect(
    layout.slice(1).every((row, i) => row.top > layout[i].bottom),
  ).toBeTruthy();
  await hover('#hill-cross-profile [data-cross-row="minimumPower"]');
  await expect(page.locator("#hill-cross-value")).toContainText("490.3 W");
  await expect(page.locator("#hill-cross-power-note")).toContainText(
    "not measured crank power",
  );
  const expandedHeight = await page
    .locator("#hill-cross-profile")
    .evaluate((svg) => svg.viewBox.baseVal.height);
  await page.locator('[data-cross-toggle="cad"]').click();
  await expect(page.locator('[data-cross-row="cad"]')).toHaveCount(0);
  await expect(page.locator('[data-cross-toggle="cad"]')).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(
    await page
      .locator("#hill-cross-profile")
      .evaluate((svg) => svg.viewBox.baseVal.height),
  ).toBeLessThan(expandedHeight);
  await page.locator('[data-cross-toggle="cad"]').click();

  await page.locator("#settings-button").click();
  await page.locator("#units").selectOption("metric");
  await page.locator('[data-close="settings"]').click();
  await expect(page.locator('[data-cross-row="speed"]')).toContainText("km/h");
  await page.locator("#settings-button").click();
  await page.locator("#units").selectOption("imperial");
  await page.locator('[data-close="settings"]').click();
  await expect(page.locator('[data-cross-row="speed"]')).toContainText("mph");

  await expect(page.locator('[data-cross-y-tick="hr"]')).toHaveText([
    "165",
    "180",
    "195",
  ]);
  await page.locator("#hill-cross-spread").selectOption("sd");
  await expect(
    page.locator('#hill-cross-profile [data-spread-band="hr"]'),
  ).toHaveCount(320);
  await hover('#hill-cross-profile [data-cross-row="hr"]');
  await expect(page.locator("#hill-cross-value")).toContainText("SD 7.9 bpm");
  await page.locator("#hill-cross-spread").selectOption("box");
  await expect(
    page.locator('#hill-cross-profile [data-spread-box="hr"]'),
  ).toHaveCount(40);
  await page.locator("#hill-cross-density").selectOption("80");
  await expect(
    page.locator('#hill-cross-profile [data-spread-box="hr"]'),
  ).toHaveCount(160);
  for (const count of [10, 20, 40, 80]) {
    await page.locator("#hill-cross-density").selectOption(String(count));
    const boxes = page.locator('#hill-cross-profile [data-spread-box="hr"]');
    await expect(boxes).toHaveCount(count * 2);
    const first = await boxes.evaluateAll(
      (es, count) =>
        es
          .slice(0, count)
          .map((e) => +e.querySelector("rect").getAttribute("x")),
      count,
    );
    const step = (first.at(-1) - first[0]) / (count - 1);
    expect(
      first.slice(1).every((x, i) => Math.abs(x - first[i] - step) < 1e-7),
    ).toBeTruthy();
  }
  await page
    .locator("#hill-cross-profile")
    .screenshot({ path: "test-results/hr-cross-dense.png" });
  await page.locator("#hill-cross-density").selectOption("10");
  await expect(
    page.locator('#hill-cross-profile [data-spread-box="hr"]'),
  ).toHaveCount(20);
  await page.locator("#hill-cross-axis").selectOption("progress");
  await page
    .locator("#hill-cross-profile")
    .screenshot({ path: "test-results/hr-cross-box.png" });
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      page.locator('#hill-cross-profile [data-spread-box="hr"]'),
    ).toHaveCount(20);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  }
  expect((await catalog(request)).library).toEqual(library);
});

test("bulk selection compares named hills inline without creating or modifying a comparison", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    window.resizeErrors = [];
    window.addEventListener("error", (event) => {
      if (event.message?.includes("ResizeObserver"))
        window.resizeErrors.push(event.message);
    });
  });
  const { data } = await seed(request);
  const observations = ["demo-0", "demo-1"].flatMap((id) =>
    data.observations.filter((o) => o.rideId === id).slice(0, 2),
  );
  expect(observations).toHaveLength(4);
  await put(request, "/api/hills", {
    groups: [0, 1].map((i) => ({
      id: `g${i}`,
      name: `Hill ${i}`,
      observationIds: [observations[i].id, observations[i + 2].id],
    })),
    observations: [],
  });
  await page.goto("/");
  await settled(page);
  await page.locator("#hills-tab").click();
  await page.locator("#hill-terrain-explorer > summary").click();
  await expect(page.locator("[data-hill-point]")).toHaveCount(2);
  await page.locator("#hill-select-shown").click();
  await expect(
    page.locator('[data-hill-point][aria-pressed="true"]'),
  ).toHaveCount(2);
  await page.locator("#hill-ride-filter").selectOption("demo-0");
  await page.locator("#hill-clear-shown").click();
  await expect(page.locator("#hill-plot-selection")).toContainText(
    "0 selected",
  );
  await page.locator("#hill-clear-all").click();
  await page.locator("#hill-ride-filter").selectOption("");
  await page.locator("#hill-identity-filter").selectOption("g0");
  await expect(page.locator("[data-hill-point]")).toHaveCount(1);
  await page.locator("#hill-identity-filter").selectOption("");
  const brush = async (mode) => {
    await page.locator("#hill-brush-mode").selectOption(mode);
    await page.locator("#hill-scatter-svg").scrollIntoViewIfNeeded();
    const box = await page.locator("#hill-scatter-svg").boundingBox();
    await page.mouse.move(box.x + 45, box.y + 25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height - 35, {
      steps: 8,
    });
    await page.mouse.up();
  };
  await brush("replace");
  await expect(page.locator("#hill-plot-selection")).toContainText(
    "2 selected hills",
  );
  await brush("remove");
  await expect(page.locator("#hill-plot-selection")).toContainText(
    "0 selected",
  );
  await page.locator("[data-hill-point]").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#hill-plot-selection")).toContainText(
    "1 selected",
  );
  await brush("add");
  await expect(page.locator("#hill-plot-selection")).toContainText(
    "2 selected hills",
  );
  await expect(page.locator("[data-hill-range]")).toHaveCount(2);
  const before = await workspace(request);
  await page.locator("#hill-create-comparison").click();
  await expect(page.locator("#hills-view")).toBeVisible();
  await expect(page.locator("#hill-cross-status")).toContainText(
    "2 named hills",
  );
  await expect(page.locator('[data-cross-lane="ele"]')).toHaveCount(2);
  await expect(page.locator("#hill-cross-legend")).toContainText("Hill 0");
  await expect(page.locator("#hill-cross-legend")).toContainText("Hill 1");
  expect(await workspace(request)).toEqual(before);
  await expect(page.locator('[data-cross-lane="hr"]')).toHaveCount(2);
  await page.locator("#hill-cross-axis").selectOption("progress");
  await expect(page.locator("#hill-cross-profile")).toContainText(
    "Relative progress through each mapped hill",
  );
  for (const width of [1440, 800, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();

    await page.locator("#hill-cross-profile").scrollIntoViewIfNeeded();
    const box = await page.locator("#hill-cross-profile").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  }
  expect(await page.evaluate(() => window.resizeErrors)).toEqual([]);
  await page.screenshot({
    path: "test-results/different-hills-inline.png",
    fullPage: true,
  });
});
test("independent legacy effort comparisons retain raw elapsed differences and survive hover and resizing", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    window.resizeErrors = [];
    window.addEventListener("error", (e) => {
      if (e.message?.includes("ResizeObserver"))
        window.resizeErrors.push(e.message);
    });
  });
  const { c } = await seed(request);
  c.mode = "terrain";
  c.road = null;
  delete c.roadEntryId;
  c.entries = c.entries.map((e) => ({
    ...e,
    kind: "effort",
    relation: "similar-terrain",
  }));
  await put(request, "/api/comparisons", { activeId: c.id, items: [c] });
  await page.goto("/");
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  await expect(page.locator("#budget-panel")).toBeHidden();
  await expect(page.locator("#matches thead")).not.toContainText("Δ baseline");
  await expect(page.locator("#matches thead")).toContainText("Δ elapsed");
  await expect(page.locator("#baseline-description")).toContainText(
    "independent lengths and boundaries",
  );
  await expect(page.locator('#metric option[value="delta"]')).toHaveJSProperty(
    "disabled",
    true,
  );
  await page.locator("#metric").selectOption("speed");
  await expect(page.locator("#comparison-chart svg path")).toHaveCount(2);
  const saved = await active(request);
  expect(saved.mode).toBe("terrain");
  expect(saved.road).toBeNull();
  expect(saved.sections).toHaveLength(2);
  const baseRide = await (
    await request.get(`/api/rides/${saved.entries[0].rideId}`)
  ).json();
  const otherRide = await (
    await request.get(`/api/rides/${saved.entries[1].rideId}`)
  ).json();
  const elapsed = (ride, entry) =>
    (ride.points[entry.end].t - ride.points[entry.start].t) / 1000;
  const expectedDelta = Math.round(
    elapsed(otherRide, saved.entries[1]) - elapsed(baseRide, saved.entries[0]),
  );
  await expect(
    page.locator("#matches tbody tr").nth(1).locator("td").nth(2),
  ).toContainText(
    `${expectedDelta < 0 ? "−" : "+"}${Math.floor(Math.abs(expectedDelta) / 60)}:${String(Math.abs(expectedDelta) % 60).padStart(2, "0")}`,
  );
  const path = await page
    .locator("#comparison-chart svg path")
    .first()
    .getAttribute("d");
  expect((path.match(/[ML]/g) || []).length).toBe(
    saved.entries[0].end - saved.entries[0].start + 1,
  );
  for (const [axis, text] of [
    ["distance", "Distance from section start"],
    ["elapsed", "Elapsed time from section start"],
    ["ascent", "Accumulated positive elevation"],
  ]) {
    await page.locator("#effort-axis").selectOption(axis);
    await expect(
      page.locator("#comparison-chart .chart-caption"),
    ).toContainText(text);
  }
  await expect.poll(async () => (await active(request)).axis).toBe("ascent");
  await page.locator("#metric").selectOption("hr");
  const hrTicks = await page
    .locator('#comparison-chart svg text[text-anchor="end"]')
    .allTextContents();
  expect(Math.min(...hrTicks.map(Number))).toBeGreaterThan(100);
  await page.locator("#metric").selectOption("speed");
  await page.reload();
  await settled(page);
  await expect(page.locator("#effort-axis")).toHaveValue("ascent");
  for (const width of [1440, 1100, 800, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator("#comparison-chart svg").scrollIntoViewIfNeeded();
    const box = await page.locator("#comparison-chart svg").boundingBox();
    for (const f of [0.1, 0.3, 0.7, 0.9])
      await page.mouse.move(box.x + box.width * f, box.y + box.height * 0.5);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  }
  expect(await page.evaluate(() => window.resizeErrors)).toEqual([]);
  await expect(page.locator("#messages")).not.toContainText("ResizeObserver");
});
test("a hill identity never silently verifies a remote track when opening all passes", async ({
  page,
  request,
}) => {
  const source = await (await request.get("/api/rides/demo-0")).json(),
    far = {
      ...source,
      id: "far-hill",
      name: "Far road",
      points: source.points.map((p) => ({ ...p, lon: p.lon + 0.02 })),
    };
  expect(
    (
      await request.post("/api/restore", {
        data: { schemaVersion: 1, rides: [far], segments: [], settings: {} },
      })
    ).ok(),
  ).toBeTruthy();
  const data = await catalog(request),
    observations = ["demo-0", "far-hill"].map((id) =>
      data.observations.find((o) => o.rideId === id),
    );
  await group(request, observations, "mistake", "Mistaken identity");
  await page.goto("/");
  await settled(page);
  await page.locator("#hills-tab").click();
  await expect(page.locator("#hill-summary-status")).toContainText(
    "some sections need review",
  );
  await page.locator("#hill-summary-compare").click();
  await settled(page);
  const c = await active(request);
  expect(c.entries).toHaveLength(2);
  expect(c.entries.every((e) => !e.review)).toBeTruthy();
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await expect(page.locator("#comparison-availability-text")).toContainText(
    "could not be verified",
  );
  await expect(page.locator("#budget-panel")).toBeHidden();
  expect(
    (await (await request.get("/api/rides/far-hill")).json()).points,
  ).toEqual(far.points);
});
test("per-pass hill review blocks incompatible roads and supports adding just one section", async ({
  page,
  request,
}) => {
  const { c } = await seed(request),
    source = await (await request.get("/api/rides/demo-1")).json(),
    far = {
      ...source,
      id: "far-publish",
      name: "Separate road",
      points: source.points.map((p) => ({ ...p, lon: p.lon + 0.02 })),
    };
  expect(
    (
      await request.post("/api/restore", {
        data: { schemaVersion: 1, rides: [far], segments: [], settings: {} },
      })
    ).ok(),
  ).toBeTruthy();
  c.entries[1].rideId = far.id;
  c.sections[1].rideId = far.id;
  c.selected = ["demo-0", far.id];
  await put(request, "/api/comparisons", { activeId: c.id, items: [c] });
  await page.goto("/");
  await settled(page);
  await page.locator("#open-hill-publish").click();
  await page.locator("#hill-publish-name").fill("One reviewed hill");
  await page.locator('[data-hill-align="e1"]').click();
  await expect(page.locator("#hill-align-status")).toContainText(
    "cannot all be mapped",
  );
  await expect(page.locator("#hill-align-confirm")).toBeDisabled();
  await expect(page.locator("#hill-publish-save")).toBeDisabled();
  expect((await catalog(request)).library.groups).toEqual([]);
  await page.locator("#hill-publish-none").click();
  await page.locator('[data-publish-entry="e0"]').check();
  await page.locator('[data-hill-align="e0"]').click();
  await expect(page.locator("#hill-align-confirm")).toBeEnabled();
  const size = await page
    .locator("#hill-align-map path")
    .first()
    .evaluate((p) => ({
      width: p.getBBox().width,
      height: p.getBBox().height,
    }));
  expect(Math.max(size.width, size.height)).toBeGreaterThan(100);
  await page
    .locator("#hill-publish-alignment")
    .screenshot({ path: "test-results/hill-alignment-review.png" });
  await page.locator("#hill-align-confirm").click();
  await page.locator("#hill-publish-save").click();
  await expect(page.locator("#hill-publish-status")).toContainText(
    "Hill saved",
  );
  expect(
    (await catalog(request)).library.groups[0].observationIds,
  ).toHaveLength(1);
  expect((await active(request)).sections).toEqual(c.sections);
  await page.locator("#hill-publish-all").click();
  await expect(page.locator("#hill-publish-save")).toBeDisabled();
  await page.locator('[data-hill-align="e1"]').click();
  await expect(page.locator("#hill-align-confirm")).toBeDisabled();
});
test("removing road owners supports both redefinition orders and rolls back failed removals", async ({
  page,
  request,
}) => {
  const { c } = await seed(request);
  const extra = {
    id: "new-road",
    rideId: "demo-0",
    start: 420,
    end: 540,
    kind: "effort",
    relation: "similar-terrain",
  };
  c.entries.push(extra);
  c.matchDecisions = [
    {
      rideId: "demo-2",
      start: 190,
      end: 280,
      decision: "rejected",
      reason: "Old road only",
    },
  ];
  await put(request, "/api/comparisons", { activeId: c.id, items: [c] });
  await page.goto("/");
  await settled(page);
  await page.locator('[data-entry-remove="e0"]').click();
  await settled(page);
  let current = await active(request);
  expect(current.road).toBeNull();
  expect(current.roadPending).toBe(true);
  expect(current.matchDecisions).toEqual([]);
  await expect(page.locator("#comparison-availability-text")).toContainText(
    "comparison road",
  );
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  const pending = await active(request);
  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { error: "Road save failed" } })
      : route.continue(),
  );
  await page.locator('[data-entry-road="new-road"]').click();
  await settled(page);
  expect(await active(request)).toEqual(pending);
  await page.unroute("**/api/comparisons");
  await page.locator('[data-entry-road="new-road"]').click();
  await settled(page);
  expect((await active(request)).road).toEqual({
    rideId: "demo-0",
    start: 420,
    end: 540,
  });
  // A failed owner removal must restore the whole prior definition.
  const before = await active(request);
  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { error: "Removal failed" } })
      : route.continue(),
  );
  await page.locator('[data-entry-remove="new-road"]').click();
  await settled(page);
  expect((await active(request)).road).toEqual(before.road);
  await expect(page.locator('[data-entry-remove="new-road"]')).toBeVisible();
  await page.unroute("**/api/comparisons");
  await page.locator('[data-entry-remove="e1"]').click();
  await settled(page);
  await page.locator('[data-entry-remove="new-road"]').click();
  await settled(page);
  expect((await active(request)).road).toBeNull();
  // Delete old first, then add a different source stretch.
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  for (const [id, value] of [
    ["end-range", 540],
    ["start-range", 420],
  ])
    await page.locator(`#${id}`).evaluate((e, v) => {
      e.value = v;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await page.locator("#add-stretch").click();
  await settled(page);
  current = await active(request);
  expect(current.entries).toHaveLength(1);
  expect(current.road).toEqual({ rideId: "demo-0", start: 420, end: 540 });
  expect(current.roadEntryId).toBe(current.entries[0].id);
  await page.reload();
  await settled(page);
  expect((await active(request)).road).toEqual(current.road);
  // Add different first, then remove all original owners: the sole survivor becomes the road.
  await put(request, "/api/comparisons", { activeId: c.id, items: [c] });
  await page.reload();
  await settled(page);
  await page.locator('[data-entry-remove="e0"]').click();
  await settled(page);
  await page.locator('[data-entry-remove="e1"]').click();
  await settled(page);
  expect((await active(request)).roadEntryId).toBe("new-road");
  expect((await active(request)).road).toEqual({
    rideId: "demo-0",
    start: 420,
    end: 540,
  });
});

test("View summary selects the named hill graphic, while one plot point represents all its passes", async ({
  page,
  request,
}) => {
  const { c, data, observations } = await seed(request);
  const other = data.observations.filter((o) => o.rideId === "demo-0")[1];
  await put(request, "/api/hills", {
    groups: [
      { id: "other", name: "Other hill", observationIds: [other.id] },
      {
        id: "shared",
        name: "Shared hill",
        observationIds: observations.map((o) => o.id),
      },
    ],
    observations: [],
  });
  await page.goto("/");
  await settled(page);
  await page.locator("[data-open-hills]").click();
  await expect(page.locator("#hill-summary-select")).toHaveValue("shared");
  await expect(page.locator("#hill-summary-profile")).toBeInViewport();
  await expect(page.locator("#hill-terrain-explorer")).not.toHaveAttribute(
    "open",
  );
  await page.locator("#hill-terrain-explorer > summary").click();
  await expect(page.locator("[data-hill-point]")).toHaveCount(2);
  await page.locator('[data-hill-point="shared"]').focus();
  await page.keyboard.press("Enter");
  await page.locator("#hill-create-comparison").click();
  await expect(page.locator("#hill-summary-select")).toHaveValue("shared");
  expect((await workspace(request)).items).toHaveLength(1);
  // An unnamed populated comparison still blocks opening a new pass comparison explicitly.
  c.name = "";
  await put(request, "/api/comparisons", { activeId: c.id, items: [c] });
  await page.reload();
  await settled(page);
  await page.locator("#hills-tab").click();
  await page.locator("#hill-summary-select").selectOption("shared");
  await page.locator("#hill-summary-compare").click();
  await expect(page.locator("#hill-summary-status")).toContainText(
    "Name your current comparison",
  );
});

test("grade-coloured elevation overview follows shared range, axes and cursor while leaving recording gaps blank", async ({
  page,
  request,
}) => {
  const source = await (await request.get("/api/rides/demo-0")).json();
  const broken = {
    ...source,
    id: "overview-gaps",
    name: "Overview with gaps",
    points: source.points.map((p, i) => ({
      ...p,
      ele: i === 300 ? null : p.ele,
      ...(i === 350 ? { breakBefore: true } : {}),
    })),
  };
  expect(
    (
      await request.post("/api/restore", {
        data: { schemaVersion: 1, rides: [broken], segments: [], settings: {} },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await settled(page);
  if (!(await page.locator('[data-source-ride="overview-gaps"]').count())) {
    await page.locator('[data-include="overview-gaps"]').check();
    await settled(page);
  }
  await page.locator('[data-source-ride="overview-gaps"]').click();
  await settled(page);
  await expect(page.locator("#story-full")).toBeChecked();
  await expect(page.locator("[data-grade-zero]")).toHaveCount(1);
  await expect(
    page.locator('#story-charts [data-story-lane="ele"]'),
  ).toHaveCount(0);
  const layout = await page
    .locator("#ride-browser")
    .evaluate((panel) =>
      Object.fromEntries(
        [
          ".section-title",
          ".studio-controls",
          "#source-stretches",
          ".studio-grid",
          ".profile-column",
          "#story-charts",
          "#story-overview",
          ".selection-actions",
        ].map((selector) => [
          selector,
          Math.round(
            panel.querySelector(selector).getBoundingClientRect().height,
          ),
        ]),
      ),
    );
  expect((await page.locator("#map").boundingBox()).height).toBeLessThanOrEqual(
    220,
  );
  expect(
    (await page.locator("#ride-browser").boundingBox()).height,
    JSON.stringify(layout),
  ).toBeLessThan(950);
  await expect(page.locator("#story-overview [data-grade-band]")).toHaveCount(
    597,
  );
  expect(
    await page
      .locator(
        '#story-overview [data-grade-band="9"], #story-overview [data-grade-band="12"]',
      )
      .count(),
  ).toBeGreaterThan(0);
  await expect(page.locator("#story-cursor")).toBeHidden();
  await page.locator(".story-traces").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#overview-value")).toContainText("%");
  const cursor = await page
    .locator("[data-overview-cursor]")
    .getAttribute("x1");
  expect(Number(cursor)).toBeCloseTo(
    Number(await page.locator("[data-story-cursor]").getAttribute("x1")),
    4,
  );
  for (const [id, value] of [
    ["start-range", 420],
    ["end-range", 540],
  ]) {
    await page.locator(`#${id}`).evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }
  const boundary = await page
    .locator('[data-overview-boundary="start"]')
    .getAttribute("x1");
  expect(Number(boundary)).toBeCloseTo(
    Number(
      await page
        .locator('.story-traces [data-boundary="start"]')
        .getAttribute("x1"),
    ),
    4,
  );
  await page.locator("#story-axis").selectOption("t");
  await expect(page.locator("#start-range")).toHaveValue("420");
  await page.locator("#story-full").uncheck();
  expect(
    Number(await page.locator("#story-cursor").getAttribute("min")),
  ).toBeGreaterThan(300);
  await page.locator("#grade-window").fill("30");
  await page.locator("#grade-window").dispatchEvent("input");
  await expect(page.locator("#story-overview .overview-legend")).toContainText(
    "30 m grade window",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page
    .locator("#story-overview")
    .screenshot({ path: "test-results/grade-overview-mobile.png" });
});
