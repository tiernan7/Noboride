import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { Store } from "./lib/store.mjs";
import { databasePath } from "./lib/paths.mjs";
import { validateComparisons } from "./lib/comparisons.mjs";
import { parseUpload, normalizeRide } from "./lib/import.mjs";
import { makeDemo } from "./lib/demo.mjs";
import { DEFAULTS } from "./lib/analysis.mjs";
import { validateClimbEdits } from "./lib/ride-story.mjs";
import { serverHost, allowedAuthorities } from "./lib/network.mjs";
const ROOT = fileURLToPath(new URL(".", import.meta.url)),
  PORT = Number(process.env.PORT || 4317),
  HOST = serverHost(process.argv.slice(2));
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)
  throw new Error("PORT must be 1024–65535.");
const authorities = allowedAuthorities(HOST, PORT);
const origins = new Set([...authorities].map((host) => `http://${host}`));
const dbPath = databasePath(ROOT);
const store = new Store(dbPath);
function send(res, status, value) {
  const b = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": b.length,
  });
  res.end(b);
}
async function readBody(req, limit = 200 * 1024 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const chunk of req) {
    n += chunk.length;
    if (n > limit)
      throw new Error(
        `Request exceeds ${Math.round(limit / 1024 / 1024)} MiB.`,
      );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const clean = (v, max) => String(v ?? "").slice(0, max);
function validSettings(v) {
  const out = { ...DEFAULTS };
  for (const [k, lo, hi] of [
    ["gradeWindow", 10, 300],
    ["gradeThreshold", 0.1, 10],
    ["movingThreshold", 0.1, 5],
    ["gapSeconds", 10, 300],
    ["matchRadius", 5, 100],
    ["suggestionOverlap", 10, 100],
  ]) {
    if (v[k] !== undefined) {
      if (!Number.isFinite(v[k]) || v[k] < lo || v[k] > hi)
        throw new Error(`Invalid ${k}.`);
      out[k] = v[k];
    }
  }
  out.units = v.units === "metric" ? "metric" : "imperial";
  return out;
}
function validSegment(v) {
  const r = store.get(String(v.referenceId));
  if (!r) throw new Error("Reference ride not found.");
  const a = Number(v.start),
    b = Number(v.end);
  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < 0 ||
    b >= r.points.length ||
    a >= b ||
    r.points[b].d - r.points[a].d < 20
  )
    throw new Error("Select at least 20 meters with valid start/end samples.");
  const overrides = {};
  for (const [id, o] of Object.entries(v.overrides || {})) {
    const ride = store.get(id);
    if (
      ride &&
      Number.isInteger(o.start) &&
      Number.isInteger(o.end) &&
      o.start >= 0 &&
      o.end < ride.points.length &&
      o.start < o.end
    )
      overrides[id] = { start: o.start, end: o.end };
  }
  return {
    id: typeof v.id === "string" ? clean(v.id, 120) : randomUUID(),
    name: clean(v.name, 120) || "Untitled section",
    referenceId: r.id,
    start: a,
    end: b,
    path: r.points.slice(a, b + 1),
    overrides,
    createdAt: new Date().toISOString(),
  };
}
async function api(req, res, path) {
  const method = req.method;
  if (!["GET", "HEAD"].includes(method)) {
    if (req.headers.origin && !origins.has(req.headers.origin))
      return send(res, 403, {
        error: "Requests must use this server's origin.",
      });
    if (
      !["/api/import", "/api/restore"].includes(path) &&
      !req.headers["content-type"]?.startsWith("application/json")
    )
      return send(res, 415, { error: "Use application/json." });
  }
  if (method === "GET" && path === "/api/workspace")
    return send(res, 200, {
      rides: store.list(),
      segments: store.segments(),
      settings: store.settings(),
      comparisons: store.comparisons(),
    });
  if (method === "PUT" && path === "/api/comparisons") {
    const value = validateComparisons(
      JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString()),
      (id) => store.get(id),
      validSettings,
    );
    store.saveComparisons(value);
    return send(res, 200, value);
  }
  if (method === "GET" && path.startsWith("/api/rides/")) {
    const r = store.get(path.slice(11));
    return send(res, r ? 200 : 404, r || { error: "Ride not found." });
  }
  if (method === "POST" && path === "/api/import") {
    if (!req.headers["x-file-name"]) throw new Error("Missing file name.");
    const name = decodeURIComponent(String(req.headers["x-file-name"]))
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        .slice(0, 250),
      parsed = parseUpload(await readBody(req), name);
    let imported = 0,
      duplicates = 0;
    store.transaction(() => {
      for (const r of parsed.rides) {
        if (store.add(r)) imported++;
        else duplicates++;
      }
    });
    return send(res, 200, {
      imported,
      duplicates,
      skipped: parsed.skipped,
      warnings: parsed.rides.flatMap((r) =>
        r.warnings.map((w) => `${r.name}: ${w}`),
      ),
    });
  }
  if (method === "POST" && path === "/api/demo") {
    const demo = makeDemo();
    store.transaction(() => {
      demo.rides.forEach((r) => store.add(r));
      if (!store.segments().some((s) => s.id === "demo-hill"))
        demo.segments.forEach((s) => store.saveSegment(s));
    });
    return send(res, 200, { ok: true });
  }
  if (method === "PUT" && path === "/api/settings") {
    const s = validSettings(
      JSON.parse((await readBody(req, 10000)).toString()),
    );
    store.saveSettings(s);
    return send(res, 200, s);
  }
  if (method === "POST" && path === "/api/segments") {
    const s = validSegment(
      JSON.parse((await readBody(req, 100000)).toString()),
    );
    store.saveSegment(s);
    return send(res, 200, s);
  }
  if (method === "DELETE" && path.startsWith("/api/segments/")) {
    store.deleteSegment(path.slice(14));
    return send(res, 200, { ok: true });
  }
  if (method === "PATCH" && path.startsWith("/api/rides/")) {
    const v = JSON.parse((await readBody(req, 100000)).toString());
    const ride = store.get(path.slice(11));
    if (!ride) throw new Error("Ride not found.");
    const name =
      v.name === undefined
        ? ride.name
        : typeof v.name === "string"
          ? v.name.trim()
          : "";
    if (!name || name.length > 160)
      throw new Error("Activity name must be 1–160 characters.");
    const climbEdits =
      v.climbEdits === undefined
        ? undefined
        : validateClimbEdits(v.climbEdits, ride.points);
    store.transaction(() => {
      store.notes(
        ride.id,
        name,
        v.notes === undefined
          ? ride.notes
          : {
              bike: clean(v.notes?.bike, 150),
              gearing: clean(v.notes?.gearing, 250),
              conditions: clean(v.notes?.conditions, 500),
              notes: clean(v.notes?.notes, 6000),
            },
      );
      if (climbEdits) store.climbEdits(ride.id, climbEdits);
    });
    return send(res, 200, { ok: true });
  }
  if (method === "DELETE" && path.startsWith("/api/rides/")) {
    const id = path.slice(11);
    const comparisons = store.comparisons();
    if (
      comparisons.items.some(
        (c) => c.road?.rideId === id || c.entries.some((e) => e.rideId === id),
      )
    )
      throw new Error(
        "This ride is used in a comparison. Remove its comparison stretches first.",
      );
    for (const c of comparisons.items) {
      c.selected = c.selected.filter((rideId) => rideId !== id);
      c.drafts = (c.drafts || []).filter((d) => d.rideId !== id);
      c.matchDecisions = (c.matchDecisions || []).filter(
        (decision) => decision.rideId !== id,
      );
      if (c.browse?.rideId === id) c.browse = null;
    }
    store.transaction(() => {
      store.remove(id);
      store.saveComparisons(comparisons);
    });
    return send(res, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/backup") {
    const out = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      rides: store.list().map((r) => store.get(r.id)),
      segments: store.segments(),
      settings: store.settings(),
      comparisons: store.comparisons(),
    };
    res.writeHead(200, {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="noboride-backup.json.gz"',
      "Cache-Control": "no-store",
    });
    res.end(gzipSync(JSON.stringify(out)));
    return;
  }
  if (method === "POST" && path === "/api/restore") {
    let bytes = await readBody(req);
    if (bytes[0] === 31 && bytes[1] === 139)
      bytes = gunzipSync(bytes, { maxOutputLength: 200 * 1024 * 1024 });
    const v = JSON.parse(bytes.toString());
    if (
      v.schemaVersion !== 1 ||
      !Array.isArray(v.rides) ||
      !Array.isArray(v.segments) ||
      v.rides.length > 10000
    )
      throw new Error("Not a supported Noboride v1 backup.");
    let imported = 0;
    store.transaction(() => {
      for (const r of v.rides) {
        if (
          typeof r.id !== "string" ||
          !Array.isArray(r.points) ||
          r.points.length < 2 ||
          r.points.length > 2000000
        )
          throw new Error("Invalid backup ride.");
        let t = -Infinity,
          d = -Infinity;
        for (const p of r.points) {
          if (
            !Number.isFinite(p.t) ||
            !Number.isFinite(p.d) ||
            p.t <= t ||
            p.d < d ||
            p.d < 0
          )
            throw new Error("Invalid backup track order.");
          for (const k of [
            "lat",
            "lon",
            "ele",
            "hr",
            "speed",
            "cad",
            "power",
            "temp",
          ])
            if (p[k] !== null && !Number.isFinite(p[k]))
              throw new Error("Invalid backup sensor value.");
          if (
            (p.lat !== null && Math.abs(p.lat) > 90) ||
            (p.lon !== null && Math.abs(p.lon) > 180)
          )
            throw new Error("Invalid GPS coordinates.");
          t = p.t;
          d = p.d;
        }
        const ride = {
          ...normalizeRide(r, clean(r.id, 150)),
          ...(r.climbEdits === undefined
            ? {}
            : { climbEdits: validateClimbEdits(r.climbEdits, r.points) }),
          name: clean(r.name, 160),
          demo: !!r.demo,
          notes: {
            bike: clean(r.notes?.bike, 150),
            gearing: clean(r.notes?.gearing, 250),
            conditions: clean(r.notes?.conditions, 500),
            notes: clean(r.notes?.notes, 6000),
          },
        };
        if (store.add(ride)) imported++;
      }
      for (const s of v.segments)
        if (store.get(String(s.referenceId)))
          store.saveSegment(validSegment(s));
      store.saveSettings(validSettings(v.settings || {}));
      if (v.comparisons) {
        const incoming = validateComparisons(
          v.comparisons,
          (id) => store.get(id),
          validSettings,
        );
        const current = store.comparisons();
        const merged = current.items
          .filter(
            (c) =>
              !incoming.items.some((x) => x.id === c.id) &&
              !(incoming.items.length && !c.name && !c.entries.length),
          )
          .concat(incoming.items);
        store.saveComparisons(
          validateComparisons(
            { items: merged, activeId: incoming.activeId || current.activeId },
            (id) => store.get(id),
            validSettings,
          ),
        );
      }
    });
    return send(res, 200, { imported });
  }
  send(res, 404, { error: "Endpoint not found." });
}
const staticFiles = {
  "/": "public/index.html",
  "/app.js": "public/app.js",
  "/workspace.js": "public/workspace.js",
  "/styles.css": "public/styles.css",
  "/analysis.mjs": "lib/analysis.mjs",
  "/comparisons.mjs": "lib/comparisons.mjs",
  "/ride-story.mjs": "lib/ride-story.mjs",
  "/ride-story.js": "public/ride-story.js",
  "/match-review.js": "public/match-review.js",
  "/leaflet.js": "node_modules/leaflet/dist/leaflet.js",
  "/leaflet.css": "node_modules/leaflet/dist/leaflet.css",
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  if (!authorities.has(req.headers.host))
    return send(res, 403, { error: "Invalid server host." });
  try {
    const path = new URL(req.url || "/", `http://127.0.0.1:${PORT}`).pathname;
    if (path.startsWith("/api/")) return await api(req, res, path);
    let target = staticFiles[path];
    if (
      /^\/images\/(layers|layers-2x|marker-icon|marker-icon-2x|marker-shadow)\.png$/.test(
        path,
      )
    )
      target = "node_modules/leaflet/dist" + path;
    if (!target) return send(res, 404, { error: "Not found." });
    const data = await readFile(resolve(ROOT, target));
    res.writeHead(200, {
      "Content-Type": mime[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});
server.requestTimeout = 120000;
server.listen(PORT, HOST, () =>
  console.log(
    `\nNoboride → ${[...authorities].map((host) => `http://${host}`).join("\n             ")}\nListening on ${HOST}\nLocal database: ${dbPath}\nPress Ctrl+C to stop.\n`,
  ),
);
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `Port ${PORT} is busy. Close another Noboride process or set PORT.`
      : e.message,
  );
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
