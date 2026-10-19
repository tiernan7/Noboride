import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULTS, summarize } from "./analysis.mjs";
export class Store {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS rides(id TEXT PRIMARY KEY,meta TEXT NOT NULL,track BLOB NOT NULL); CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS prefs(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);`,
    );
  }
  list() {
    return this.db
      .prepare(
        "SELECT meta FROM rides ORDER BY json_extract(meta,'$.date') DESC",
      )
      .all()
      .map((r) => ({ ...JSON.parse(r.meta), points: [] }));
  }
  get(id) {
    const r = this.db.prepare("SELECT * FROM rides WHERE id=?").get(id);
    return r
      ? {
          ...JSON.parse(r.meta),
          points: JSON.parse(gunzipSync(r.track).toString()),
        }
      : null;
  }
  add(ride) {
    const { points, ...meta } = ride;
    return (
      Number(
        this.db.prepare("INSERT OR IGNORE INTO rides VALUES(?,?,?)").run(
          ride.id,
          JSON.stringify({
            ...meta,
            pointCount: points.length,
            overview: summarize(points),
          }),
          gzipSync(JSON.stringify(points)),
        ).changes,
      ) > 0
    );
  }
  notes(id, name, notes) {
    const ride = this.get(id);
    if (!ride) throw new Error("Ride not found.");
    const { points, ...meta } = ride;
    this.db
      .prepare("UPDATE rides SET meta=? WHERE id=?")
      .run(JSON.stringify({ ...meta, name, notes }), id);
  }
  remove(id) {
    this.db.prepare("DELETE FROM rides WHERE id=?").run(id);
  }
  segments() {
    return this.db
      .prepare("SELECT value FROM segments")
      .all()
      .map((r) => JSON.parse(r.value));
  }
  saveSegment(s) {
    this.db
      .prepare("INSERT OR REPLACE INTO segments VALUES(?,?)")
      .run(s.id, JSON.stringify(s));
  }
  deleteSegment(id) {
    this.db.prepare("DELETE FROM segments WHERE id=?").run(id);
  }
  settings() {
    const r = this.db.prepare("SELECT value FROM prefs WHERE id=1").get();
    return { ...DEFAULTS, ...(r ? JSON.parse(r.value) : {}) };
  }
  saveSettings(s) {
    this.db
      .prepare("INSERT OR REPLACE INTO prefs VALUES(1,?)")
      .run(JSON.stringify(s));
  }
  transaction(fn) {
    this.db.exec("BEGIN");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
