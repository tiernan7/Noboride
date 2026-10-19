import { createHash } from "node:crypto";
import { Decoder, Stream } from "@garmin/fitsdk";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { unzipSync, gunzipSync } from "fflate";
import { hasGPS, haversine } from "./analysis.mjs";
const MAX_FILE = 40 * 1024 * 1024,
  MAX_EXPANDED = 400 * 1024 * 1024;
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => {
  v = Array.isArray(v) ? v[0] : v;
  if (v != null && typeof v === "object") v = v["#text"];
  return v == null || v === "" || !Number.isFinite(Number(v))
    ? null
    : Number(v);
};
const time = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const point = (v) => ({
  t: NaN,
  d: NaN,
  lat: null,
  lon: null,
  ele: null,
  hr: null,
  speed: null,
  cad: null,
  power: null,
  temp: null,
  timer: null,
  ...v,
});
const bounded = (v, l, h) =>
  Number.isFinite(v) && v >= l && v <= h ? v : null;
const hash = (b, i) =>
  createHash("sha256").update(b).update(`:${i}`).digest("hex");
export function normalizeRide(raw, id) {
  const warnings = [...(raw.warnings || [])],
    points = [];
  let d = 0,
    offset = 0,
    prevRaw = 0,
    changes = 0;
  for (const source of raw.points
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)) {
    if (points.at(-1)?.t === source.t) continue;
    const p = { ...source };
    p.lat = bounded(p.lat, -90, 90);
    p.lon = bounded(p.lon, -180, 180);
    if (p.lat == null || p.lon == null) p.lat = p.lon = null;
    for (const [k, l, h] of [
      ["ele", -1000, 10000],
      ["hr", 20, 250],
      ["speed", 0, 60],
      ["cad", 0, 250],
      ["power", 0, 4000],
      ["temp", -60, 70],
    ])
      p[k] = bounded(p[k], l, h);
    const prev = points.at(-1),
      rawD = Number.isFinite(p.d) && p.d >= 0 ? p.d : null;
    if (rawD !== null) {
      if (prev && rawD < prevRaw - 10) {
        offset = d - rawD;
        changes++;
      }
      d = Math.max(d, rawD + offset);
      prevRaw = rawD;
    } else if (
      prev &&
      !p.breakBefore &&
      p.t - prev.t <= 30000 &&
      hasGPS(prev) &&
      hasGPS(p)
    ) {
      const delta = haversine(prev, p);
      if (delta / ((p.t - prev.t) / 1000) < 60) d += delta;
      else {
        p.breakBefore = true;
        changes++;
      }
    } else if (
      prev &&
      !p.breakBefore &&
      p.t - prev.t <= 30000 &&
      p.speed != null
    )
      d += (p.speed * (p.t - prev.t)) / 1000;
    p.d = d;
    if (prev && p.speed == null && !p.breakBefore && p.t - prev.t <= 30000)
      p.speed = (p.d - prev.d) / ((p.t - prev.t) / 1000);
    points.push(p);
  }
  if (points.length < 2)
    throw new Error(
      "No timed track: activity-list CSVs and untimed routes cannot support ride comparisons.",
    );
  const start = points[0].d;
  points.forEach((p) => (p.d -= start));
  if (changes)
    warnings.push(
      `${changes} distance resets or GPS jumps handled; inspect the route.`,
    );
  if (!points.some(hasGPS))
    warnings.push("No GPS channel. Road matching is unavailable.");
  else {
    const missingGPS = points.filter((p) => !hasGPS(p)).length;
    if (missingGPS)
      warnings.push(
        `GPS is missing on ${missingGPS}/${points.length} samples. Short gaps may be bridged for route verification; original samples remain missing.`,
      );
  }
  if (!points.some((p) => p.ele != null))
    warnings.push(
      "No elevation channel. Grade and terrain attribution are unavailable.",
    );
  if (!points.some((p) => p.hr != null))
    warnings.push("No recorded heart rate.");
  return {
    id,
    name: String(raw.name || raw.source).slice(0, 160),
    date: new Date(points[0].t).toISOString(),
    source: raw.source,
    sport: raw.sport || "cycling",
    points,
    deviceElapsed: raw.deviceElapsed ?? null,
    deviceTimer: raw.deviceTimer ?? null,
    deviceMoving: raw.deviceMoving ?? null,
    warnings,
    notes: { bike: "", gearing: "", conditions: "", notes: "" },
    demo: false,
  };
}
function fit(bytes, name) {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.isFIT()) throw new Error("Not a FIT file.");
  if (!decoder.checkIntegrity())
    throw new Error(
      "FIT integrity check failed; export the original file again.",
    );
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertDateTimesToDates: true,
    convertTypesToStrings: true,
    mergeHeartRates: true,
  });
  if (errors.length) throw new Error(`FIT decoder: ${String(errors[0])}`);
  const records = messages.recordMesgs || [],
    sessions = messages.sessionMesgs?.length ? messages.sessionMesgs : [{}],
    events = (messages.eventMesgs || [])
      .filter((e) => e.event === "timer")
      .sort((a, b) => time(a.timestamp) - time(b.timestamp));
  return sessions.flatMap((session, i) => {
    if (session.sport && !["cycling", "eBiking"].includes(session.sport))
      return [];
    const from = session.startTime ? time(session.startTime) : -Infinity,
      until = session.timestamp ? time(session.timestamp) : Infinity,
      rows = records.filter(
        (r) => time(r.timestamp) >= from && time(r.timestamp) <= until,
      );
    if (rows.length < 2) return [];
    let ei = 0,
      active = events.length ? true : null;
    const points = rows.map((r) => {
      const t = time(r.timestamp);
      while (ei < events.length && time(events[ei].timestamp) <= t) {
        const e = events[ei++];
        if (e.eventType === "start") active = true;
        else if (String(e.eventType).startsWith("stop")) active = false;
      }
      const lat = num(r.positionLat),
        lon = num(r.positionLong);
      return point({
        t,
        d: num(r.distance) ?? NaN,
        lat: lat === null ? null : (lat * 180) / 2147483648,
        lon: lon === null ? null : (lon * 180) / 2147483648,
        ele: num(r.enhancedAltitude) ?? num(r.altitude),
        speed: num(r.enhancedSpeed) ?? num(r.speed),
        hr: num(r.heartRate),
        cad: num(r.cadence),
        power: num(r.power),
        temp: num(r.temperature),
        timer: active,
      });
    });
    return [
      normalizeRide(
        {
          points,
          source: name,
          name: name
            .split("/")
            .at(-1)
            .replace(/\.fit$/i, ""),
          sport: session.sport,
          deviceElapsed: num(session.totalElapsedTime),
          deviceTimer: num(session.totalTimerTime),
          deviceMoving: num(session.totalMovingTime),
        },
        hash(bytes, i),
      ),
    ];
  });
}
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: "@_",
  processEntities: false,
  parseTagValue: false,
  isArray: (name) =>
    [
      "trk",
      "trkseg",
      "trkpt",
      "Activity",
      "Lap",
      "Track",
      "Trackpoint",
    ].includes(name),
});
function xml(bytes, name, ext) {
  const text = new TextDecoder().decode(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text))
    throw new Error("External-entity XML is unsupported.");
  if (XMLValidator.validate(text) !== true) throw new Error("Malformed XML.");
  const root = parser.parse(text);
  if (ext === "gpx")
    return list(root.gpx?.trk).flatMap((track, i) => {
      const points = list(track.trkseg).flatMap((seg, j) =>
        list(seg.trkpt).map((p, k) => {
          const ex = p.extensions?.TrackPointExtension || p.extensions || {};
          return point({
            t: time(p.time),
            lat: num(p["@_lat"]),
            lon: num(p["@_lon"]),
            ele: num(p.ele),
            hr: num(ex.hr),
            cad: num(ex.cad),
            power: num(p.extensions?.power),
            temp: num(ex.atemp),
            breakBefore: j > 0 && k === 0,
          });
        }),
      );
      // Exporters can include empty/untimed tracks before a usable activity.
      // One empty sibling must not discard every valid track in the file.
      if (points.filter((p) => Number.isFinite(p.t)).length < 2) return [];
      return [
        normalizeRide(
          { points, source: name, name: track.name || name },
          hash(bytes, i),
        ),
      ];
    });
  return list(root.TrainingCenterDatabase?.Activities?.Activity).flatMap(
    (a, i) => {
      if (
        !["biking", "cycling", "other"].includes(
          String(a["@_Sport"] || "Biking").toLowerCase(),
        )
      )
        return [];
      const laps = list(a.Lap),
        points = laps.flatMap((lap) =>
          list(lap.Track).flatMap((track) =>
            list(track.Trackpoint).map((p) => {
              const ex = p.Extensions?.TPX || {};
              return point({
                t: time(p.Time),
                d: num(p.DistanceMeters) ?? NaN,
                lat: num(p.Position?.LatitudeDegrees),
                lon: num(p.Position?.LongitudeDegrees),
                ele: num(p.AltitudeMeters),
                hr: num(p.HeartRateBpm?.Value),
                cad: num(p.Cadence),
                speed: num(ex.Speed),
                power: num(ex.Watts),
              });
            }),
          ),
        ),
        timer = laps.reduce(
          (sum, lap) => sum + (num(lap.TotalTimeSeconds) || 0),
          0,
        );
      if (points.filter((p) => Number.isFinite(p.t)).length < 2) return [];
      return [
        normalizeRide(
          {
            points,
            source: name,
            name: a.Notes || `Ride ${a.Id || name}`,
            deviceTimer: timer || null,
          },
          hash(bytes, i),
        ),
      ];
    },
  );
}
export function parseUpload(bytes, name) {
  const rides = [],
    skipped = [];
  let expanded = 0,
    count = 0;
  function visit(data, path, depth) {
    if (depth > 3) {
      skipped.push(`${path}: nested archive limit.`);
      return;
    }
    const ext = path.toLowerCase().split(".").at(-1);
    if (ext === "zip") {
      try {
        const files = unzipSync(data, {
          filter: (file) => {
            if (!/\.(fit|gpx|tcx|zip|gz)$/i.test(file.name)) return false;
            if (
              ++count > 2500 ||
              file.originalSize > MAX_FILE ||
              expanded + file.originalSize > MAX_EXPANDED
            ) {
              skipped.push(`${file.name}: archive size/count limit.`);
              return false;
            }
            expanded += file.originalSize;
            return true;
          },
        });
        for (const [entry, content] of Object.entries(files))
          visit(content, `${path}/${entry}`, depth + 1);
        if (!Object.keys(files).length)
          skipped.push(
            `${path}: no activity tracks. Garmin summary CSV/JSON files do not contain a GPS track.`,
          );
      } catch {
        skipped.push(`${path}: invalid or unsupported ZIP.`);
      }
      return;
    }
    if (ext === "gz") {
      if (
        data.length < 18 ||
        new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
          data.length - 4,
          true,
        ) > MAX_FILE
      ) {
        skipped.push(`${path}: oversized gzip file.`);
        return;
      }
      try {
        const out = gunzipSync(data);
        if (out.length > MAX_FILE) throw new Error();
        visit(out, path.slice(0, -3), depth + 1);
      } catch {
        skipped.push(`${path}: invalid/oversized gzip.`);
      }
      return;
    }
    if (!["fit", "gpx", "tcx"].includes(ext)) {
      skipped.push(`${path}: use original FIT, TCX, timed GPX or ZIP.`);
      return;
    }
    if (data.length > MAX_FILE) {
      skipped.push(`${path}: activity exceeds 40 MiB.`);
      return;
    }
    try {
      const parsed = ext === "fit" ? fit(data, path) : xml(data, path, ext);
      if (!parsed.length) skipped.push(`${path}: no cycling activity records.`);
      rides.push(...parsed);
    } catch (e) {
      skipped.push(`${path}: ${e.message}`);
    }
  }
  visit(bytes, name, 0);
  return { rides, skipped };
}
