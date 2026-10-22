import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../lib/store.mjs";
import {
  buildHillObservations,
  validateHillLibrary,
  pruneHillLibrary,
  summarizeHillGroups,
  hillMembership,
} from "../lib/hills.mjs";

test("hill membership follows saved IDs across new comparison IDs and independently trimmed timing bounds", () => {
  const a = {
      id: "saved-original-a",
      rideId: "ride",
      start: 10,
      end: 60,
      alignment: { version: 1, reviewed: true, sourceStart: 10, sourceEnd: 70 },
    },
    lap = { id: "saved-lap-2", rideId: "ride", start: 110, end: 160 },
    library = {
      groups: [
        { id: "hill", name: "Physical hill", observationIds: [a.id, lap.id] },
      ],
    },
    observations = [a, lap];
  assert.equal(
    hillMembership(
      {
        id: "new-entry",
        rideId: "ride",
        start: 10.4,
        end: 69.4,
        hillObservationId: a.id,
        hillGroupId: "stale",
      },
      library,
      observations,
    ).observation,
    a,
  );
  assert.equal(
    hillMembership(
      { id: "original-a", rideId: "ride", start: 10, end: 70 },
      library,
      observations,
    ).observation,
    a,
  );
  assert.equal(
    hillMembership(
      { id: "legacy", rideId: "ride", start: 10, end: 70 },
      library,
      observations,
    ).group.id,
    "hill",
  );
  assert.equal(
    hillMembership(
      {
        id: "unrelated",
        rideId: "ride",
        start: 50,
        end: 100,
        hillGroupId: "hill",
      },
      library,
      observations,
    ),
    null,
  );
  assert.equal(
    hillMembership(
      {
        id: "new-entry",
        rideId: "different",
        start: 10,
        end: 70,
        hillObservationId: a.id,
      },
      library,
      observations,
    ),
    null,
  );
  const duplicate = { ...a, id: "saved-ambiguous" };
  assert.equal(
    hillMembership(
      { id: "legacy", rideId: "ride", start: 10, end: 70 },
      {
        groups: [
          { ...library.groups[0], observationIds: [a.id, duplicate.id] },
        ],
      },
      [a, duplicate],
    ),
    null,
  );
  assert.equal(
    hillMembership(
      { id: "original-a", rideId: "ride", start: 10, end: 70 },
      { groups: [] },
      observations,
    ),
    null,
  );
  const legacy = { id: "detected-old", rideId: "ride", start: 10, end: 70 };
  assert.equal(
    hillMembership(
      {
        id: "copied",
        rideId: "ride",
        start: 10.4,
        end: 69.4,
        hillObservationId: legacy.id,
      },
      library,
      [...observations, legacy],
    ).observation,
    a,
  );
});

test("terrain exploration has one point per named hill and weights rides rather than pass counts", () => {
  const observations = [
    {
      id: "a1",
      rideId: "a",
      length: 100,
      netGain: 10,
      avgGrade: 10,
      meanSpeed: 2,
      meanHr: null,
    },
    {
      id: "a2",
      rideId: "a",
      length: 200,
      netGain: 20,
      avgGrade: 10,
      meanSpeed: 4,
      meanHr: null,
    },
    {
      id: "b1",
      rideId: "b",
      length: 350,
      netGain: 40,
      avgGrade: 12,
      meanSpeed: 9,
      meanHr: 0,
    },
    {
      id: "other",
      rideId: "a",
      length: 500,
      netGain: 50,
      avgGrade: 10,
      meanSpeed: 5,
      meanHr: 120,
    },
  ];
  const original = structuredClone(observations);
  const result = summarizeHillGroups(
    {
      groups: [
        {
          id: "one",
          name: "One physical hill",
          observationIds: ["a1", "a2", "b1"],
        },
        { id: "two", name: "Different hill", observationIds: ["other"] },
      ],
    },
    observations,
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].length, 250);
  assert.equal(result[0].meanSpeed, 6);
  assert.deepEqual(result[0].ranges.length, { min: 150, max: 350, rides: 2 });
  assert.equal(result[0].meanHr, 0);
  assert.equal(result[0].ranges.meanHr.rides, 1);
  assert.equal(result[0].members.length, 3);
  assert.deepEqual(observations, original);
});

const hillRide = (id = "ride") => ({
  id,
  name: `Ride ${id}`,
  date: "2026-10-15T08:00:00.000Z",
  source: `${id}.fit`,
  notes: { bike: "Blue bike", notes: "Keep me" },
  points: Array.from({ length: 101 }, (_, i) => ({
    t: Date.UTC(2026, 9, 15, 8) + i * 2000,
    d: i * 10,
    lat: 45 + (i * 10) / 111195,
    lon: -72,
    ele:
      i < 10
        ? 100
        : i <= 50
          ? 100 + i - 10
          : i <= 60
            ? 140 - (i - 50)
            : 130 + (i - 60) / 2,
    speed: 5,
    hr: null,
    cad: 0,
    power: 0,
    temp: null,
    timer: null,
  })),
});

test("hill catalog describes every ride using terrain, physical sustained ramps and original recording positions", () => {
  const rides = [hillRide("one"), hillRide("two")],
    original = structuredClone(rides),
    observations = buildHillObservations(rides);
  assert.equal(observations.length, 4);
  const hill = observations[0];
  assert.equal(hill.id, "one:hill-10-50");
  assert.equal(hill.length, 400);
  assert.equal(hill.netGain, 40);
  assert.equal(hill.avgGrade, 10);
  assert.equal(hill.elapsed, 80);
  assert.equal(hill.positionDistance, 100);
  assert.equal(hill.positionSeconds, 20);
  assert.equal(hill.steepestGrade, 10);
  assert.equal(hill.steepestRamp.length, 50);
  assert.equal(hill.steepestRamp.end - hill.steepestRamp.start, 5);
  assert.equal(hill.steepestProgress, 25 / 400);
  assert.equal(hill.approachSpeed, 5);
  assert.equal(hill.meanHr, null);
  assert.equal(hill.meanPower, 0);
  assert.equal(hill.meanCad, 0);
  assert.equal(hill.bike, "Blue bike");
  assert.deepEqual(rides, original);
  rides[0].name = "A display name";
  rides[0].points.forEach((p) => {
    p.speed = 1;
    p.hr = 190;
  });
  const changed = buildHillObservations(rides);
  assert.deepEqual(
    changed.map((o) => [o.id, o.start, o.end, o.netGain]),
    observations.map((o) => [o.id, o.start, o.end, o.netGain]),
  );
});

test("hill observations keep separate recording passes and never fill absent terrain", () => {
  const ride = hillRide("loops");
  ride.points = Array.from({ length: 121 }, (_, i) => {
    const local = i % 60;
    return {
      ...hillRide().points[0],
      t: i * 2000,
      d: i * 10,
      lat: 45 + local / 11119.5,
      ele: local <= 40 ? local : 80 - local,
    };
  });
  const observations = buildHillObservations([ride]);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].start, 0);
  assert.equal(observations[1].start, 60);
  assert.notEqual(observations[0].id, observations[1].id);
  assert.equal(observations[0].length, observations[1].length);
  assert.equal(observations[0].positionSeconds, 0);
  assert.equal(observations[1].positionSeconds, 120);
  ride.points.forEach((p) => (p.ele = null));
  assert.deepEqual(buildHillObservations([ride]), []);
});

test("hill identities validate explicit reversible membership, unique normalized names and available observations", () => {
  const observations = buildHillObservations([
      hillRide("one"),
      hillRide("two"),
    ]),
    group = {
      id: "identity",
      name: "  Home   hill  ",
      observationIds: [observations[0].id, observations[2].id],
    };
  const library = validateHillLibrary({ groups: [group] }, observations);
  assert.equal(library.groups[0].name, "Home hill");
  assert.deepEqual(validateHillLibrary({ groups: [] }, observations), {
    groups: [],
  });
  for (const groups of [
    [group, { ...group }],
    [
      group,
      {
        id: "another",
        name: "ＨＯＭＥ hill",
        observationIds: [observations[1].id],
      },
    ],
    [{ ...group, observationIds: [] }],
    [{ ...group, observationIds: ["missing"] }],
    [{ ...group, observationIds: [observations[0].id, observations[0].id] }],
    [
      group,
      {
        id: "another",
        name: "Other hill",
        observationIds: [observations[2].id],
      },
    ],
  ])
    assert.throws(() => validateHillLibrary({ groups }, observations));
  assert.deepEqual(
    pruneHillLibrary(
      library,
      observations.filter((o) => o.rideId === "two"),
    ),
    {
      groups: [{ ...library.groups[0], observationIds: [observations[2].id] }],
    },
  );
  assert.deepEqual(pruneHillLibrary(library, []), { groups: [] });
});

test("hill persistence backs up existing stores before migration and preserves raw compressed tracks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "noboride-hills-store-")),
    path = join(dir, "old.sqlite");
  try {
    let store = new Store(path);
    const ride = hillRide(),
      original = structuredClone(ride);
    store.add(ride);
    store.saveSettings({ gradeWindow: 80 });
    store.saveComparisons({ activeId: "kept", items: [] });
    const bytes = store.db
      .prepare("SELECT track FROM rides WHERE id=?")
      .get(ride.id).track;
    store.db.exec("DROP TABLE hill_library");
    store.close();
    store = new Store(path);
    const backups = (await readdir(dir)).filter((p) =>
      p.includes("before-hills"),
    );
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(join(dir, backups[0]), { readOnly: true });
    assert.equal(
      backup
        .prepare("SELECT name FROM sqlite_master WHERE name='hill_library'")
        .get(),
      undefined,
    );
    assert.deepEqual(
      backup.prepare("SELECT track FROM rides WHERE id=?").get(ride.id).track,
      bytes,
    );
    backup.close();
    assert.deepEqual(store.get(ride.id).points, original.points);
    assert.deepEqual(store.get(ride.id).notes, original.notes);
    assert.equal(store.settings().gradeWindow, 80);
    assert.equal(store.comparisons().activeId, "kept");
    const observation = buildHillObservations([ride])[0],
      library = {
        groups: [
          {
            id: "identity",
            name: "Home hill",
            observationIds: [observation.id],
          },
        ],
      };
    store.saveHillLibrary(library);
    store.close();
    store = new Store(path);
    assert.deepEqual(store.hillLibrary(), library);
    assert.deepEqual(
      store.db.prepare("SELECT track FROM rides WHERE id=?").get(ride.id).track,
      bytes,
    );
    store.close();
    assert.equal(
      (await readdir(dir)).filter((p) => p.includes("before-hills")).length,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function isolatedServer() {
  const dir = await mkdtemp(join(tmpdir(), "noboride-hills-api-")),
    probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ["server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT: String(port), NOBORIDE_DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    }),
    exited = once(child, "exit");
  try {
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
          () => reject(new Error(`Startup timed out: ${output}`)),
          10000,
        ),
        finish = (error) => {
          clearTimeout(timer);
          error ? reject(error) : resolve();
        };
      child.stdout.on("data", (data) => {
        output += data;
        if (output.includes("Listening on")) finish();
      });
      child.stderr.on("data", (data) => (output += data));
      child.once("error", finish);
      child.once("exit", () => finish(new Error(output)));
    });
  } catch (error) {
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    request: (path, method = "GET", body) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      }),
    close: async () => {
      child.kill();
      await exited;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("hill API backups merge identities transactionally, reject invalid restores and prune deleted ride memberships", async () => {
  const server = await isolatedServer();
  try {
    const rides = [hillRide("one"), hillRide("two")],
      backup = { schemaVersion: 1, rides, segments: [], settings: {} };
    assert.equal(
      (await server.request("/api/restore", "POST", backup)).status,
      200,
    );
    let catalog = await (await server.request("/api/hills")).json();
    assert.equal(catalog.observations.length, 4);
    const library = {
      groups: [
        {
          id: "identity",
          name: "Shared hill",
          observationIds: [
            catalog.observations[0].id,
            catalog.observations[2].id,
          ],
        },
      ],
    };
    assert.equal(
      (await server.request("/api/hills", "PUT", library)).status,
      200,
    );
    const savedBackup = JSON.parse(
      gunzipSync(
        Buffer.from(await (await server.request("/api/backup")).arrayBuffer()),
      ),
    );
    assert.deepEqual(savedBackup.hillLibrary, library);
    assert.deepEqual(savedBackup.rides[0].points, rides[0].points);
    assert.equal(
      (await server.request("/api/hills", "PUT", { groups: [] })).status,
      200,
    );
    assert.equal(
      (await server.request("/api/restore", "POST", savedBackup)).status,
      200,
    );
    catalog = await (await server.request("/api/hills")).json();
    assert.deepEqual(catalog.library, library);
    const invalidBackup = {
      ...backup,
      rides: [hillRide("rollback")],
      hillLibrary: {
        groups: [
          { id: "invalid", name: "Invalid", observationIds: ["missing"] },
        ],
      },
    };
    assert.equal(
      (await server.request("/api/restore", "POST", invalidBackup)).status,
      400,
    );
    assert.equal((await server.request("/api/rides/rollback")).status, 404);
    assert.deepEqual(
      (await (await server.request("/api/hills")).json()).library,
      library,
    );
    assert.equal(
      (await server.request("/api/rides/one", "PATCH", { name: "Renamed" }))
        .status,
      200,
    );
    assert.equal(
      (await (await server.request("/api/hills")).json()).observations.find(
        (o) => o.rideId === "one",
      ).rideName,
      "Renamed",
    );
    assert.equal(
      (await server.request("/api/rides/one", "DELETE", {})).status,
      200,
    );
    catalog = await (await server.request("/api/hills")).json();
    assert.equal(catalog.observations.length, 2);
    assert.deepEqual(catalog.library.groups[0].observationIds, [
      library.groups[0].observationIds[1],
    ]);
    assert.equal(
      (await server.request("/api/rides/two", "DELETE", {})).status,
      200,
    );
    assert.deepEqual(
      (await (await server.request("/api/hills")).json()).library,
      { groups: [] },
    );
    assert.equal(
      (await server.request("/api/restore", "POST", savedBackup)).status,
      200,
    );
    assert.deepEqual(
      (await (await server.request("/api/hills")).json()).library,
      library,
    );
  } finally {
    await server.close();
  }
});
