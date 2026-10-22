import { hillProfile } from "/hill-profile.mjs";
export function createHillSummary({
  host,
  state,
  getRide,
  esc,
  rideName,
  onCompare,
}) {
  host.innerHTML = `<div class="hill-list-heading"><div><p class="eyebrow">SAVED HILL</p><h3>Your hill, across rides</h3></div><label>Hill<select id="hill-summary-select"></select></label></div><p id="hill-summary-empty" class="subtle">Save a named hill from a comparison to explore it here.</p><div id="hill-summary-body" hidden><div class="hill-summary-controls"><label>Colour and ride feature<select id="hill-summary-metric"><option value="grade">Gradient</option><option value="speed">Recorded speed</option><option value="hr">Heart rate</option><option value="power">Measured power</option></select></label><label>Horizontal axis<select id="hill-summary-axis"><option value="progress">Hill progress (%)</option><option value="distance">Mapped distance</option></select></label><button id="hill-summary-compare" class="button">Open passes in Comparisons →</button></div><p id="hill-summary-status" class="hill-muted" role="status"></p><svg id="hill-summary-profile" role="img" aria-label="Hill profile filled by mean grade or ride feature, with recording variation"></svg><p id="hill-summary-value" class="hill-muted"></p><details id="hill-summary-recordings"><summary>Included recordings <span id="hill-summary-recording-count"></span></summary><div class="hill-actions"><button id="hill-summary-all" class="text-button">Include all</button><button id="hill-summary-none" class="text-button">Exclude all</button></div><div id="hill-summary-sources"></div></details></div>`;
  const $ = (id) => host.querySelector(`#${id}`);
  let catalog,
    result,
    profileStatus = "",
    key = "",
    generation = 0,
    lastWidth = 0,
    exclusions = {};
  try {
    exclusions = JSON.parse(
      localStorage.getItem("noboride-hill-summary-excluded") || "{}",
    );
    if (
      !exclusions ||
      Array.isArray(exclusions) ||
      typeof exclusions !== "object"
    )
      exclusions = {};
  } catch {}
  const group = () =>
    catalog?.library.groups.find(
      (g) => g.id === $("hill-summary-select").value,
    );
  const members = () =>
    catalog?.observations.filter((o) =>
      group()?.observationIds.includes(o.id),
    ) || [];
  const excludedIds = () =>
    new Set(
      Array.isArray(exclusions[group()?.id]) ? exclusions[group().id] : [],
    );
  const imperial = () => state.settings.units === "imperial";
  const saveExclusions = () => {
    localStorage.setItem(
      "noboride-hill-summary-excluded",
      JSON.stringify(exclusions),
    );
    key = "";
    load();
  };
  function options(values) {
    const old = $("hill-summary-select").value;
    $("hill-summary-select").innerHTML = values
      .map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`)
      .join("");
    if (values.some((g) => g.id === old)) $("hill-summary-select").value = old;
  }
  async function load() {
    const observations = members(),
      excluded = excludedIds(),
      included = observations.filter((o) => !excluded.has(o.id));
    $("hill-summary-empty").hidden = !!observations.length;
    $("hill-summary-body").hidden = !observations.length;
    if (!observations.length) {
      generation++;
      result = null;
      key = "";
      return;
    }
    $("hill-summary-sources").innerHTML = observations
      .map(
        (o) =>
          `<label class="hill-publish-row"><input type="checkbox" data-summary-member="${esc(o.id)}" ${excluded.has(o.id) ? "" : "checked"}><span>${esc(rideName(o.rideId))} · ${esc(o.name)}</span></label>`,
      )
      .join("");
    $("hill-summary-recording-count").textContent =
      `(${included.length}/${observations.length})`;
    $("hill-summary-compare").disabled = observations.length < 2;
    $("hill-summary-compare").textContent =
      `Open all ${observations.length} passes in Comparisons →`;
    const next = JSON.stringify([
      observations.map((o) => [o.id, o.start, o.end]),
      [...excluded],
      state.settings,
    ]);
    if (key === next && result) {
      $("hill-summary-status").textContent = profileStatus;
      return draw();
    }
    const turn = ++generation;
    result = null;
    $("hill-summary-profile").innerHTML = "";
    $("hill-summary-status").textContent =
      "Mapping vetted sections into the hill…";
    try {
      const rides = new Map(
        await Promise.all(
          [...new Set(observations.map((o) => o.rideId))].map(async (id) => [
            id,
            await getRide(id),
          ]),
        ),
      );
      if (turn !== generation) return;
      result = hillProfile(observations, (id) => rides.get(id), null, {
        ...state.settings,
        includedObservationIds: included.map((o) => o.id),
      });
      key = next;
      const counts = result.profile
          .map((p) => p.ele.rides)
          .filter((n) => n > 0),
        min = counts.length ? Math.min(...counts) : 0,
        max = counts.length ? Math.max(...counts) : 0;
      $("hill-summary-status").textContent =
        `${result.passes.length} of ${included.length} included sections mapped · ${new Set(result.passes.map((p) => p.observation.rideId)).size} rides · ${min}–${max} rides support each mapped portion${result.excluded.some((o) => !excluded.has(o.id)) ? " · some sections need review in Comparisons" : ""}`;
      const factor = imperial() ? 1609.344 : 1000,
        unit = imperial() ? "mi" : "km",
        lengths = observations.map((o) => o.length).filter(Number.isFinite);
      $("hill-summary-status").textContent +=
        ` · mapped span ≈${((result.length || 0) / factor).toFixed(2)} ${unit}${lengths.length ? ` · member sections ${(Math.min(...lengths) / factor).toFixed(2)}–${(Math.max(...lengths) / factor).toFixed(2)} ${unit} (coverage varies)` : ""}`;
      profileStatus = $("hill-summary-status").textContent;
      draw();
    } catch (error) {
      key = "";
      $("hill-summary-status").textContent = error.message;
    }
  }
  function draw() {
    const svg = $("hill-summary-profile"),
      W = Math.max(300, Math.round(svg.clientWidth || 900)),
      left = 52,
      right = W - 20,
      top = 28,
      bottom = 208,
      laneTop = 250,
      laneBottom = 316,
      metric = $("hill-summary-metric").value;
    lastWidth = W;
    svg.setAttribute("viewBox", `0 0 ${W} 370`);
    if (!result?.profile.length || !result.passes.length) {
      svg.innerHTML = `<text x="${W / 2}" y="130" text-anchor="middle">${members().length ? "Include a recording to view its mapped hill profile" : "No mapped terrain"}</text>`;
      return;
    }
    const fields = result.profile.map((p) => p[metric]),
      finite = fields.filter((p) => p.mean != null),
      mMin = finite.reduce((a, b) => Math.min(a, b.min), Infinity),
      mMax = finite.reduce((a, b) => Math.max(a, b.max), -Infinity),
      metricFactor = metric === "speed" ? (imperial() ? 2.236936 : 3.6) : 1,
      metricUnit =
        metric === "grade"
          ? "%"
          : metric === "speed"
            ? imperial()
              ? "mph"
              : "km/h"
            : metric === "hr"
              ? "bpm"
              : "W";
    const eles = result.profile.map((p) => p.ele).filter((p) => p.mean != null),
      low = eles.reduce((a, b) => Math.min(a, b.min), 0),
      high = eles.reduce((a, b) => Math.max(a, b.max), 1),
      hFactor = imperial() ? 3.28084 : 1;
    const x = (p) => left + p * (right - left),
      y = (v) =>
        bottom - ((v - low) / Math.max(1, high - low)) * (bottom - top),
      my = (v) =>
        laneBottom -
        ((v - (finite.length ? Math.min(0, mMin) : 0)) /
          Math.max(
            1,
            (finite.length ? mMax : 1) - Math.min(0, finite.length ? mMin : 0),
          )) *
          (laneBottom - laneTop);
    const color = (v) =>
      v == null
        ? "#bec8d0"
        : metric === "grade"
          ? v >= 12
            ? "#a676b8"
            : v >= 9
              ? "#d86d64"
              : v >= 6
                ? "#e5a16c"
                : v >= 3
                  ? "#d0c478"
                  : "#a9c4b8"
          : featureColor(v, mMin, mMax);
    let fills = "",
      fillStops = "",
      fillArea = "",
      areaStart = null,
      areaEnd = null,
      band = "",
      trace = "",
      feature = "",
      featureBand = "",
      down = false,
      fDown = false;
    result.profile.forEach((p, i) => {
      if (p.ele.mean != null) {
        trace += `${down ? "L" : "M"}${x(p.progress)},${y(p.ele.mean)} `;
        down = true;
      } else down = false;
      if (p[metric].mean != null) {
        feature += `${fDown ? "L" : "M"}${x(p.progress)},${my(p[metric].mean)} `;
        fDown = true;
      } else fDown = false;
      if (!i) return;
      const a = result.profile[i - 1];
      if (a.ele.mean != null && p.ele.mean != null) {
        const unknown = a[metric].mean == null || p[metric].mean == null,
          startColor = color(
            unknown
              ? null
              : metric === "grade"
                ? p[metric].mean
                : a[metric].mean,
          ),
          endColor = color(unknown ? null : p[metric].mean);
        fillStops += `<stop data-summary-position="${i}" offset="${a.progress}" stop-color="${startColor}"/><stop offset="${p.progress}" stop-color="${endColor}"/>`;
        band += `<path d="M${x(a.progress)},${y(a.ele.min)} L${x(p.progress)},${y(p.ele.min)} L${x(p.progress)},${y(p.ele.max)} L${x(a.progress)},${y(a.ele.max)} Z" fill="#546d7544"/>`;
      }
      if (a[metric].mean != null && p[metric].mean != null)
        featureBand += `<path d="M${x(a.progress)},${my(a[metric].min)} L${x(p.progress)},${my(p[metric].min)} L${x(p.progress)},${my(p[metric].max)} L${x(a.progress)},${my(a[metric].max)} Z" fill="#647c9a25"/>`;
    });
    for (const p of result.profile) {
      if (p.ele.mean != null) {
        if (areaStart == null) {
          areaStart = p;
          fillArea += `M${x(p.progress)},${bottom} L${x(p.progress)},${y(p.ele.mean)} `;
        } else fillArea += `L${x(p.progress)},${y(p.ele.mean)} `;
        areaEnd = p;
      } else if (areaStart) {
        fillArea += `L${x(areaEnd.progress)},${bottom} Z `;
        areaStart = null;
      }
    }
    if (areaStart) fillArea += `L${x(areaEnd.progress)},${bottom} Z`;
    fills = `<defs><linearGradient id="hill-summary-fill-colors" gradientUnits="userSpaceOnUse" x1="${left}" x2="${right}">${fillStops}</linearGradient></defs><path data-summary-fill d="${fillArea}" fill="url(#hill-summary-fill-colors)" opacity=".85"/>`;
    svg.innerHTML = `<text x="${left}" y="15">Relative elevation (${imperial() ? "ft" : "m"})</text>${[low, (low + high) / 2, high].map((v) => `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8ee"/><text x="${left - 7}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * hFactor)}</text>`).join("")}${fills}${band}<path d="${trace}" fill="none" stroke="#617a51" stroke-width="1.8" pointer-events="none"/><text x="${left}" y="239">${metric === "grade" ? "Gradient" : metric === "speed" ? "Recorded speed" : metric === "hr" ? "Heart rate" : "Measured power"} (${metricUnit}) · mean and across-ride range</text>${[
      0, 0.5, 1,
    ]
      .filter(() => finite.length)
      .map((f) => {
        const v =
          Math.min(0, finite.length ? mMin : 0) +
          f *
            Math.max(
              1,
              (finite.length ? mMax : 1) -
                Math.min(0, finite.length ? mMin : 0),
            );
        return `<line x1="${left}" x2="${right}" y1="${my(v)}" y2="${my(v)}" stroke="#e2e8ee"/><text data-feature-y-tick x="${left - 7}" y="${my(v) + 4}" text-anchor="end">${(v * metricFactor).toFixed(metric === "speed" ? 1 : 0)}</text>`;
      })
      .join(
        "",
      )}${featureBand}${!finite.length ? `<text x="${(left + right) / 2}" y="285" text-anchor="middle">${metric === "power" ? "Measured power" : metric === "hr" ? "Heart rate" : metric === "speed" ? "Speed" : "Gradient"} not recorded for these sections</text>` : ""}${metric === "grade" && finite.length ? `<line x1="${left}" x2="${right}" y1="${my(0)}" y2="${my(0)}" stroke="#8b99a8" stroke-opacity=".4" stroke-dasharray="3 4"/>` : ""}<path d="${feature}" fill="none" stroke="#647c9a" stroke-width="1.8"/>${[0, 0.5, 1].map((f) => `<text x="${x(f)}" y="342" text-anchor="middle">${$("hill-summary-axis").value === "progress" ? `${Math.round(f * 100)}%` : `${(((result.length || 0) * f) / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}`}</text>`).join("")}<text x="${(left + right) / 2}" y="365" text-anchor="middle">${$("hill-summary-axis").value === "progress" ? "Mapped hill progress (%)" : `Mapped distance (${imperial() ? "mi" : "km"})`}</text><line id="hill-summary-hover" y1="${top}" y2="${laneBottom}" stroke="#53687e" opacity="0"/>`;
    $("hill-summary-value").textContent =
      metric === "grade"
        ? "Fill: green <3%, yellow 3–6%, orange 6–9%, red 9–12%, purple ≥12%. Gray means not recorded. The band shows across-ride range, not a confidence interval."
        : finite.length
          ? `Fill: ${(mMin * metricFactor).toFixed(1)} ${metricUnit} blue → ${(mMax * metricFactor).toFixed(1)} ${metricUnit} orange (scale for this hill and included recordings). Gray means not recorded. The band shows across-ride range.`
          : "Gray fill: selected feature not recorded. Recording coverage does not change the fill colour.";
    svg.onpointermove = (event) => {
      const box = svg.getBoundingClientRect(),
        f = Math.max(
          0,
          Math.min(
            1,
            (((event.clientX - box.left) / box.width) * W - left) /
              (right - left),
          ),
        ),
        p = result.profile[Math.round(f * 100)],
        value = p[metric],
        cursor = $("hill-summary-hover");
      cursor.setAttribute("x1", x(f));
      cursor.setAttribute("x2", x(f));
      cursor.setAttribute("opacity", ".5");
      $("hill-summary-value").textContent =
        `${Math.round(f * 100)}% of mapped hill · ${value.mean == null ? "not recorded" : `${(value.mean * metricFactor).toFixed(1)} ${metricUnit} (range ${(value.min * metricFactor).toFixed(1)}–${(value.max * metricFactor).toFixed(1)})`} · ${value.rides} rides contributing`;
    };
  }
  $("hill-summary-select").onchange = () => {
    key = "";
    load();
  };
  $("hill-summary-metric").onchange = draw;
  $("hill-summary-axis").onchange = draw;
  $("hill-summary-sources").onchange = (event) => {
    const input = event.target.closest("[data-summary-member]");
    if (!input) return;
    const ids = excludedIds();
    input.checked
      ? ids.delete(input.dataset.summaryMember)
      : ids.add(input.dataset.summaryMember);
    exclusions[group().id] = [...ids];
    saveExclusions();
  };
  $("hill-summary-all").onclick = () => {
    exclusions[group().id] = [];
    saveExclusions();
  };
  $("hill-summary-none").onclick = () => {
    exclusions[group().id] = members().map((o) => o.id);
    saveExclusions();
  };
  $("hill-summary-compare").onclick = async () => {
    try {
      await onCompare(members(), "same-road", "");
    } catch (error) {
      $("hill-summary-status").textContent = error.message;
    }
  };
  let resizeFrame = 0;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const width = $("hill-summary-profile").clientWidth;
      if (width > 0 && Math.max(300, Math.round(width)) !== lastWidth && result)
        draw();
    });
  }).observe($("hill-summary-profile"));
  return {
    async select(id) {
      if (!catalog?.library.groups.some((g) => g.id === id)) return;
      $("hill-summary-select").value = id;
      key = "";
      await load();
      host.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    render(value) {
      catalog = value;
      options(catalog.library.groups);
      load();
    },
  };
}

// Interpolate through a neutral midpoint instead of sweeping the hue wheel.
// Equal values always have the same colour regardless of recording coverage.
function featureColor(value, min, max) {
  const f =
      max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5,
    stops = [
      [65, 120, 178],
      [213, 218, 222],
      [214, 124, 60],
    ],
    part = f <= 0.5 ? 0 : 1,
    fraction = f <= 0.5 ? f * 2 : (f - 0.5) * 2;
  return `rgb(${stops[part].map((a, i) => Math.round(a + (stops[part + 1][i] - a) * fraction)).join(" ")})`;
}
