import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databasePath } from "../lib/paths.mjs";
import { Store } from "../lib/store.mjs";
import { makeDemo } from "../lib/demo.mjs";

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "noboride-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("new workspaces use Noboride paths and the new directory variable wins", (t) => {
  const root = temporaryRoot(t);
  assert.equal(databasePath(root, {}), join(root, "data", "noboride.sqlite"));
  assert.equal(
    databasePath(root, { RIDESCOPE_DATA_DIR: join(root, "old") }),
    join(root, "old", "noboride.sqlite"),
  );
  assert.equal(
    databasePath(root, {
      NOBORIDE_DATA_DIR: join(root, "new"),
      RIDESCOPE_DATA_DIR: join(root, "old"),
    }),
    join(root, "new", "noboride.sqlite"),
  );
});

test("legacy workspaces reopen with rides, notes, sections and settings intact", (t) => {
  const root = temporaryRoot(t);
  const legacy = join(root, "data", "ridescope.sqlite");
  const original = new Store(legacy);
  const ride = makeDemo().rides[0];
  original.add(ride);
  original.notes(ride.id, "My ride", { bike: "Road bike" });
  original.saveSegment({
    id: "hill",
    name: "Saved hill",
    referenceId: ride.id,
  });
  original.saveSettings({ gradeWindow: 75 });
  original.close();
  const path = databasePath(root, {});
  assert.equal(path, legacy);
  const reopened = new Store(path);
  try {
    assert.equal(reopened.get(ride.id).name, "My ride");
    assert.deepEqual(reopened.get(ride.id).points, ride.points);
    assert.equal(reopened.get(ride.id).notes.bike, "Road bike");
    assert.equal(reopened.segments()[0].name, "Saved hill");
    assert.equal(reopened.settings().gradeWindow, 75);
    assert.equal(existsSync(join(root, "data", "noboride.sqlite")), false);
  } finally {
    reopened.close();
  }
});

test("an existing Noboride database takes priority over a legacy database", (t) => {
  const root = temporaryRoot(t);
  const dir = join(root, "custom");
  for (const name of ["ridescope.sqlite", "noboride.sqlite"]) {
    const store = new Store(join(dir, name));
    store.close();
  }
  assert.equal(
    databasePath(root, { NOBORIDE_DATA_DIR: dir }),
    join(dir, "noboride.sqlite"),
  );
  assert.equal(
    databasePath(root, { RIDESCOPE_DATA_DIR: dir }),
    join(dir, "noboride.sqlite"),
  );
});
