import { test, expect } from "@playwright/test";
import { gunzipSync } from "node:zlib";

const settled = (page) =>
  expect(page.locator("body")).not.toHaveClass(/working/);
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
  await expect(page.locator('#story-map path[stroke="#172b42"]')).toHaveCount(
    1,
  );
  await page.locator("#story-axis").selectOption("t");
  await expect(page.locator("#start-range")).toHaveValue(String(start));
  await page.locator("#story-full").check();
  await expect(page.locator("#story-cursor")).toHaveAttribute("min", "0");
  await expect(page.locator("#story-cursor")).toHaveAttribute("max", "600");
  await page.locator("#climb-name").fill("Corrected hill <one>");
  for (const [id, value] of [
    ["climb-start", start + 2],
    ["climb-end", end - 2],
  ])
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  await page.locator("#climb-save").click();
  await settled(page);
  const after = await (await request.get("/api/rides/demo-0")).json();
  expect(after.points).toEqual(original.points);
  expect(after.notes).toEqual(original.notes);
  expect(after.source).toBe(original.source);
  expect(after.climbEdits).toEqual([
    {
      id: hillId,
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
  // Restore into a missing fixture ride, since merge restore intentionally retains existing metadata.
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
  expect(
    (await (await request.get("/api/rides/demo-0")).json()).climbEdits,
  ).toEqual(after.climbEdits);
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
