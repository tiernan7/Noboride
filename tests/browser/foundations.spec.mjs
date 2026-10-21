import { test, expect } from "@playwright/test";
import { gunzipSync } from "node:zlib";

const settled = (page) =>
  expect(page.locator("body")).not.toHaveClass(/working/);
const comparison = async (request) =>
  (await (await request.get("/api/workspace")).json()).comparisons.items[0];
const range = async (page, start, end) => {
  for (const [id, value] of [
    ["start-range", start],
    ["end-range", end],
  ])
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
};
test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: "", items: [] },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await request.post("/api/demo", { data: {} })).ok()).toBeTruthy();
  expect(
    (
      await request.patch("/api/rides/demo-0", { data: { climbEdits: [] } })
    ).ok(),
  ).toBeTruthy();
});

test("ride story shares a recorded cursor across six lanes and preserves corrected hill boundaries in backups", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/rides/demo-0")).json();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await settled(page);
  if (!(await page.locator('[data-source-ride="demo-0"]').count())) {
    await page.locator('input[data-include="demo-0"]').check();
    await settled(page);
  }
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await expect(page.locator("[data-story-lane]")).toHaveCount(6);
  const hill = page.locator('[data-climb^="hill-"]').first();
  const hillId = await hill.getAttribute("data-climb");
  await hill.click();
  await settled(page);
  const start = Number(await page.locator("#start-range").inputValue()),
    end = Number(await page.locator("#end-range").inputValue());
  expect(
    Number(await page.locator("#story-cursor").getAttribute("min")),
  ).toBeLessThan(start);
  expect(
    Number(await page.locator("#story-cursor").getAttribute("max")),
  ).toBeGreaterThan(end);
  await page.locator("#story-cursor").evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, start + 10);
  await expect(page.locator('[data-story-value="hr"]')).toHaveText(
    `${original.points[start + 10].hr.toFixed(0)} bpm`,
  );
  await expect(page.locator("#story-position")).toContainText(
    `recorded sample ${start + 11}`,
  );
  expect(
    Number(await page.locator("[data-story-cursor]").getAttribute("x1")),
  ).toBeGreaterThan(80);
  await expect(page.locator('#map path[stroke="#172b42"]')).toHaveCount(1);
  await page.locator("#story-axis").selectOption("t");
  await expect(page.locator("#start-range")).toHaveValue(String(start));
  await page.locator("#story-full").check();
  await expect(page.locator("#story-cursor")).toHaveAttribute("min", "0");
  await expect(page.locator("#story-cursor")).toHaveAttribute("max", "600");
  await page.locator("#climb-name").fill("Corrected hill <one>");
  for (const [id, value] of [
    ["start-range", start + 2],
    ["end-range", end - 2],
  ])
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await page.locator("#add-stretch").click();
  await settled(page);
  const after = await (await request.get("/api/rides/demo-0")).json();
  expect(after.points).toEqual(original.points);
  expect(after.notes).toEqual(original.notes);
  expect(after.source).toBe(original.source);
  expect(after.climbEdits).toEqual(original.climbEdits);
  const savedSections = (await comparison(request)).sections;
  expect(savedSections).toEqual([
    {
      id: hillId,
      rideId: "demo-0",
      kind: "hill",
      name: "Corrected hill <one>",
      start: start + 2,
      end: end - 2,
    },
  ]);
  expect(
    (
      await request.patch("/api/rides/demo-0", {
        data: {
          name: "Must not be saved",
          climbEdits: [{ ...after.climbEdits[0], start: -1 }],
        },
      })
    ).status(),
  ).toBe(400);
  expect((await (await request.get("/api/rides/demo-0")).json()).name).toBe(
    original.name,
  );
  const backupResponse = await request.get("/api/backup"),
    backupBytes = await backupResponse.body();
  const backup = JSON.parse(gunzipSync(backupBytes));
  expect(backup.rides.find((r) => r.id === "demo-0").climbEdits).toEqual(
    after.climbEdits,
  );
  expect(backup.comparisons.items[0].sections).toEqual(savedSections);
  await page.reload();
  await settled(page);
  await expect(page.locator(`[data-climb="${hillId}"]`)).toContainText(
    "Corrected hill <one>",
  );
  await page.locator(`[data-climb="${hillId}"]`).click();
  await expect(page.locator("#start-range")).toHaveValue(String(start + 2));
  await page.locator("#climb-reset").click();
  await settled(page);
  expect(
    (await (await request.get("/api/rides/demo-0")).json()).climbEdits,
  ).toEqual([]);
  await expect(page.locator("#start-range")).toHaveValue(String(start));
  // Restore both the scoped comparison and a missing fixture ride.
  await request.put("/api/comparisons", { data: { activeId: "", items: [] } });
  expect(
    (await request.delete("/api/rides/demo-0", { data: {} })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post("/api/restore", {
        data: backupBytes,
        headers: { "Content-Type": "application/octet-stream" },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await comparison(request)).sections).toEqual(savedSections);
  expect(
    (await (await request.get("/api/rides/demo-0")).json()).climbEdits,
  ).toEqual(original.climbEdits);
  await page.reload();
  await settled(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page
    .locator("#ride-story")
    .screenshot({ path: "artifacts/ride-story-mobile.png" });
  expect(errors).toEqual([]);
});

test("manual sections nest with detected terrain, survive reload and backups, and can be edited or deleted", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/rides/demo-0")).json();
  await page.goto("/");
  await settled(page);
  if (!(await page.locator('[data-source-ride="demo-0"]').count())) {
    await page.locator('input[data-include="demo-0"]').check();
    await settled(page);
  }
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  const hill = page.locator('[data-climb^="hill-"]').first();
  const hillId = await hill.getAttribute("data-climb");
  await hill.click();
  const start = Number(await page.locator("#start-range").inputValue());
  const end = Number(await page.locator("#end-range").inputValue());
  const bounds = async (a, b) => {
    for (const [id, value] of [
      ["start-range", a],
      ["end-range", b],
    ])
      await page.locator(`#${id}`).evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
  };
  await page.locator("#climb-new").click();
  await page.locator("#climb-name").fill("Discard me");
  await page.locator("#climb-cancel").click();
  await expect(page.locator("#climb-editor")).toBeHidden();
  expect(
    (await (await request.get("/api/rides/demo-0")).json()).climbEdits,
  ).toEqual([]);
  await page.locator("#climb-new").click();
  await page.locator("#climb-kind").selectOption("passage");
  await page.locator("#climb-name").fill("");
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#stretch-status")).toContainText(
    "Give the section a name",
  );
  await page.locator("#climb-name").fill("My passage <local>");
  await bounds(start - 2, end + 2);
  await page.route("**/api/comparisons", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 500,
        json: { error: "Test save failure" },
      });
    else await route.continue();
  });
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#stretch-status")).toContainText(
    "Test save failure",
  );
  await expect(page.locator('[data-climb^="manual-"]')).toHaveCount(0);
  await expect(page.locator("#climb-name")).toHaveValue("My passage <local>");
  await page.unroute("**/api/comparisons");
  await page.locator("#add-stretch").click();
  await settled(page);
  const passage = page
    .locator('[data-climb^="manual-"]')
    .filter({ hasText: "My passage <local>" });
  const passageId = await passage.getAttribute("data-climb");
  await expect(
    page
      .locator(`[data-climb="${hillId}"]`)
      .locator("xpath=ancestor::li[2]/button[@data-climb]"),
  ).toHaveAttribute("data-climb", passageId);
  await expect(passage).toContainText("Included");
  await expect(page.locator("#climb-reset")).toBeHidden();
  await page.locator("#climb-new").click();
  await page.locator("#climb-kind").selectOption("ramp");
  await page.locator("#climb-name").fill("My ramp");
  await bounds(start + 2, end - 2);
  await expect(page.locator("#climb-kind")).toHaveValue("ramp");
  await page.locator("#add-stretch").click();
  await settled(page);
  const ramp = page
    .locator('[data-climb^="manual-"]')
    .filter({ hasText: "My ramp" });
  const rampId = await ramp.getAttribute("data-climb");
  await expect(
    ramp.locator("xpath=ancestor::li[2]/button[@data-climb]"),
  ).toHaveAttribute("data-climb", hillId);
  let saved = await (await request.get("/api/rides/demo-0")).json();
  const savedSections = (await comparison(request)).sections;
  expect(savedSections).toEqual([
    {
      id: passageId,
      rideId: "demo-0",
      kind: "passage",
      name: "My passage <local>",
      start: start - 2,
      end: end + 2,
      manual: true,
    },
    {
      id: rampId,
      rideId: "demo-0",
      kind: "ramp",
      name: "My ramp",
      start: start + 2,
      end: end - 2,
      manual: true,
    },
  ]);
  expect(saved.points).toEqual(original.points);
  expect(saved.source).toEqual(original.source);
  expect(saved.notes).toEqual(original.notes);
  const backupBytes = await (await request.get("/api/backup")).body();
  expect(
    JSON.parse(gunzipSync(backupBytes)).comparisons.items[0].sections,
  ).toEqual(savedSections);
  expect((await comparison(request)).entries).toHaveLength(2);
  await page.reload();
  await settled(page);
  await ramp.click();
  await expect(page.locator("#climb-kind")).toHaveValue("ramp");
  await page.locator("#climb-name").fill("Trimmed ramp");
  await bounds(start + 3, end - 3);
  await page.locator("#add-stretch").click();
  await settled(page);
  saved = await (await request.get("/api/rides/demo-0")).json();
  expect(
    (await comparison(request)).sections.find(
      (section) => section.id === rampId,
    ),
  ).toMatchObject({
    id: rampId,
    name: "Trimmed ramp",
    start: start + 3,
    end: end - 3,
    manual: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page
    .locator("#climb-editor")
    .screenshot({ path: "artifacts/manual-section-mobile.png" });
  await page.locator("#climb-delete").click();
  await settled(page);
  await expect(page.locator(`[data-climb="${rampId}"]`)).toHaveCount(0);
  await passage.click();
  await page.locator("#climb-delete").click();
  await settled(page);
  await expect(page.locator(`[data-climb="${hillId}"]`)).toBeVisible();
  expect(
    (await (await request.get("/api/rides/demo-0")).json()).climbEdits,
  ).toEqual([]);
  expect(
    (await request.delete("/api/rides/demo-0", { data: {} })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post("/api/restore", {
        data: backupBytes,
        headers: { "Content-Type": "application/octet-stream" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await settled(page);
  await expect(page.locator(`[data-climb="${passageId}"]`)).toContainText(
    "My passage <local>",
  );
  await expect(page.locator(`[data-climb="${rampId}"]`)).toContainText(
    "My ramp",
  );
});

test("one ride browser shares brush, map, terrain and comparison selections without mixing saved edits", async ({
  page,
  request,
}) => {
  const ride = await (await request.get("/api/rides/demo-0")).json();
  const workspace = async () =>
    (await (await request.get("/api/workspace")).json()).comparisons.items[0];
  await page.goto("/");
  await settled(page);
  if (!(await page.locator('[data-source-ride="demo-0"]').count())) {
    await page.locator('input[data-include="demo-0"]').check();
    await settled(page);
  }
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await expect(page.locator("#ride-browser .leaflet-container")).toHaveCount(1);
  await expect(
    page.locator("#profile, #story-map, #climb-start, #climb-end"),
  ).toHaveCount(0);
  await expect(
    page.locator(
      '#ride-browser input[aria-label="Start position along source ride"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '#ride-browser input[aria-label="End position along source ride"]',
    ),
  ).toHaveCount(1);
  const coordinates = async (axis, a, b) => {
    const svg = page.locator(".story-traces");
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    const width = await svg.evaluate((el) => el.viewBox.baseVal.width);
    const x = (i) => {
      const target = (ride.points[i - 1][axis] + ride.points[i][axis]) / 2;
      const f =
        (target - ride.points[0][axis]) /
        (ride.points.at(-1)[axis] - ride.points[0][axis]);
      return box.x + ((64 + f * (width - 84)) / width) * box.width;
    };
    return { a: x(a), b: x(b), y: box.y + box.height / 2 };
  };
  const brush = async (axis, a, b) => {
    const pos = await coordinates(axis, a, b);
    await page.mouse.move(pos.a, pos.y);
    await page.mouse.down();
    await page.mouse.move(pos.b, pos.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("#start-range")).toHaveValue(String(a));
    await expect(page.locator("#end-range")).toHaveValue(String(b));
  };
  await brush("d", 120, 180);
  await page.locator("#climb-new").click();
  await page.locator("#climb-name").fill("Shared selection");
  await page.locator("#add-stretch").click();
  await settled(page);
  expect((await workspace()).entries).toHaveLength(1);
  const manualId = (await workspace()).sections[0].id;
  const first = structuredClone((await workspace()).entries[0]);
  expect(first).toMatchObject({ start: 120, end: 180 });
  await page.locator(`[data-source-entry="${first.id}"]`).click();
  await settled(page);
  await expect(page.locator("#climb-editor")).toBeVisible();
  await expect(page.locator("#add-stretch")).toHaveText("Save changes");
  await page.locator('[data-climb^="hill-"]').first().click();
  await expect(page.locator("#add-stretch")).toHaveText("Add to comparison");
  expect((await workspace()).entries).toEqual([first]);
  await page.locator(`[data-climb="${manualId}"]`).click();
  await page.locator("#story-axis").selectOption("t");
  await brush("t", 220, 270);
  await expect(page.locator("[data-boundary=start]")).toHaveCount(1);
  await expect(page.locator("[data-brush]")).toHaveCount(6);
  expect((await workspace()).entries).toEqual([first]);
  await expect(page.locator("#climb-save")).toBeHidden();
  await page.locator("#add-stretch").click();
  await settled(page);
  expect((await workspace()).entries).toHaveLength(1);
  expect((await workspace()).entries[0]).toMatchObject({
    id: first.id,
    sectionId: manualId,
    start: 220,
    end: 270,
  });
  await page.locator("#climb-new").click();
  await page.locator("#climb-kind").selectOption("section");
  await page.locator("#climb-name").fill("Second selection");
  await range(page, 10, 50);
  await page.locator("#add-stretch").click();
  await settled(page);
  const second = structuredClone((await workspace()).entries[1]);
  expect(second).toMatchObject({ start: 10, end: 50 });
  await page.locator(`[data-saved-range="${first.id}"]`).press("Enter");
  await settled(page);
  await expect(page.locator("#climb-editor")).toBeVisible();
  await expect(page.locator("#start-range")).toHaveValue("220");
  await range(page, 221, 269);
  await page.locator("#add-stretch").click();
  await settled(page);
  expect((await workspace()).entries[0]).toMatchObject({
    id: first.id,
    start: 221,
    end: 269,
  });
  expect((await workspace()).entries[1]).toEqual(second);
  expect(
    (await workspace()).sections.find((section) => section.id === manualId),
  ).toMatchObject({ start: 221, end: 269 });
  await page.locator(`[data-source-entry="${second.id}"]`).click();
  await settled(page);
  await page.locator("#story-full").uncheck();
  expect(
    Number(await page.locator("#story-cursor").getAttribute("min")),
  ).toBeLessThan(10);
  expect(
    Number(await page.locator("#story-cursor").getAttribute("max")),
  ).toBeGreaterThan(50);
  await page.locator("#story-full").check();
  await expect(page.locator("#start-range")).toHaveValue("10");
  await expect(page.locator("#end-range")).toHaveValue("50");
  await page.locator("#story-cursor").evaluate((input) => {
    input.value = 240;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator('#map path[stroke="#172b42"]')).toHaveCount(1);
  await page.setViewportSize({ width: 1700, height: 1300 });
  const routeFits = async () => {
    const bounds = await page.locator("#map").boundingBox();
    const route = await page
      .locator('#map path[stroke-opacity="0.27"]')
      .first()
      .boundingBox();
    return (
      route &&
      bounds &&
      route.width > 10 &&
      route.height > 10 &&
      route.x >= bounds.x &&
      route.y >= bounds.y &&
      route.x + route.width <= bounds.x + bounds.width &&
      route.y + route.height <= bounds.y + bounds.height
    );
  };
  await expect.poll(routeFits).toBeTruthy();
  await page
    .locator("#ride-browser")
    .screenshot({ path: "artifacts/ride-browser-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(routeFits).toBeTruthy();
  await page
    .locator("#ride-browser")
    .screenshot({ path: "artifacts/ride-browser-mobile.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  const pos = await coordinates("t", 400, 450);
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: pos.a, y: pos.y }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: pos.b, y: pos.y }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator("#start-range")).toHaveValue("400");
  await expect(page.locator("#end-range")).toHaveValue("450");
  expect((await workspace()).entries[1]).toEqual(second);
  await touch.detach();
});

test("suggested and custom sections share one identity and edits stay in their comparison", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/rides/demo-0")).json();
  await page.goto("/");
  await settled(page);
  if (!(await page.locator('[data-source-ride="demo-0"]').count())) {
    await page.locator('input[data-include="demo-0"]').check();
    await settled(page);
  }
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  const node = page.locator('[data-climb^="hill-"]').first();
  const sectionId = await node.getAttribute("data-climb");
  await node.click();
  const start = Number(await page.locator("#start-range").inputValue()),
    end = Number(await page.locator("#end-range").inputValue());
  await page.locator("#climb-name").fill("One hill");
  await page.locator("#add-stretch").click();
  await settled(page);
  const firstId = (await comparison(request)).id,
    entryId = (await comparison(request)).entries[0].id;
  expect((await comparison(request)).entries[0].sectionId).toBe(sectionId);
  await range(page, start + 1, end - 1);
  await expect(page.locator("#add-stretch")).toHaveText("Save changes");
  await page.locator("#add-stretch").click();
  await settled(page);
  await page.locator(`[data-climb="${sectionId}"]`).click();
  await expect(page.locator("#start-range")).toHaveValue(String(start + 1));
  await page.locator("#climb-new").click();
  await page.locator("#climb-kind").selectOption("hill");
  await page.locator("#climb-name").fill("Renamed existing hill");
  await page.locator("#add-stretch").click();
  await settled(page);
  expect((await comparison(request)).entries).toHaveLength(1);
  expect((await comparison(request)).sections).toHaveLength(1);
  expect((await comparison(request)).entries[0]).toMatchObject({
    id: entryId,
    sectionId,
    start: start + 1,
    end: end - 1,
  });
  const beforeFailure = await comparison(request);
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({ status: 500, json: { error: "Section save failed" } }),
  );
  await page.locator("#climb-name").fill("Retry name");
  await range(page, start + 2, end - 2);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#stretch-status")).toContainText(
    "Section save failed",
  );
  expect((await comparison(request)).entries).toEqual(beforeFailure.entries);
  expect((await comparison(request)).sections).toEqual(beforeFailure.sections);
  await page.unroute("**/api/comparisons");
  await page.locator("#add-stretch").click();
  await settled(page);
  await page.reload();
  await settled(page);
  await page.locator(`[data-climb="${sectionId}"]`).click();
  await expect(page.locator("#climb-name")).toHaveValue("Retry name");
  await expect(page.locator("#start-range")).toHaveValue(String(start + 2));
  await expect(page.locator("#climb-save")).toBeHidden();
  await page.locator("#comparison-name").click();
  await page.locator("#comparison-name-input").fill("First comparison");
  await page.locator('#comparison-name-editor button[type="submit"]').click();
  await settled(page);
  const first = await comparison(request);
  await page.locator("#new-comparison").click();
  await settled(page);
  const all = async () =>
    (await (await request.get("/api/workspace")).json()).comparisons.items;
  const secondId = (await all()).find((c) => c.id !== firstId).id;
  await page.locator(`[data-climb="${sectionId}"]`).click();
  await expect(page.locator("#start-range")).toHaveValue(String(start));
  await expect(page.locator("#climb-name")).not.toHaveValue("Retry name");
  await page.locator("#climb-name").fill("Second only");
  await page.locator("#add-stretch").click();
  await settled(page);
  let contexts = await all();
  expect(contexts.find((c) => c.id === firstId).sections).toEqual(
    first.sections,
  );
  expect(contexts.find((c) => c.id === firstId).entries).toEqual(first.entries);
  const second = contexts.find((c) => c.id === secondId);
  await page.locator("#comparison-name").click();
  await page.locator("#comparison-name-input").fill("Second comparison");
  await page.locator('#comparison-name-editor button[type="submit"]').click();
  await settled(page);
  await page.locator("#comparison-switch").selectOption(firstId);
  await settled(page);
  await page.locator(`[data-climb="${sectionId}"]`).click();
  await expect(page.locator("#climb-name")).toHaveValue("Retry name");
  await page.locator("#climb-delete").click();
  await settled(page);
  contexts = await all();
  expect(contexts.find((c) => c.id === firstId).entries).toHaveLength(0);
  expect(contexts.find((c) => c.id === firstId).sections[0].deleted).toBe(true);
  expect(contexts.find((c) => c.id === secondId).sections).toEqual(
    second.sections,
  );
  expect(contexts.find((c) => c.id === secondId).entries).toEqual(
    second.entries,
  );
  expect(await (await request.get("/api/rides/demo-0")).json()).toEqual(
    original,
  );
});

test("legacy copies remain inspectable while a trimmed existing section updates without adding another copy", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await settled(page);
  if (!(await page.locator('[data-source-ride="demo-0"]').count())) {
    await page.locator('input[data-include="demo-0"]').check();
    await settled(page);
  }
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  const node = page.locator('[data-climb^="hill-"]').first(),
    sectionId = await node.getAttribute("data-climb");
  await node.click();
  const start = Number(await page.locator("#start-range").inputValue()),
    end = Number(await page.locator("#end-range").inputValue());
  const old = await comparison(request);
  delete old.sections;
  old.name = "Legacy context";
  old.road = { rideId: "demo-0", start, end };
  old.entries = [
    { id: "old-one", rideId: "demo-0", start, end, kind: "source" },
    {
      id: "old-copy",
      rideId: "demo-0",
      start: start + 1,
      end: end - 1,
      kind: "effort",
    },
  ];
  old.baseline = "old-one";
  const legacy = [
    {
      id: sectionId,
      kind: "hill",
      start: start + 1,
      end: end - 1,
      name: "Older saved hill",
    },
  ];
  expect(
    (
      await request.patch("/api/rides/demo-0", { data: { climbEdits: legacy } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: old.id, items: [old] },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await settled(page);
  await expect(page.locator(`[data-climb="${sectionId}"]`)).toHaveCount(1);
  await page.locator(`[data-climb="${sectionId}"]`).click();
  await expect(page.locator("#climb-tree [data-source-entry]")).toHaveCount(2);
  await expect(page.locator("#add-stretch")).toHaveText(
    "Choose existing version",
  );
  await expect(page.locator("#add-stretch")).toBeDisabled();
  await page.locator('[data-source-entry="old-copy"]').click();
  await settled(page);
  await range(page, start + 2, end - 2);
  await page.locator("#add-stretch").click();
  await settled(page);
  expect((await comparison(request)).entries).toHaveLength(2);
  expect(
    (await comparison(request)).entries.find(
      (entry) => entry.id === "old-copy",
    ),
  ).toMatchObject({ sectionId, start: start + 2, end: end - 2 });
  expect(
    (await comparison(request)).entries.find((entry) => entry.id === "old-one"),
  ).toMatchObject({ start, end });
  await expect(page.locator("#baseline")).toHaveValue("old-one");
  await page.locator('[data-entry-remove="old-one"]').click();
  await settled(page);
  await page.locator(`[data-climb="${sectionId}"]`).click();
  await range(page, start + 3, end - 3);
  await page.locator("#add-stretch").click();
  await settled(page);
  expect((await comparison(request)).entries).toHaveLength(1);
  expect((await comparison(request)).entries[0]).toMatchObject({
    id: "old-copy",
    sectionId,
  });
  expect(
    (await (await request.get("/api/rides/demo-0")).json()).climbEdits,
  ).toEqual(legacy);
});

test("a synthetic staircase nests three hills and ramps while missing optional sensor channels stay absent", async ({
  page,
  request,
}) => {
  const points = Array.from({ length: 161 }, (_, i) => {
    const d = i * 10,
      ele =
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
    return `<trkpt lat="${45 + d / 111195}" lon="-72"><ele>${ele}</ele><time>${new Date(Date.UTC(2026, 0, 1) + i * 2000).toISOString()}</time></trkpt>`;
  });
  const xml = `<gpx><trk><name>Synthetic staircase foundation</name><trkseg>${points.join("")}</trkseg></trk></gpx>`;
  expect(
    (
      await request.post("/api/import", {
        data: xml,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": "synthetic-stairs.gpx",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await settled(page);
  await page.locator("#filter").fill("Synthetic staircase foundation");
  await page.locator("#include-shown").click();
  await settled(page);
  await expect(page.locator('[data-climb^="passage-"]')).toHaveCount(1);
  await expect(page.locator('[data-climb^="hill-"]')).toHaveCount(3);
  await expect(page.locator('[data-climb^="ramp-"]')).toHaveCount(3);
  await expect(page.locator("[data-story-lane]")).toHaveCount(4);
  await expect(page.locator('[data-story-lane="power"]')).toHaveCount(0);
  await expect(page.locator('[data-story-value="hr"]')).toHaveText(
    "Not recorded",
  );
  await page.locator('[data-climb^="passage-"]').click();
  await expect(page.locator("#start-range")).toHaveValue("10");
  await expect(page.locator("#end-range")).toHaveValue("150");
  await page.locator(".terrain-settings summary").click();
  await page.locator("#passage-dip").selectOption("5");
  await expect(page.locator('[data-climb^="passage-"]')).toHaveCount(1);
  await page.locator("#passage-dip").selectOption("15");
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await page
    .locator("#ride-story")
    .screenshot({ path: "artifacts/nested-climbs-desktop.png" });
});

test("route review retains rejection, reversal, same-road confirmation and similar-terrain choices without changing tracks", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/rides/demo-1")).json();
  await page.goto("/");
  await settled(page);
  await page.locator("#clear-rides").click();
  await settled(page);
  for (const id of ["demo-0", "demo-1", "demo-2"]) {
    await page.locator(`input[data-include="${id}"]`).check();
    await settled(page);
  }
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await range(page, 414, 550);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("[data-suggestion-review]")).toHaveCount(2);
  await page.locator("[data-suggestion-review]").first().click();
  await settled(page);
  await expect(page.locator("#match-review")).toBeVisible();
  await expect(page.locator("#match-review-summary")).toContainText(
    "without translation",
  );
  await expect(page.locator("#match-review-metrics")).toContainText(
    "Candidate initial direction",
  );
  expect(
    (
      await page
        .locator("#match-review-map .leaflet-overlay-pane svg")
        .boundingBox()
    ).width,
  ).toBeGreaterThan(100);
  await page.locator("#match-review-divergence button").first().click();
  await page
    .locator("#match-review-reason")
    .fill("Treat this as a different road until reviewed");
  await page.locator("#match-reject").click();
  await settled(page);
  await expect(page.locator("[data-suggestion-review]")).toHaveCount(1);
  let workspace = await (await request.get("/api/workspace")).json();
  expect(workspace.comparisons.items[0].matchDecisions).toHaveLength(1);
  const rejectedRide = workspace.comparisons.items[0].matchDecisions[0].rideId;
  const backup = await (await request.get("/api/backup")).body();
  await request.put("/api/comparisons", { data: { activeId: "", items: [] } });
  expect(
    (
      await request.post("/api/restore", {
        data: backup,
        headers: { "Content-Type": "application/octet-stream" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await settled(page);
  await expect(page.locator("[data-suggestion-review]")).toHaveCount(1);
  await page.locator("#rejected-matches summary").click();
  await page.locator("[data-rejected-review]").click();
  await settled(page);
  await page.locator("#match-confirm").click();
  await settled(page);
  workspace = await (await request.get("/api/workspace")).json();
  const accepted = workspace.comparisons.items[0].entries.find(
    (entry) => entry.rideId === rejectedRide,
  );
  expect(accepted.kind).toBe("matched");
  expect(accepted.relation).toBe("same-road");
  expect(accepted.review).toBe("confirmed");
  expect(workspace.comparisons.items[0].matchDecisions).toHaveLength(0);
  await page.locator("#baseline").selectOption(accepted.id);
  await page.locator(`[data-entry-review="${accepted.id}"]`).click();
  await settled(page);
  await page.locator("#match-reject").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await expect(page.locator("#baseline-notice")).toContainText(
    "rejected during road review",
  );
  await page.locator(`[data-entry-review="${accepted.id}"]`).click();
  await settled(page);
  await page.locator("#match-similar").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  await expect(page.locator("#budget-panel")).toBeHidden();
  await expect(page.locator("#comparison-method")).toContainText(
    "Similar-terrain",
  );
  await page
    .locator(`#comparison-entries [data-entry-edit="${accepted.id}"]`)
    .click();
  await settled(page);
  const start = Number(await page.locator("#start-range").inputValue()),
    end = Number(await page.locator("#end-range").inputValue());
  await range(page, start + 1, end - 1);
  await page.locator("#add-stretch").click();
  await settled(page);
  await page.locator("#inspect-pairing").click();
  await settled(page);
  await expect(page.locator("#match-review-summary")).toContainText(
    "manual correction",
  );
  await page.locator("#match-confirm").click();
  await settled(page);
  workspace = await (await request.get("/api/workspace")).json();
  const manual = workspace.comparisons.items[0].entries.find(
    (entry) => entry.id === accepted.id,
  );
  expect(manual.kind).toBe("effort");
  expect(manual.relation).toBe("same-road");
  expect(manual.start).toBe(start + 1);
  expect(manual.end).toBe(end - 1);
  await expect(page.locator("#budget-panel")).toBeHidden();
  expect(
    (await (await request.get("/api/rides/demo-1")).json()).points,
  ).toEqual(original.points);
  await page.locator(`[data-entry-review="${accepted.id}"]`).click();
  await settled(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page
    .locator("#match-review")
    .screenshot({ path: "artifacts/match-review-mobile.png" });
});

test("nearby parallel tracks remain separate and a failed review save is recoverable", async ({
  page,
  request,
}) => {
  const ids = [];
  for (const [index, name] of [
    "Twin lane foundation reference",
    "Twin lane foundation parallel",
  ].entries()) {
    const lon = -72 + (index * 20) / (111195 * Math.cos((45 * Math.PI) / 180));
    const points = Array.from(
      { length: 61 },
      (_, i) =>
        `<trkpt lat="${45 + (i * 10) / 111195}" lon="${lon}"><ele>${100 + i}</ele><time>${new Date(Date.UTC(2026, 0, 3 + index) + i * 2000).toISOString()}</time></trkpt>`,
    ).join("");
    expect(
      (
        await request.post("/api/import", {
          data: `<gpx><trk><name>${name}</name><trkseg>${points}</trkseg></trk></gpx>`,
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": `synthetic-lane-${index}.gpx`,
          },
        })
      ).ok(),
    ).toBeTruthy();
    ids.push(
      (await (await request.get("/api/workspace")).json()).rides.find(
        (ride) => ride.name === name,
      ).id,
    );
  }
  const before = await (await request.get(`/api/rides/${ids[1]}`)).json();
  await page.goto("/");
  await settled(page);
  await page.locator("#filter").fill("Twin lane foundation");
  await page.locator("#include-shown").click();
  await settled(page);
  await page.locator(`[data-source-ride="${ids[0]}"]`).click();
  await settled(page);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await expect(page.locator("[data-suggestion-review]")).toHaveCount(1);
  await page.locator("[data-suggestion-review]").click();
  await settled(page);
  await expect(page.locator("#match-review-metrics")).toContainText("20.0 m");
  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated review save failure" }),
        })
      : route.continue(),
  );
  await page
    .locator("#match-review-reason")
    .fill("Parallel lane, keep distinct");
  await page.locator("#match-reject").click();
  await settled(page);
  await expect(page.locator("#match-review-status")).toContainText("Not saved");
  await expect(page.locator("#match-review")).toBeVisible();
  expect(
    (await (await request.get("/api/workspace")).json()).comparisons.items[0]
      .matchDecisions,
  ).toHaveLength(0);
  await page.unroute("**/api/comparisons");
  await page.locator("#match-reject").click();
  await settled(page);
  await expect(page.locator("[data-suggestion-review]")).toHaveCount(0);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await page.reload();
  await settled(page);
  await expect(page.locator("[data-suggestion-review]")).toHaveCount(0);
  expect(
    (await (await request.get(`/api/rides/${ids[1]}`)).json()).points,
  ).toEqual(before.points);
});
