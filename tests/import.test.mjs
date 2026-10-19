import test from "node:test";
import assert from "node:assert/strict";
import { Encoder, Profile } from "@garmin/fitsdk";
import { zipSync, strToU8, gzipSync } from "fflate";
import { parseUpload, normalizeRide } from "../lib/import.mjs";
import { Store } from "../lib/store.mjs";
import { makeDemo } from "../lib/demo.mjs";
export const gpx = `<?xml version="1.0"?><gpx xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>A ride &amp; a hill</name><trkseg><trkpt lat="45" lon="-122"><ele>100</ele><time>2026-10-01T10:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>80</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt><trkpt lat="45.001" lon="-122"><ele>110</ele><time>2026-10-01T10:00:10Z</time></trkpt></trkseg></trk></gpx>`;
const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>2026-10-01T10:00:00Z</Id><Lap><TotalTimeSeconds>10</TotalTimeSeconds><Track><Trackpoint><Time>2026-10-01T10:00:00Z</Time><Position><LatitudeDegrees>45</LatitudeDegrees><LongitudeDegrees>-122</LongitudeDegrees></Position><AltitudeMeters>100</AltitudeMeters><DistanceMeters>0</DistanceMeters><HeartRateBpm><Value>145</Value></HeartRateBpm><Cadence>70</Cadence><Extensions><TPX><Watts>200</Watts><Speed>5</Speed></TPX></Extensions></Trackpoint><Trackpoint><Time>2026-10-01T10:00:10Z</Time><Position><LatitudeDegrees>45.001</LatitudeDegrees><LongitudeDegrees>-122</LongitudeDegrees></Position><AltitudeMeters>110</AltitudeMeters><DistanceMeters>100</DistanceMeters></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
test("timed GPX preserves GPS, altitude and Garmin sensor extensions", () => {
  const v = parseUpload(strToU8(gpx), "ride.gpx");
  assert.equal(v.rides.length, 1);
  assert.equal(v.rides[0].points[0].hr, 140);
  assert.equal(v.rides[0].points[0].cad, 80);
  assert.equal(v.rides[0].points[1].ele, 110);
  assert.ok(v.rides[0].points[1].d > 100);
});
test("TCX preserves device timer and distance, power and cadence", () => {
  const r = parseUpload(strToU8(tcx), "ride.tcx").rides[0];
  assert.equal(r.deviceTimer, 10);
  assert.equal(r.points[1].d, 100);
  assert.equal(r.points[0].power, 200);
  assert.equal(r.points[0].cad, 70);
});
test("GPX segment discontinuities are explicit", () => {
  const bytes = strToU8(
    gpx.replace(
      "</trkseg>",
      '</trkseg><trkseg><trkpt lat="46" lon="-122"><ele>100</ele><time>2026-10-01T10:00:15Z</time></trkpt></trkseg>',
    ),
  );
  const r = parseUpload(bytes, "split.gpx").rides[0];
  assert.equal(r.points[2].breakBefore, true);
  assert.equal(r.points[2].d, r.points[1].d);
});
test("nested Garmin-style ZIP and gzip activity imports work", () => {
  const inner = zipSync({ "ride.gpx": strToU8(gpx) }),
    outer = zipSync({
      "DI_CONNECT/activity.zip": inner,
      "summary.json": strToU8("{}"),
    });
  assert.equal(parseUpload(outer, "dump.zip").rides.length, 1);
  assert.equal(
    parseUpload(gzipSync(strToU8(gpx)), "ride.gpx.gz").rides.length,
    1,
  );
});
test("summary CSV, untimed GPX, malformed XML and external entities fail clearly", () => {
  for (const [bytes, name] of [
    [strToU8("Activity Type,Date,Distance"), "summary.csv"],
    [strToU8(gpx.replace(/<time>.*?<\/time>/g, "")), "route.gpx"],
    [strToU8("<gpx>"), "bad.gpx"],
    [
      strToU8('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><gpx/>'),
      "entity.gpx",
    ],
  ]) {
    const r = parseUpload(bytes, name);
    assert.equal(r.rides.length, 0);
    assert.ok(r.skipped.length > 0);
  }
});
test("official Garmin encoder/decoder roundtrip validates FIT coordinates and scales", () => {
  const encoder = new Encoder(),
    t0 = new Date("2026-10-01T10:00:00Z");
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "activity",
    manufacturer: "development",
    product: 1,
    timeCreated: t0,
  });
  for (let i = 0; i < 3; i++)
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(t0.getTime() + i * 10000),
      positionLat: Math.round(((45 + i * 0.001) * 2147483648) / 180),
      positionLong: Math.round((-122 * 2147483648) / 180),
      distance: i * 100,
      altitude: 100 + i * 5,
      speed: 10,
      heartRate: 150 + i,
      cadence: 75,
      power: 220,
    });
  encoder.onMesg(Profile.MesgNum.SESSION, {
    timestamp: new Date(t0.getTime() + 20000),
    startTime: t0,
    sport: "cycling",
    totalElapsedTime: 20,
    totalTimerTime: 18,
    totalDistance: 200,
  });
  const parsed = parseUpload(encoder.close(), "test.fit");
  assert.equal(parsed.skipped.length, 0, parsed.skipped.join());
  assert.equal(parsed.rides.length, 1);
  const r = parsed.rides[0];
  assert.ok(Math.abs(r.points[0].lat - 45) < 1e-5);
  assert.ok(Math.abs(r.points[0].lon + 122) < 1e-5);
  assert.equal(r.points[2].ele, 110);
  assert.equal(r.points[1].hr, 151);
  assert.equal(r.points[0].speed, 10);
  assert.equal(r.deviceTimer, 18);
});
test("corrupt FIT is rejected", () => {
  const r = parseUpload(new Uint8Array([0, 1, 2, 3]), "bad.fit");
  assert.equal(r.rides.length, 0);
  assert.ok(r.skipped.length);
});
test("content-based imports deduplicate and database transactions roll back", () => {
  const store = new Store(":memory:"),
    ride = parseUpload(strToU8(gpx), "ride.gpx").rides[0];
  assert.equal(store.add(ride), true);
  assert.equal(store.add({ ...ride, name: "renamed" }), false);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(ride.id).points.length, 2);
  store.notes(ride.id, "My hill", {
    bike: "Road",
    gearing: "34 × 28",
    conditions: "Windy",
    notes: "Standing",
  });
  assert.equal(store.get(ride.id).notes.bike, "Road");
  assert.throws(() =>
    store.transaction(() => {
      store.add({ ...ride, id: "another" });
      throw new Error("rollback");
    }),
  );
  assert.equal(store.list().length, 1);
  store.close();
});
test("distance resets are repaired and missing channels are not zero-filled", () => {
  const r = normalizeRide(
    {
      source: "test",
      name: "test",
      points: [
        { t: 1000, d: 100, lat: 45, lon: -122, ele: 100 },
        { t: 2000, d: 120, lat: 45.001, lon: -122, ele: 101 },
        { t: 3000, d: 0, lat: 45.001, lon: -122, ele: 102 },
        { t: 4000, d: 20, lat: 45.002, lon: -122, ele: 103 },
      ],
    },
    "x",
  );
  assert.deepEqual(
    r.points.map((p) => p.d),
    [0, 20, 20, 40],
  );
  assert.equal(r.points[0].hr, null);
});

test("empty GPX track before a valid timed track does not discard the file", () => {
  const bytes = strToU8(
    gpx.replace("<trk>", "<trk><name>Empty</name><trkseg/></trk><trk>"),
  );
  const result = parseUpload(bytes, "empty-sibling.gpx");
  assert.equal(result.rides.length, 1);
  assert.equal(result.rides[0].points.length, 2);
  assert.equal(result.skipped.length, 0);
});
test("empty TCX activity before a valid activity does not discard the file", () => {
  const bytes = strToU8(
    tcx.replace(
      '<Activity Sport="Biking">',
      '<Activity Sport="Biking"><Id>empty</Id></Activity><Activity Sport="Biking">',
    ),
  );
  const result = parseUpload(bytes, "empty-sibling.tcx");
  assert.equal(result.rides.length, 1);
  assert.equal(result.rides[0].points.length, 2);
});
