import { atDistance, interpolate, lowerBound } from "./analysis.mjs";
// Mechanical energy components, not measured crank power.
export const STANDARD_GRAVITY = 9.80665;
export function validateGravityMasses(value) {
  const result = {};
  for (const [key, limit] of [
    ["riderMassKg", 350],
    ["bikeMassKg", 200],
  ]) {
    const mass = value[key] ?? null;
    if (mass !== null && (!Number.isFinite(mass) || mass <= 0 || mass > limit))
      throw new Error(
        `Invalid ${key}: enter a positive mass up to ${limit} kg, or leave it blank.`,
      );
    result[key] = mass;
  }
  return result;
}

export function gravityOnlyPower(points, masses, elevation = points) {
  const result = {
    watts: null,
    massKg: null,
    netGainMeters: null,
    elapsedSeconds: null,
    reason: "",
  };
  const unavailable = (reason) => ({ ...result, reason });
  try {
    const { riderMassKg, bikeMassKg } = validateGravityMasses(masses);
    if (riderMassKg == null || bikeMassKg == null)
      return unavailable("Enter rider and bike + equipment weights.");
    result.massKg = riderMassKg + bikeMassKg;
  } catch (error) {
    return unavailable(error.message);
  }
  if (
    !Array.isArray(points) ||
    points.length < 2 ||
    !Array.isArray(elevation) ||
    elevation.length < 2
  )
    return unavailable("Select a recorded climb with two endpoints.");
  const continuous = (samples) =>
    samples.every(
      (p, i) =>
        Number.isFinite(p.t) &&
        (!i ||
          (!p.breakBefore &&
            p.t > samples[i - 1].t &&
            p.t - samples[i - 1].t <= 30000)),
    );
  if (!continuous(points) || !continuous(elevation))
    return unavailable(
      "Unavailable across recording breaks or gaps over 30 seconds.",
    );
  result.elapsedSeconds = (points.at(-1).t - points[0].t) / 1000;
  if (!elevation.every((p) => Number.isFinite(p.ele)))
    return unavailable("Elevation is missing within the selected profile.");
  result.netGainMeters = elevation.at(-1).ele - elevation[0].ele;
  if (result.netGainMeters <= 0)
    return unavailable("This range has no net height gain.");
  result.watts =
    (result.massKg * STANDARD_GRAVITY * result.netGainMeters) /
    result.elapsedSeconds;
  return result;
}

export function validatePowerErrors(value) {
  const result = {};
  for (const [key, limit] of [
    ["powerHeightErrorM", 100],
    ["powerSpeedErrorMps", 20],
  ]) {
    const v = value[key] ?? null;
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > limit))
      throw new Error(`Invalid ${key}: use 0–${limit} or leave it blank.`);
    result[key] = v;
  }
  return result;
}

function prepared(points, elevationRequired = false) {
  const pointBad = [0],
    legBad = [0];
  points.forEach((p, i) => {
    pointBad.push(
      pointBad.at(-1) +
        Number(
          !Number.isFinite(p.t) ||
            !Number.isFinite(p.d) ||
            (elevationRequired && !Number.isFinite(p.ele)),
        ),
    );
    legBad.push(
      legBad.at(-1) +
        Number(
          i > 0 &&
            (p.breakBefore ||
              p.t <= points[i - 1].t ||
              p.t - points[i - 1].t > 30000 ||
              p.d < points[i - 1].d),
        ),
    );
  });
  function timeIndex(t) {
    let lo = 0,
      hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (points[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function valid(a, b, key, index) {
    let lo = index(a),
      hi = index(b);
    if (points[lo][key] > a && lo) lo--;
    return !(
      pointBad[hi + 1] - pointBad[lo] || legBad[hi + 1] - legBad[lo + 1]
    );
  }
  function atTime(t) {
    const i = timeIndex(t);
    return !i || points[i].t === t
      ? { ...points[i] }
      : interpolate(
          points[i - 1],
          points[i],
          (t - points[i - 1].t) / (points[i].t - points[i - 1].t),
        );
  }
  function speedEstimate(t) {
    const a = Math.max(points[0].t, t - 2500),
      b = Math.min(points.at(-1).t, t + 2500);
    if (b - a < 1000 || !valid(a, b, "t", timeIndex))
      return {
        speed: null,
        reason: "Speed needs at least one second of continuous data.",
      };
    const first = atTime(a),
      last = atTime(b),
      distanceSpeed = (last.d - first.d) / ((b - a) / 1000),
      samples = [first];
    for (let i = timeIndex(a); i < points.length && points[i].t < b; i++)
      if (points[i].t > a) samples.push(points[i]);
    samples.push(last);
    if (!samples.every((p) => Number.isFinite(p.speed) && p.speed >= 0))
      return {
        speed: distanceSpeed,
        reason: "Distance/time fallback; speed channel incomplete.",
      };
    let area = 0;
    for (let i = 1; i < samples.length; i++)
      area +=
        ((samples[i - 1].speed + samples[i].speed) / 2) *
        (samples[i].t - samples[i - 1].t);
    const speed = area / (b - a);
    // A conservative consistency screen, not a statistical outlier test or a
    // calibrated GPS error bound. Do not turn contradictory channels into watts.
    if (Math.abs(speed - distanceSpeed) > Math.max(2, speed * 0.25))
      return {
        speed: null,
        reason:
          "Distance/time and speed channel disagree (over 2 m/s and 25%); acceleration estimate unavailable.",
      };
    return {
      speed,
      reason:
        "Smoothed speed channel (may include import distance/time fallback).",
    };
  }
  return {
    points,
    atTime,
    speed: (t) => speedEstimate(t).speed,
    speedEstimate,
    validTime: (a, b) => valid(a, b, "t", timeIndex),
    validDistance: (a, b) => valid(a, b, "d", (d) => lowerBound(points, d)),
  };
}

function components(mass, height, seconds, startSpeed, endSpeed, settings) {
  const gravityWatts = (mass * STANDARD_GRAVITY * height) / seconds,
    kineticWatts =
      startSpeed == null || endSpeed == null
        ? null
        : (mass * (endSpeed ** 2 - startSpeed ** 2)) / (2 * seconds),
    minimumWatts =
      kineticWatts == null ? null : Math.max(0, gravityWatts + kineticWatts);
  let lowerWatts = null,
    upperWatts = null;
  const { powerHeightErrorM: h, powerSpeedErrorMps: v } =
    validatePowerErrors(settings);
  if (minimumWatts != null && h != null && v != null) {
    lowerWatts = Math.max(
      0,
      (mass * STANDARD_GRAVITY * (height - h) +
        (mass * (Math.max(0, endSpeed - v) ** 2 - (startSpeed + v) ** 2)) / 2) /
        seconds,
    );
    upperWatts = Math.max(
      0,
      (mass * STANDARD_GRAVITY * (height + h) +
        (mass * ((endSpeed + v) ** 2 - Math.max(0, startSpeed - v) ** 2)) / 2) /
        seconds,
    );
  }
  return {
    gravityWatts,
    kineticWatts,
    minimumWatts,
    lowerWatts,
    upperWatts,
    startSpeed,
    endSpeed,
  };
}

export function minimumInputPower(points, settings, elevation = points) {
  const base = gravityOnlyPower(points, settings, elevation),
    empty = {
      ...base,
      minimumWatts: null,
      kineticWatts: null,
      lowerWatts: null,
      upperWatts: null,
      startSpeed: null,
      endSpeed: null,
    };
  if (base.netGainMeters == null || base.massKg == null || !base.elapsedSeconds)
    return empty;
  const source = prepared(points);
  if (!source.validTime(points[0].t, points.at(-1).t))
    return {
      ...empty,
      reason: "Distance/time data are incomplete or discontinuous.",
    };
  const startSpeed = source.speed(points[0].t),
    endSpeed = source.speed(points.at(-1).t),
    energy = components(
      base.massKg,
      base.netGainMeters,
      base.elapsedSeconds,
      startSpeed,
      endSpeed,
      settings,
    );
  return {
    ...base,
    ...energy,
    reason:
      energy.minimumWatts == null
        ? source.speedEstimate(
            startSpeed == null ? points[0].t : points.at(-1).t,
          ).reason
        : "",
  };
}

// Local finite-distance energy balance. Windows can overlap; do not integrate
// their plotted values to reconstruct whole-range energy or claim exact instants.
export function averageMinimumProfile(rows) {
  let energy = 0,
    seconds = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i],
      dt = (b.t - a.t) / 1000;
    if (
      dt > 0 &&
      Number.isFinite(a.minimumWatts) &&
      Number.isFinite(b.minimumWatts)
    ) {
      energy += ((a.minimumWatts + b.minimumWatts) / 2) * dt;
      seconds += dt;
    }
  }
  const elapsedSeconds =
    rows.length > 1 ? (rows.at(-1).t - rows[0].t) / 1000 : 0;
  return {
    watts: seconds > 0 ? energy / seconds : null,
    supportedSeconds: seconds,
    elapsedSeconds,
    coverage: elapsedSeconds > 0 ? Math.min(1, seconds / elapsedSeconds) : 0,
  };
}
export function minimumInputProfile(points, settings, elevation = points) {
  const rows = [],
    summary = minimumInputPower(points, settings, elevation),
    windowMeters = settings.gradeWindow ?? 75;
  if (
    !Array.isArray(points) ||
    points.length < 2 ||
    !Array.isArray(elevation) ||
    elevation.length < 2 ||
    !Number.isFinite(windowMeters) ||
    windowMeters < 10 ||
    windowMeters > 300
  )
    return {
      rows,
      summary,
      windowMeters,
      reason: "Select a valid range and a 10–300 m window.",
    };
  let masses;
  try {
    masses = validateGravityMasses(settings);
    validatePowerErrors(settings);
  } catch (error) {
    return { rows, summary, windowMeters, reason: error.message };
  }
  if (masses.riderMassKg == null || masses.bikeMassKg == null)
    return {
      rows,
      summary,
      windowMeters,
      reason: "Enter rider and bike + equipment weights.",
    };
  const source = prepared(points),
    reference = prepared(elevation, true),
    start = points[0],
    end = points.at(-1),
    first = elevation[0],
    last = elevation.at(-1),
    distance = end.d - start.d,
    referenceDistance = last.d - first.d,
    mass = masses.riderMassKg + masses.bikeMassKg;
  if (!(distance > 0 && referenceDistance > 0 && end.t > start.t))
    return {
      rows,
      summary,
      windowMeters,
      reason: "A positive distance and elapsed range is needed.",
    };
  for (let i = 0; i <= 200; i++) {
    const t = start.t + ((end.t - start.t) * i) / 200,
      point = source.atTime(t),
      progress = Math.max(0, Math.min(1, (point.d - start.d) / distance)),
      station = first.d + progress * referenceDistance,
      left = Math.max(first.d, station - windowMeters / 2),
      right = Math.min(last.d, station + windowMeters / 2),
      aD = start.d + ((left - first.d) / referenceDistance) * distance,
      bD = start.d + ((right - first.d) / referenceDistance) * distance,
      a = atDistance(points, aD),
      b = atDistance(points, bD),
      refPoint = atDistance(elevation, station),
      row = {
        t,
        point,
        progress,
        d: point.d - start.d,
        elevation: null,
        gradePercent: null,
        gravityWatts: null,
        kineticWatts: null,
        minimumWatts: null,
        lowerWatts: null,
        upperWatts: null,
        reason: "Insufficient continuous elevation/distance/time support.",
      };
    const centerValid =
      source.validTime(t, t) && reference.validDistance(station, station);
    if (centerValid) row.elevation = refPoint.ele;
    if (
      centerValid &&
      right - left >= Math.max(5, windowMeters / 4) &&
      b.t > a.t &&
      source.validDistance(aD, bD) &&
      reference.validDistance(left, right)
    ) {
      const height =
          atDistance(elevation, right).ele - atDistance(elevation, left).ele,
        seconds = (b.t - a.t) / 1000,
        energy = components(
          mass,
          height,
          seconds,
          source.speed(a.t),
          source.speed(b.t),
          settings,
        );
      Object.assign(row, energy, {
        gradePercent: (100 * height) / (right - left),
        windowMeters: right - left,
        windowSeconds: seconds,
        reason:
          energy.minimumWatts == null
            ? source.speedEstimate(energy.startSpeed == null ? a.t : b.t).reason
            : "",
      });
    }
    if (!centerValid) row.point = null;
    rows.push(row);
  }
  return {
    rows,
    summary,
    average: averageMinimumProfile(rows),
    windowMeters,
    reason: "",
  };
}
