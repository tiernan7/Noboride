import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = `<gpx><trk><name>Uploaded fixture</name><trkseg><trkpt lat="45" lon="-122"><ele>100</ele><time>2026-10-01T10:00:00Z</time></trkpt><trkpt lat="45.001" lon="-122"><ele>110</ele><time>2026-10-01T10:00:10Z</time></trkpt></trkseg></trk></gpx>`;
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
  await page.goto("/");
  await expect(page).toHaveTitle("Noboride · Same road. Clearer answers.");
  await expect(page.getByRole("link", { name: "Noboride home" })).toBeVisible();
  await expect(page.locator("#welcome")).toBeVisible();
  await page.locator("#demo").click();
  await expect(page.locator("#matches tbody tr")).toHaveCount(3);
  await expect(page.locator("#messages .notice")).toHaveCount(0);
  await page.locator("#scope").selectOption("demo-hill");
  await expect(page.locator("#matches tbody tr")).toHaveCount(3);
  await expect(page.locator("#budget-panel")).toBeVisible();
  await page.locator("#metric").selectOption("delta");
  await expect(page.locator("#comparison-chart svg path")).toHaveCount(3);
  await page.locator("#grade-window").fill("25");
  await page.locator("#grade-window").dispatchEvent("input");
  await expect(page.locator("#grade-window-value")).toHaveText("25 m");
  const refId = await page.locator("#reference").inputValue();
  const ride = await (await request.get(`/api/rides/${refId}`)).json();
  const p = ride.points[430];
  await page.locator("#start-coordinate").fill(`${p.lat}, ${p.lon}`);
  await page.locator("#snap-start").click();
  await expect(page.locator("#scope")).toHaveValue("draft");
  await expect(page.locator("#start-range")).toHaveValue("430");
  const box = await page.locator("#profile svg").boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.5, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.locator("#scope")).toHaveValue("draft");
  await page.locator("#section-name").fill("My matched hill");
  await page.locator("#save-section").click();
  await expect(page.locator("#scope option:checked")).toHaveText(
    "My matched hill",
  );
  await expect(page.locator("#messages .notice")).toHaveCount(0);
  await page.locator("[data-adjust]").first().click();
  await expect(page.locator("#manual-dialog")).toBeVisible();
  await page.locator("#save-manual").click();
  await expect(page.locator("#matches tbody")).toContainText("manual");
  await page.locator("#save-section").click();
  await expect(page.locator("#messages .notice")).toHaveCount(0);
  const ws = await (await request.get("/api/workspace")).json();
  const saved = ws.segments.find((s) => s.name === "My matched hill");
  expect(Object.keys(saved.overrides)).toHaveLength(1);
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
  await page.locator("#files").setInputFiles({
    name: "upload.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(fixture),
  });
  await expect(page.locator("#report-title")).toContainText("1 duplicates");
  await page.locator("#files").setInputFiles({
    name: "public-real-track.gpx",
    mimeType: "application/gpx+xml",
    buffer: readFileSync(
      new URL("../fixtures/cerknicko-jezero.gpx", import.meta.url),
    ),
  });
  await expect(page.locator("#report-title")).toContainText("7 imported");
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
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: "artifacts/dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("legacy included rides carry over and Noboride selections take precedence", async ({
  page,
  request,
}) => {
  await request.post("/api/demo");
  const workspace = await (await request.get("/api/workspace")).json();
  const ids = workspace.rides.map((r) => r.id);
  await page.addInitScript((id) => {
    localStorage.setItem("ridescope-included", JSON.stringify([id]));
  }, ids[0]);
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("noboride-included")))
    .toBe(JSON.stringify([ids[0]]));
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  await page.evaluate((id) => {
    localStorage.setItem("noboride-included", JSON.stringify([id]));
  }, ids[1]);
  await page.reload();
  await expect(page.locator("#matches tbody tr")).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("noboride-included")),
  ).toBe(JSON.stringify([ids[1]]));
  // An intentionally empty new selection must not fall back to the legacy key.
  await page.evaluate(() => localStorage.setItem("noboride-included", "[]"));
  await page.reload();
  await expect(page.locator("#matches tbody tr")).toHaveCount(0);
});
