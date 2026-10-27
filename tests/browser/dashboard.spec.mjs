import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { makeDemo } from "../../lib/demo.mjs";
import { gunzipSync } from "node:zlib";
const fixture = `<gpx><trk><name>Uploaded fixture</name><trkseg><trkpt lat="45" lon="-122"><ele>100</ele><time>2026-10-01T10:00:00Z</time></trkpt><trkpt lat="45.001" lon="-122"><ele>110</ele><time>2026-10-01T10:00:10Z</time></trkpt></trkseg></trk></gpx>`;
async function selectRange(page, start, end) {
  for (const [id, value] of [
    ["start-range", start],
    ["end-range", end],
  ]) {
    await page.locator("#" + id).evaluate((el, value) => {
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }
}
const settled = (page) =>
  expect(page.locator("body")).not.toHaveClass(/working/);
async function seedDemo(request) {
  const result = await request.post("/api/demo", { data: {} });
  expect(result.ok()).toBeTruthy();
}
test.beforeEach(async ({ request }) => {
  const result = await request.put("/api/comparisons", {
    data: { activeId: "", items: [] },
  });
  expect(result.ok()).toBeTruthy();
});
test("dashboard imports, matches, edits, exports, backs up and works on mobile", async ({
  page,
  request,
}) => {
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4318")) external.push(r.url());
  });
  const documentResponse = await page.goto("/");
  const policy = documentResponse.headers()["content-security-policy"];
  expect(policy).toContain("img-src 'self' data:;");
  expect(policy).toContain("connect-src 'self';");
  expect(policy).not.toContain("tile.openstreetmap.org");
  await expect(page.getByRole("checkbox", { name: "Street map" })).toHaveCount(
    0,
  );
  await expect(page.locator(".leaflet-tile-pane img")).toHaveCount(0);
  await expect(page).toHaveTitle("Noboride · Same road. Clearer answers.");
  await expect(page.getByRole("link", { name: "Noboride home" })).toBeVisible();
  await expect(page.locator("#welcome")).toBeVisible();
  await page.locator("#demo").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await expect(page.locator("#messages .notice")).toHaveCount(0);
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await selectRange(page, 414, 550);
  await settled(page);
  const startMarker = page.locator("#map .map-endpoint.start");
  await startMarker.scrollIntoViewIfNeeded();
  const startBox = await startMarker.boundingBox(),
    endBox = await page.locator("#map .map-endpoint.end").boundingBox();
  await page.mouse.move(startBox.x + 14, startBox.y + 14);
  await page.mouse.down();
  await page.mouse.move(
    startBox.x + 14 + (endBox.x - startBox.x) * 0.2,
    startBox.y + 14 + (endBox.y - startBox.y) * 0.2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator("#start-range")).not.toHaveValue("414");
  await page.locator("#add-stretch").click();
  await settled(page);
  for (let i = 0; i < 2; i++) {
    await page.locator("[data-suggestion-add]").first().click();
    await settled(page);
  }
  await expect(page.locator("#matches tbody tr")).toHaveCount(3);
  await expect(page.locator("#budget-panel")).toBeVisible();
  await page.locator("#metric").selectOption("delta");
  await expect(page.locator("#comparison-chart svg path")).toHaveCount(3);
  await page.locator("#grade-window").fill("25");
  await page.locator("#grade-window").dispatchEvent("input");
  await expect(page.locator("#grade-window-value")).toHaveText("25 m");
  const refId = await page
    .getByRole("tab", { selected: true })
    .getAttribute("data-source-ride");
  const ride = await (await request.get(`/api/rides/${refId}`)).json();
  const p = ride.points[430];
  await page.locator("#reset-selection").click();
  await settled(page);
  await page.locator(".coordinate-details summary").first().click();
  await page.locator("#start-coordinate").fill(`${p.lat}, ${p.lon}`);
  await page.locator("#snap-start").click();
  await expect(page.locator("#start-range")).toHaveValue("430");
  const box = await page.locator("#story-charts .story-traces").boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.5, {
    steps: 5,
  });
  await page.mouse.up();
  await page.locator("#comparison-entries [data-entry-edit]").first().click();
  await settled(page);
  const editStart = Number(await page.locator("#start-range").inputValue());
  const editEnd = Number(await page.locator("#end-range").inputValue());
  await selectRange(page, editStart + 1, editEnd);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#matches tbody")).toContainText("manual");
  const ws = await (await request.get("/api/workspace")).json();
  expect(ws.segments.some((s) => s.id === "demo-hill")).toBe(true);
  expect(
    ws.comparisons.items
      .find((c) => c.id === ws.comparisons.activeId)
      .entries.some((e) => e.kind === "effort"),
  ).toBe(true);
  await page.locator("[data-notes]").first().click();
  await page.locator("#note-bike").fill("Road bike");
  await page.locator("#note-notes").fill("Standing on the final ramp.");
  await page.locator("#notes-form button[type=submit]").click();
  await expect(page.locator("#notes-dialog")).not.toBeVisible();
  await expect(page.locator("#context")).toContainText(
    "Standing on the final ramp.",
  );
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  expect((await download).suggestedFilename()).toBe(
    "noboride-section-comparison.csv",
  );
  await page.locator("#files").setInputFiles({
    name: "upload.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(fixture),
  });
  await expect(page.locator("#report-title")).toContainText("1 imported");
  await settled(page);
  await page.locator("#files").setInputFiles({
    name: "upload.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(fixture),
  });
  await expect(page.locator("#report-title")).toContainText("1 duplicates");
  await settled(page);
  await page.locator("#files").setInputFiles({
    name: "public-real-track.gpx",
    mimeType: "application/gpx+xml",
    buffer: readFileSync(
      new URL("../fixtures/cerknicko-jezero.gpx", import.meta.url),
    ),
  });
  await expect(page.locator("#report-title")).toContainText("7 imported");
  await settled(page);
  const backup = await request.get("/api/backup");
  expect(backup.ok()).toBeTruthy();
  expect(backup.headers()["content-disposition"]).toContain(
    "noboride-backup.json.gz",
  );
  const restored = await request.post("/api/restore", {
    data: await backup.body(),
    headers: { "Content-Type": "application/octet-stream" },
  });
  expect(restored.ok()).toBeTruthy();
  expect((await restored.json()).imported).toBe(0);
  const attack = await request.post("/api/demo", {
    data: {},
    headers: { Origin: "https://example.invalid" },
  });
  expect(attack.status()).toBe(403);
  const notPublic = await request.get("/data/noboride.sqlite");
  expect(notPublic.status()).toBe(404);
  expect((await request.get("/data/ridescope.sqlite")).status()).toBe(404);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator("#map .leaflet-overlay-pane svg")).toBeVisible();
  expect(
    (await page.locator("#map .leaflet-overlay-pane svg").boundingBox()).width,
  ).toBeGreaterThan(100);
  await expect(page.locator("#map .map-endpoint.start")).toBeVisible();
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".comparison-workspace")
    .screenshot({ path: "artifacts/comparison-context-mobile.png" });
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: "artifacts/dashboard-mobile.png",
    fullPage: true,
  });
  await page
    .locator(".studio")
    .screenshot({ path: "artifacts/stretch-editor-mobile.png" });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("one stretch editor preserves selections and explicitly updates only the chosen entry", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined }),
  );
  await page.goto("/");
  await settled(page);
  await expect(
    page.locator("#scope, #section-name, #save-section, #manual-dialog"),
  ).toHaveCount(0);
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await selectRange(page, 100, 200);
  await page.locator("#add-stretch").click();
  await settled(page);
  let workspace = await (await request.get("/api/workspace")).json();
  const first = workspace.comparisons.items[0].entries[0].id;
  await page.locator('[data-source-ride="demo-1"]').click();
  await settled(page);
  await selectRange(page, 240, 340);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  const baseline = await page.locator("#baseline").inputValue();
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await expect(page.locator("#start-range")).toHaveValue("100");
  await expect(page.locator("#end-range")).toHaveValue("200");
  await expect(page.locator("#add-stretch")).toHaveText(
    "Already in comparison",
  );
  await expect(page.locator("#add-stretch")).toBeDisabled();
  await expect(page.locator("#climb-tree [data-source-entry]")).toHaveCount(1);
  await expect(page.locator("#story-charts [data-saved-range]")).toHaveCount(1);
  await expect(page.locator("#map .saved-stretch-route")).toHaveCount(1);
  await page.locator('[data-source-ride="demo-1"]').click();
  await settled(page);
  await expect(page.locator("#start-range")).toHaveValue("240");
  await page
    .locator(`#comparison-entries [data-entry-edit="${first}"]`)
    .click();
  await settled(page);
  await expect(page.locator("#selection-context")).toContainText(
    "Editing section 1",
  );
  await expect(page.locator("#add-stretch")).toHaveText("Save changes");
  await expect(page.locator("#add-stretch")).toBeDisabled();
  await expect(page.locator("#add-stretch")).toHaveCSS("cursor", "not-allowed");
  await expect(page.locator("#selection-context")).toContainText(
    "No changes to save",
  );
  await selectRange(page, 110, 200);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  workspace = await (await request.get("/api/workspace")).json();
  expect(workspace.comparisons.items[0].entries[0].start).toBe(100);
  await page.locator("#cancel-stretch-edit").click();
  await settled(page);
  await expect(page.locator("#start-range")).toHaveValue("240");
  await page
    .locator(`#comparison-entries [data-entry-edit="${first}"]`)
    .click();
  await settled(page);
  await selectRange(page, 110, 200);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#stretch-status")).toHaveText(
    "Section saved in this comparison.",
  );
  workspace = await (await request.get("/api/workspace")).json();
  expect(workspace.comparisons.items[0].entries).toHaveLength(2);
  expect(
    workspace.comparisons.items[0].entries.find((e) => e.id === first).start,
  ).toBe(110);
  expect(
    workspace.comparisons.items[0].entries.find((e) => e.id !== first).start,
  ).toBe(240);
  await expect(page.locator("#baseline")).toHaveValue(baseline);
  await page.reload();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  await expect(page.locator("#baseline")).toHaveValue(baseline);
  await page
    .locator(`#comparison-entries [data-entry-edit="${first}"]`)
    .click();
  await settled(page);
  await expect(page.locator("#start-range")).toHaveValue("110");
  await expect(page.locator("#end-range")).toHaveValue("200");
  await page.locator("#cancel-stretch-edit").click();
  await settled(page);
  await page.locator("#comparison-entries [data-entry-remove]").last().click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await page.locator("#comparison-entries [data-entry-remove]").click();
  await settled(page);
  await expect(page.locator("#new-comparison")).toBeDisabled();
  await page.locator("#climb-new").click();
  await selectRange(page, 1, 2);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#stretch-status")).toContainText(
    "at least 20 meters",
  );
  await expect(page.locator("#stretch-status")).toHaveClass("error");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

test("source tabs follow included rides and preserve an empty browsing selection", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  await page.goto("/");
  await settled(page);
  const tabs = page.getByRole("tab");
  const current = await page
    .getByRole("tab", { selected: true })
    .getAttribute("data-source-ride");
  await page.locator(`input[data-include="${current}"]`).uncheck();
  await settled(page);
  await expect(tabs).toHaveCount(2);
  await expect(page.locator(`[data-source-ride="${current}"]`)).toHaveCount(0);
  await page.locator("#filter").fill("New bike");
  await page.locator("#include-shown").click();
  await settled(page);
  await expect(tabs).toHaveCount(1);
  const checked = await page
    .locator("input[data-include]:checked")
    .getAttribute("data-include");
  await expect(page.locator(`[data-source-ride="${checked}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.locator("#clear-rides").click();
  await settled(page);
  await expect(tabs).toHaveCount(0);
  await expect(page.locator("#add-stretch")).toBeDisabled();
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await expect(page.locator("#map .map-endpoint")).toHaveCount(0);
  await page.reload();
  await settled(page);
  await expect(tabs).toHaveCount(0);
  await page.locator('input[data-include="demo-0"]').check();
  await settled(page);
  await expect(page.locator('[data-source-ride="demo-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tabs).toHaveCount(1);
  await page.reload();
  await settled(page);
  await expect(page.locator('[data-source-ride="demo-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tabs).toHaveCount(1);
});

test("selected rides scope saved analysis, preserve missing baselines and reveal partial comparisons", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  const entries = [0, 1, 2].map((i) => ({
    id: `scope-${i}`,
    rideId: `demo-${i}`,
    start: 414,
    end: 550,
    kind: i ? "effort" : "source",
  }));
  const first = {
    id: "scope-hill",
    name: "Saved hill",
    entries,
    road: { rideId: "demo-0", start: 414, end: 550 },
    selected: ["demo-0", "demo-1", "demo-2"],
    browse: { rideId: "demo-0", start: 414, end: 550 },
    baseline: "scope-1",
    comparison: "scope-2",
    metric: "delta",
    settings: {},
  };
  const other = {
    ...first,
    id: "scope-other",
    name: "Other hill",
    entries: [{ ...entries[1], id: "other-entry" }],
    road: { rideId: "demo-1", start: 414, end: 550 },
    selected: ["demo-1"],
    browse: { rideId: "demo-1", start: 414, end: 550 },
    baseline: "other-entry",
    comparison: "",
  };
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: first.id, items: [first, other] },
      })
    ).ok(),
  ).toBeTruthy();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(3);
  await expect(page.locator("#comparison-availability-text")).toContainText(
    "Ready",
  );
  await page.locator('input[data-include="demo-1"]').uncheck();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  await expect(page.locator("#context .context-card")).toHaveCount(2);
  await expect(page.locator("#comparison-entries li")).toHaveCount(2);
  await expect(page.locator("#excluded-entries li")).toHaveCount(1);
  await expect(page.locator("#comparison-availability-text")).toContainText(
    "2 of 3",
  );
  await expect(
    page.locator(`#comparison-switch option[value="${first.id}"]`),
  ).toContainText("Partial (2/3)");
  await expect(
    page.locator(`#comparison-switch option[value="${other.id}"]`),
  ).toContainText("No selected rides");
  await expect(page.locator("#baseline")).toHaveValue("scope-1");
  await expect(page.locator("#baseline-notice")).toContainText("not selected");
  await expect(page.locator("#comparison-chart svg")).toHaveCount(0);
  await expect(page.locator("#budget-panel")).toBeHidden();
  for (const cell of await page
    .locator("#matches tbody tr td:nth-child(3)")
    .all())
    await expect(cell).toHaveText("—");
  const csvDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  const csvFile = await csvDownload;
  expect(
    readFileSync(await csvFile.path(), "utf8")
      .trim()
      .split(/\r?\n/),
  ).toHaveLength(3);
  let workspace = await (await request.get("/api/workspace")).json();
  expect(workspace.comparisons.items[0].entries).toEqual(entries);
  expect(workspace.comparisons.items[0].baseline).toBe("scope-1");
  const fetched = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/rides/"))
      fetched.push(new URL(req.url()).pathname);
  });
  await page.reload();
  await settled(page);
  expect(fetched).not.toContain("/api/rides/demo-1");
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  await expect(page.locator("#baseline")).toHaveValue("scope-1");
  await page.locator("#include-baseline-ride").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(3);
  await expect(page.locator("#baseline-notice")).toBeHidden();
  await expect(page.locator("#comparison-chart svg")).toHaveCount(1);
  await page.locator('input[data-include="demo-1"]').uncheck();
  await settled(page);
  await page.locator("#baseline").selectOption("scope-0");
  await expect(page.locator("#baseline-notice")).toBeHidden();
  await expect(page.locator("#comparison-chart svg")).toHaveCount(1);
  await page.locator("#excluded-stretches-summary").click();
  await page.locator('[data-include-saved-ride="demo-1"]').click();
  await settled(page);
  await expect(page.locator("#baseline")).toHaveValue("scope-0");
  await page.locator("#clear-rides").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await expect(page.locator("#context .context-card")).toHaveCount(0);
  await expect(page.locator("#summary")).toContainText(
    "No available stretches",
  );
  await expect(page.locator("#export")).toBeDisabled();
  await expect(page.locator("#comparison-chart svg")).toHaveCount(0);
  await expect(page.locator("#baseline")).toHaveValue("scope-0");
  await page.reload();
  await settled(page);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  // Switching contexts must not secretly replace the checked ride set.
  await page.locator("#comparison-switch").selectOption(other.id);
  await settled(page);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await page.locator("#include-missing-rides").click();
  await settled(page);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await expect(page.locator("#baseline")).toHaveValue("other-entry");
  await page.locator("#comparison-switch").selectOption(first.id);
  await settled(page);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await expect(page.locator("#baseline")).toHaveValue("scope-0");
  await expect(page.locator("#baseline-notice")).toContainText("not selected");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page
    .locator(".comparison-workspace")
    .screenshot({ path: "artifacts/partial-comparison-mobile.png" });
  await page.locator("#include-missing-rides").click();
  await settled(page);
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.locator("#matches tbody tr")).toHaveCount(3);
  await expect(page.locator("#baseline")).toHaveValue("scope-0");
  workspace = await (await request.get("/api/workspace")).json();
  expect(workspace.comparisons.items[0].entries).toEqual(entries);
  expect(workspace.comparisons.items[1].entries).toEqual(other.entries);
  const backup = JSON.parse(
    gunzipSync(await (await request.get("/api/backup")).body()),
  );
  expect(backup.comparisons.items[0].entries).toEqual(entries);
  expect(errors).toEqual([]);
});

test("an unverified saved baseline is distinguished from an unselected ride without substitution", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  const road = { rideId: "demo-0", start: 414, end: 550 };
  const entries = [
    { id: "verified-source", ...road, kind: "source" },
    {
      id: "stale-match",
      rideId: "demo-1",
      start: 20,
      end: 100,
      kind: "matched",
    },
  ];
  const context = {
    id: "unverified",
    name: "Review old match",
    entries,
    road,
    selected: ["demo-0", "demo-1"],
    browse: road,
    baseline: "stale-match",
    comparison: "verified-source",
    metric: "delta",
    settings: {},
  };
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: context.id, items: [context] },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await expect(page.locator("#comparison-entries li")).toHaveCount(2);
  await expect(page.locator("#comparison-availability-text")).toContainText(
    "could not be verified",
  );
  await expect(page.locator("#comparison-switch option:checked")).toContainText(
    "Review matches (1/2)",
  );
  await expect(page.locator("#baseline")).toHaveValue("stale-match");
  await expect(page.locator("#baseline-notice")).toContainText(
    "matching settings",
  );
  await expect(page.locator("#include-baseline-ride")).toBeHidden();
  await expect(page.locator("#comparison-chart svg")).toHaveCount(0);
  await expect(page.locator("#matches tbody td:nth-child(3)")).toHaveText("—");
  await page.locator("#baseline").selectOption("verified-source");
  await expect(page.locator("#baseline-notice")).toBeHidden();
  await expect(page.locator("#comparison-chart svg")).toHaveCount(1);
  await page.locator('input[data-include="demo-0"]').uncheck();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await expect(page.locator("#baseline-notice")).toContainText("not selected");
  await page.locator("#include-missing-rides").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  expect(
    (await (await request.get("/api/workspace")).json()).comparisons.items[0]
      .entries,
  ).toEqual(entries);
});

test("legacy included rides carry over and Noboride selections take precedence", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  const workspace = await (await request.get("/api/workspace")).json();
  const ids = workspace.rides.map((r) => r.id);
  await page.addInitScript((id) => {
    localStorage.setItem("ridescope-included", JSON.stringify([id]));
  }, ids[0]);
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("noboride-included")))
    .toBe(JSON.stringify([ids[0]]));
  await settled(page);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.locator("#clear-rides").click();
  await settled(page);
  await page.locator(`input[data-include="${ids[1]}"]`).check();
  await settled(page);
  await page.reload();
  await settled(page);
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("noboride-included")),
  ).toBe(JSON.stringify([ids[1]]));
  // An intentionally empty context selection must not fall back to the legacy key.
  await page.locator("#clear-rides").click();
  await settled(page);
  await page.reload();
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("comparison contexts name, switch, retain multiple stretches and restore analysis choices", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  await page.goto("/");
  await settled(page);
  await expect(page.locator("#new-comparison")).toBeDisabled();
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await selectRange(page, 414, 550);
  await settled(page);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#new-comparison")).toBeEnabled();
  await expect(page.locator("#comparison-entries li")).toHaveCount(1);
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(2);
  await page.locator('[data-source-ride="demo-1"]').click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  for (const [id, value] of [
    ["start-range", 414],
    ["end-range", 550],
  ])
    await page.locator(`#${id}`).evaluate((el, value) => {
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await page.locator("#add-stretch").click();
  await settled(page);
  await page.locator("#another-stretch").click();
  await settled(page);
  for (const [id, value] of [
    ["start-range", 20],
    ["end-range", 100],
  ])
    await page.locator(`#${id}`).evaluate((el, value) => {
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#comparison-entries li")).toHaveCount(3);
  await expect(page.locator("#budget-panel")).toBeHidden();
  await request.post("/api/import", {
    data: Buffer.from(fixture),
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": "unrelated.gpx",
    },
  });
  // Refresh metadata while preserving this context's accepted stretches.
  await page.reload();
  await settled(page);
  const importedWorkspace = await (await request.get("/api/workspace")).json();
  const unrelated = importedWorkspace.rides.find(
    (r) => r.name === "Uploaded fixture",
  );
  await page.locator(`input[data-include="${unrelated.id}"]`).check();
  await settled(page);
  await page.locator(`[data-source-ride="${unrelated.id}"]`).click();
  await settled(page);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#comparison-entries li")).toHaveCount(4);
  await expect(page.locator("#comparison-method")).toContainText(
    "different roads",
  );
  await expect(page.locator("#budget-panel")).toBeHidden();
  const baseline = await page
    .locator("#baseline option")
    .nth(1)
    .getAttribute("value");
  await page.locator("#baseline").selectOption(baseline);
  await page.locator("#metric").selectOption("hr");
  await page.locator("#new-comparison").click();
  await settled(page);
  await expect(page.locator("#comparison-name-editor")).toBeVisible();
  await page.locator("#comparison-name-input").fill("Hill effort");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await settled(page);
  await expect(page.locator("#comparison-name")).toHaveText(
    "Untitled comparison",
  );
  await expect(page.locator("#new-comparison")).toBeDisabled();
  const emptyId = await page.locator("#comparison-switch").inputValue();
  await page.locator("#add-stretch").click();
  await settled(page);
  await page.locator("#comparison-name").click();
  await page.locator("#comparison-name-input").fill("  HILL   effort ");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.locator("#comparison-name-error")).toContainText(
    "already exists",
  );
  await page.locator("#comparison-name-cancel").click();
  const firstId = await page
    .locator("#comparison-switch option")
    .filter({ hasText: "Hill effort" })
    .getAttribute("value");
  await page.locator("#comparison-switch").selectOption(firstId);
  await settled(page);
  await expect(page.locator("#comparison-name-editor")).toBeVisible();
  await page.locator("#comparison-name-input").fill("Other effort");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await settled(page);
  await expect(page.locator("#comparison-name")).toHaveText("Hill effort");
  await expect(page.locator("#comparison-entries li")).toHaveCount(4);
  await expect(page.locator("#baseline")).toHaveValue(baseline);
  await expect(page.locator("#metric")).toHaveValue("hr");
  await page.reload();
  await settled(page);
  await expect(page.locator("#comparison-name")).toHaveText("Hill effort");
  await expect(page.locator("#comparison-entries li")).toHaveCount(4);
  await expect(page.locator("#baseline")).toHaveValue(baseline);
  await page.locator("#comparison-switch").selectOption(emptyId);
  await settled(page);
  await expect(page.locator("#comparison-name")).toHaveText("Other effort");
  const backup = await request.get("/api/backup");
  await request.put("/api/comparisons", { data: { activeId: "", items: [] } });
  const restored = await request.post("/api/restore", {
    data: await backup.body(),
    headers: { "content-type": "application/octet-stream" },
  });
  expect(restored.ok()).toBeTruthy();
  await page.reload();
  await settled(page);
  await expect(page.locator("#comparison-name")).toHaveText("Other effort");
  await expect(page.locator("#comparison-switch option")).toHaveCount(2);
  await page.locator("#comparison-name").click();
  await page
    .locator("#comparison-name-input")
    .fill("Comparison " + "x".repeat(100));
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await settled(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

test("a second lap of the same recording is suggested as a separate comparison entry", async ({
  page,
  request,
}) => {
  const points = makeDemo().rides[0].points;
  const duration = points.at(-1).t - points[0].t;
  const twice = points.concat(
    points.slice(1).map((p) => ({ ...p, t: p.t + duration })),
  );
  const gpx = `<gpx><trk><name>Two laps fixture</name><trkseg>${twice.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${new Date(p.t).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;
  const imported = await request.post("/api/import", {
    data: Buffer.from(gpx),
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": "two-laps.gpx",
    },
  });
  expect(imported.ok()).toBeTruthy();
  await page.goto("/");
  await settled(page);
  await page.locator("#filter").fill("Two laps fixture");
  await page.locator("#include-shown").click();
  await settled(page);
  for (const [id, value] of [
    ["start-range", 414],
    ["end-range", 550],
  ])
    await page.locator(`#${id}`).evaluate((el, value) => {
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(1);
  await expect(page.locator("#suggestions")).toContainText("pass 2");
  await page.locator("[data-suggestion-view]").click();
  await settled(page);
  expect(
    Number(await page.locator("#start-range").inputValue()),
  ).toBeGreaterThan(600);
  await page.locator("[data-suggestion-add]").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  await expect(page.locator("#baseline option")).toHaveCount(2);
  await expect(page.locator("#budget-panel")).toBeVisible();
  const workspace = await (await request.get("/api/workspace")).json();
  const entries = workspace.comparisons.items[0].entries;
  expect(entries[0].rideId).toBe(entries[1].rideId);
  expect(entries[0].id).not.toBe(entries[1].id);
  expect(entries[1].kind).toBe("matched");
  expect(entries[1].start).toBeGreaterThan(600);
  await page.locator(`input[data-include="${entries[0].rideId}"]`).uncheck();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
  await expect(page.locator("#excluded-entries li")).toHaveCount(2);
  await page.locator("#include-missing-rides").click();
  await settled(page);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  await expect(page.locator("#climb-tree [data-source-entry]")).toHaveCount(2);
  await expect(page.locator("#story-charts [data-saved-range]")).toHaveCount(2);
  await expect(page.locator("#map .saved-stretch-route")).toHaveCount(2);
  await page.reload();
  await settled(page);
  await expect(page.locator("#climb-tree [data-source-entry]")).toHaveCount(2);
  await expect(page.locator("#story-charts [data-saved-range]")).toHaveCount(2);
  await page
    .locator(".studio")
    .screenshot({ path: "artifacts/saved-stretches-desktop.png" });
  const savedCard = page.locator("#climb-tree [data-source-entry]").last();
  await savedCard.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await savedCard.click();
  await settled(page);
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore),
  ).toBeLessThanOrEqual(2);
  expect(
    Number(await page.locator("#start-range").inputValue()),
  ).toBeGreaterThan(600);
  await expect(
    page.locator("#climb-tree [data-source-entry][aria-pressed=true]"),
  ).toHaveCount(1);
  await expect(page.locator("#add-stretch")).toHaveText("Save changes");
  await page.locator("#another-stretch").click();
  await settled(page);
  await expect(page.locator("#start-range")).toHaveValue("0");
  await selectRange(page, 20, 100);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("#climb-tree [data-source-entry]")).toHaveCount(3);
  await expect(page.locator("#story-charts [data-saved-range]")).toHaveCount(3);
  const updated = await (await request.get("/api/workspace")).json();
  expect(updated.comparisons.items[0].entries.slice(0, 2)).toEqual(entries);
});

test("settings dialog controls overlapping suggestions live and persists the chosen threshold", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  await page.goto("/");
  await settled(page);
  await page.locator('[data-source-ride="demo-0"]').click();
  await settled(page);
  await selectRange(page, 414, 550);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(2);
  await page.locator("[data-suggestion-view]").first().click();
  await settled(page);
  const rideId = await page
    .getByRole("tab", { selected: true })
    .getAttribute("data-source-ride");
  const start = Number(await page.locator("#start-range").inputValue());
  const end = Number(await page.locator("#end-range").inputValue());
  await selectRange(page, start + 20, end - 5);
  await page.locator("#add-stretch").click();
  await settled(page);
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(1);
  await expect(page.locator("#matches tbody tr")).toHaveCount(2);
  let workspace = await (await request.get("/api/workspace")).json();
  const trimmed = workspace.comparisons.items[0].entries.find(
    (entry) => entry.rideId === rideId,
  );
  expect(trimmed.start).toBe(start + 20);
  expect(trimmed.end).toBe(end - 5);
  expect(trimmed.kind).toBe("effort");
  await page.locator("#settings-button").click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.locator("#suggestion-overlap").evaluate((input) => {
    input.value = "95";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#suggestion-overlap-value")).toHaveText("95%");
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(2);
  await page.locator("#suggestion-overlap").evaluate((input) => {
    input.value = "65";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(1);
  await page.locator('[data-close="settings"]').click();
  await expect(page.locator("#settings")).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/workspace")).json()).comparisons
          .items[0].settings.suggestionOverlap,
    )
    .toBe(65);
  for (const value of [0, 101, "60"])
    expect(
      (
        await request.put("/api/settings", {
          data: { suggestionOverlap: value },
        })
      ).status(),
    ).toBe(400);
  await page.reload();
  await settled(page);
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(1);
  await page.locator("#settings-button").click();
  await expect(page.locator("#suggestion-overlap")).toHaveValue("65");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page
    .locator("#settings")
    .screenshot({ path: "artifacts/settings-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).not.toBeVisible();
  await expect(page.locator("#settings-button")).toBeFocused();
  await page.locator(`[data-entry-remove="${trimmed.id}"]`).click();
  await settled(page);
  await expect(page.locator("[data-suggestion-add]")).toHaveCount(2);
});

test("comparisons can be deleted independently and the last one becomes a protected fresh comparison", async ({
  page,
  request,
}) => {
  await seedDemo(request);
  const makeContext = (id, name, rideId, start, end) => ({
    id,
    name,
    entries: [{ id: `${id}-entry`, rideId, start, end, kind: "source" }],
    road: { rideId, start, end },
    selected: [rideId],
    browse: { rideId, start, end },
    baseline: `${id}-entry`,
    comparison: `${id}-entry`,
    metric: "speed",
    settings: {},
  });
  const first = makeContext("delete-first", "First hill", "demo-0", 100, 200);
  const second = makeContext(
    "delete-second",
    "Second hill",
    "demo-1",
    200,
    300,
  );
  const empty = {
    ...first,
    id: "delete-empty",
    name: "",
    entries: [],
    road: null,
    baseline: "",
    comparison: "",
  };
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: empty.id, items: [first, second, empty] },
      })
    ).ok(),
  ).toBeTruthy();
  const ridesBefore = (await (await request.get("/api/workspace")).json()).rides
    .length;
  await page.goto("/");
  await settled(page);
  await expect(page.locator("#delete-comparison")).toBeEnabled();
  await page.locator("#delete-comparison").click();
  await page.locator("#comparison-delete-cancel").click();
  await expect(page.locator("#comparison-switch option")).toHaveCount(3);
  // A failed persistence request must leave the context available for retry.
  await page.route("**/api/comparisons", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated save failure" }),
        })
      : route.continue(),
  );
  await page.locator("#delete-comparison").click();
  await page.locator("#comparison-delete-yes").click();
  await settled(page);
  await expect(page.locator("#comparison-switch option")).toHaveCount(3);
  expect(
    (await (await request.get("/api/workspace")).json()).comparisons.items,
  ).toHaveLength(3);
  await page.unroute("**/api/comparisons");
  await page.locator("#delete-comparison").click();
  await page.locator("#comparison-delete-yes").click();
  await settled(page);
  await expect(page.locator("#comparison-switch")).toHaveValue(second.id);
  await page.locator("#comparison-switch").selectOption(first.id);
  await settled(page);
  await page.locator("#delete-comparison").click();
  await expect(page.locator("#comparison-delete-message")).toContainText(
    "First hill",
  );
  await page.locator("#comparison-delete-yes").click();
  await settled(page);
  await expect(page.locator("#comparison-switch")).toHaveValue(second.id);
  await expect(page.locator("#baseline")).toHaveValue(second.baseline);
  await expect(page.locator("#metric")).toHaveValue("speed");
  let workspace = await (await request.get("/api/workspace")).json();
  expect(workspace.comparisons.items).toHaveLength(1);
  expect(workspace.comparisons.items[0].entries).toEqual(second.entries);
  await page.locator("#delete-comparison").click();
  await page.locator("#comparison-delete-yes").click();
  await settled(page);
  await expect(page.locator("#comparison-name")).toHaveText(
    "Untitled comparison",
  );
  await expect(page.locator("#delete-comparison")).toBeDisabled();
  await expect(page.locator("#new-comparison")).toBeDisabled();
  workspace = await (await request.get("/api/workspace")).json();
  expect(workspace.comparisons.items).toHaveLength(1);
  expect(workspace.comparisons.items[0].entries).toEqual([]);
  expect(workspace.comparisons.items[0].road).toBeNull();
  expect(workspace.rides).toHaveLength(ridesBefore);
  // An unnamed populated comparison can be deleted without naming it first.
  await selectRange(page, 100, 200);
  await page.locator("#add-stretch").click();
  await settled(page);
  await page.locator("#delete-comparison").click();
  await page.locator("#comparison-delete-yes").click();
  await settled(page);
  await expect(page.locator("#comparison-name-editor")).toBeHidden();
  await page.reload();
  await settled(page);
  await expect(page.locator("#comparison-switch option")).toHaveCount(1);
  await expect(page.locator("#delete-comparison")).toBeDisabled();
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
});

test("clicking an activity name renames its label while preserving files, notes, comparisons and duplicate detection", async ({
  page,
  request,
}) => {
  const raw = fixture.replace("Uploaded fixture", "Rename fixture");
  const upload = () =>
    request.post("/api/import", {
      data: raw,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "original-activity.gpx",
      },
    });
  expect((await upload()).ok()).toBeTruthy();
  const before = (
    await (await request.get("/api/workspace")).json()
  ).rides.find((r) => r.source === "original-activity.gpx");
  const notes = {
    bike: "Road bike",
    gearing: "34/32",
    conditions: "Calm",
    notes: "Keep these notes",
  };
  expect(
    (
      await request.patch(`/api/rides/${before.id}`, {
        data: { name: before.name, notes },
      })
    ).ok(),
  ).toBeTruthy();
  const range = { rideId: before.id, start: 0, end: 1 };
  const context = {
    id: "rename-context",
    name: "Rename hill",
    entries: [{ id: "rename-entry", ...range, kind: "source" }],
    road: range,
    selected: [before.id],
    browse: range,
    baseline: "rename-entry",
    comparison: "rename-entry",
    metric: "ele",
    settings: {},
  };
  expect(
    (
      await request.put("/api/comparisons", {
        data: { activeId: context.id, items: [context] },
      })
    ).ok(),
  ).toBeTruthy();
  const original = await (await request.get(`/api/rides/${before.id}`)).json();
  await page.goto("/");
  await settled(page);
  const nameButton = () => page.locator(`[data-ride-rename="${before.id}"]`);
  await nameButton().click();
  await page.locator("[data-ride-name-input]").fill("Discard this");
  await page.locator("[data-ride-name-cancel]").click();
  await expect(nameButton()).toHaveText(before.name);
  await nameButton().click();
  await page.locator("[data-ride-name-input]").fill("   ");
  await page.locator("[data-ride-name-form] button[type=submit]").click();
  await expect(page.locator("[data-ride-name-error]")).toContainText(
    "Enter an activity name",
  );
  await page.locator("[data-ride-name-input]").fill("Evening hill <steady>");
  await page.locator("[data-ride-name-input]").press("Enter");
  await settled(page);
  await expect(nameButton()).toHaveText("Evening hill <steady>");
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Evening hill <steady>",
  );
  await expect(page.locator("#baseline")).toContainText(
    "Evening hill <steady>",
  );
  const after = await (await request.get(`/api/rides/${before.id}`)).json();
  expect(after).toEqual({ ...original, name: "Evening hill <steady>" });
  await page.reload();
  await settled(page);
  await expect(nameButton()).toHaveText("Evening hill <steady>");
  const duplicate = await (await upload()).json();
  expect(duplicate.imported).toBe(0);
  expect(duplicate.duplicates).toBe(1);
  expect(
    (await (await request.get(`/api/rides/${before.id}`)).json()).name,
  ).toBe("Evening hill <steady>");
  const backup = JSON.parse(
    gunzipSync(await (await request.get("/api/backup")).body()),
  );
  expect(backup.rides.find((r) => r.id === before.id).source).toBe(
    "original-activity.gpx",
  );
  expect(backup.rides.find((r) => r.id === before.id).name).toBe(
    "Evening hill <steady>",
  );
  expect(backup.comparisons.items[0].entries).toEqual(context.entries);
  expect(
    (
      await request.patch(`/api/rides/${before.id}`, { data: { name: " " } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.patch(`/api/rides/${before.id}`, {
        data: { name: "x".repeat(161) },
      })
    ).status(),
  ).toBe(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await nameButton().click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

test("comparison API rejects collisions and restores atomically while keeping old backups compatible", async ({
  request,
}) => {
  await seedDemo(request);
  const road = { rideId: "demo-0", start: 414, end: 550 };
  const c = {
    id: "api-context",
    name: "API hill",
    entries: [{ id: "api-entry", ...road, kind: "source" }],
    road,
    selected: ["demo-0", "demo-1"],
    browse: { rideId: "demo-1", start: 0, end: 100 },
    settings: {},
  };
  const save = await request.put("/api/comparisons", {
    data: { activeId: c.id, items: [c] },
  });
  expect(save.ok()).toBeTruthy();
  const collision = await request.put("/api/comparisons", {
    data: {
      activeId: c.id,
      items: [c, { ...c, id: "other", name: " api  HILL " }],
    },
  });
  expect(collision.status()).toBe(400);
  expect(
    (await request.delete("/api/rides/demo-0", { data: {} })).status(),
  ).toBe(400);
  const before = await (await request.get("/api/workspace")).json();
  const backup = JSON.parse(
    gunzipSync(await (await request.get("/api/backup")).body()).toString(),
  );
  const malformed = structuredClone(backup);
  malformed.settings.units =
    before.settings.units === "metric" ? "imperial" : "metric";
  malformed.comparisons.items[0].entries[0].rideId = "missing";
  const rejected = await request.post("/api/restore", {
    data: Buffer.from(JSON.stringify(malformed)),
    headers: { "content-type": "application/octet-stream" },
  });
  expect(rejected.status()).toBe(400);
  const after = await (await request.get("/api/workspace")).json();
  expect(after.comparisons).toEqual(before.comparisons);
  expect(after.settings).toEqual(before.settings);
  expect(after.rides.length).toBe(before.rides.length);
  delete backup.comparisons;
  expect(
    (
      await request.post("/api/restore", {
        data: Buffer.from(JSON.stringify(backup)),
        headers: { "content-type": "application/octet-stream" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await request.delete("/api/rides/demo-1", { data: {} })).ok(),
  ).toBeTruthy();
  const cleaned = (await (await request.get("/api/workspace")).json())
    .comparisons.items[0];
  expect(cleaned.browse).toBeNull();
  expect(cleaned.selected).not.toContain("demo-1");
});
