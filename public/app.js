import {
  DEFAULTS,
  PALETTE,
  TERRAIN,
  hasGPS,
  nearestIndex,
  haversine,
  gradeProfile,
  atProgress,
  lowerBound,
  summarize,
  terrainBudget,
  deltaCurve,
} from "/analysis.mjs";
import { createComparisonWorkspace } from "/workspace.js";
import { createRideStory } from "/ride-story.js";
import { createHillLibrary } from "/hills.js";
import { effortTrace, sectionCandidates } from "/comparisons.mjs";
import { hillChartDomain, datePlotColor, dateGradient } from "/hill-chart.js";
import {
  gravityOnlyPower,
  minimumInputProfile,
  validateGravityMasses,
  validatePowerErrors,
} from "/gravity-power.mjs";
import { createGravityProfile } from "/gravity-profile.js";
import { createProgress } from "/progress.js";
const $ = (id) => document.getElementById(id),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const state = {
  rides: [],
  settings: { ...DEFAULTS },
  selected: [],
  referenceId: "",
  start: 0,
  end: 1,
  baseline: "",
  comparison: "",
  metric: "ele",
  matches: [],
  stats: new Map(),
  energyEstimates: new Map(),
  energyProfiles: new Map(),
  budgets: new Map(),
  canonical: [],
  busy: false,
  notesId: "",
  chartData: [],
};
const loaded = new Map(),
  pending = new Map();
let comparisonWorkspace,
  rideStory,
  hillLibrary,
  mechanicalProfile,
  progressView,
  rideRename = null;
let settingsTimeout;
const ref = () => loaded.get(state.referenceId),
  included = () =>
    state.rides
      .filter((r) => state.selected.includes(r.id))
      .map((r) => loaded.get(r.id))
      .filter(Boolean),
  unit = () => state.settings.units;
function fmtTime(v, signed = false) {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Math.round(Math.abs(v)),
    h = Math.floor(n / 3600),
    m = Math.floor((n % 3600) / 60);
  return `${v < 0 ? "−" : signed && v > 0 ? "+" : ""}${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(n % 60).padStart(2, "0")}`;
}
const dist = (v, d = 2) =>
  (v / (unit() === "imperial" ? 1609.344 : 1000)).toFixed(d) +
  (unit() === "imperial" ? " mi" : " km");
const elev = (v) =>
  v == null
    ? "—"
    : Math.round(v * (unit() === "imperial" ? 3.28084 : 1)) +
      (unit() === "imperial" ? " ft" : " m");
const spd = (v) =>
    v == null ? "—" : (v * (unit() === "imperial" ? 2.236936 : 3.6)).toFixed(1),
  spdUnit = () => (unit() === "imperial" ? "mph" : "km/h"),
  num = (v, d = 0) => (v == null ? "—" : v.toFixed(d));
const date = (v) =>
    new Date(v).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  rideName = (id) => state.rides.find((r) => r.id === id)?.name || "Ride";
const color = (id) =>
  PALETTE[
    Math.max(
      0,
      included().findIndex((r) => r.id === id),
    ) % PALETTE.length
  ];
let plotSaving = false;
const plot = () =>
  comparisonWorkspace.active()?.plot || { colorMode: "pass", hidden: [] };
const plotMatches = () =>
  state.matches.filter((m) => !plot().hidden.includes(m.id));
const plotDate = (m) =>
  new Date(
    loaded.get(m.rideId)?.date ?? loaded.get(m.rideId)?.points[0]?.t,
  ).getTime();
function plotColor(m) {
  if (plot().colorMode !== "pass") {
    const dates = state.matches.map(plotDate).filter(Number.isFinite),
      low = Math.min(...dates),
      high = Math.max(...dates),
      value = plotDate(m);
    if (!Number.isFinite(value)) return "#687b8d";
    const f = high > low ? (value - low) / (high - low) : 0.5;
    return datePlotColor(f, plot().colorMode === "date-gray" ? "gray" : "blue");
  }
  const index = comparisonWorkspace
    .active()
    .entries.findIndex((e) => e.id === m.id);
  return index < PALETTE.length
    ? PALETTE[index]
    : `hsl(${(210 + index * 137.508) % 360} 66% 40%)`;
}
function renderPlotLegend() {
  $("plot-colors").value = plot().colorMode;
  for (const id of ["plot-colors", "plot-all", "plot-none"])
    $(id).disabled = plotSaving;
  const dates = state.matches.map(plotDate).filter(Number.isFinite);
  $("plot-date-key").hidden = plot().colorMode === "pass";
  $("plot-date-key").style.setProperty(
    "--plot-date-gradient",
    dateGradient(plot().colorMode === "date-gray" ? "gray" : "blue"),
  );
  $("plot-date-key").textContent = dates.length
    ? `Oldest ${date(Math.min(...dates))} → Newest ${date(Math.max(...dates))}`
    : "Dates unavailable";
  const hiddenBaseline = plot().hidden.includes(state.baseline);
  $("plot-visibility").textContent =
    `${plotMatches().length} of ${state.matches.length} passes plotted. Use the checkboxes below to show a subset; table and CSV inclusion stay unchanged.${hiddenBaseline ? " The baseline line is hidden; differences still use that baseline." : ""}${plot().colorMode !== "pass" ? " Equal dates share a color; pass labels and highlighting identify individual curves." : ""} Hover or focus a legend item to highlight its curve.`;
  $("legend").innerHTML = state.matches
    .map(
      (m) =>
        `<label class="plot-entry" data-plot-key="${esc(m.id)}"><input type="checkbox" data-plot-entry="${esc(m.id)}" ${plot().hidden.includes(m.id) ? "" : "checked"} ${plotSaving ? "disabled" : ""}><svg class="plot-swatch" viewBox="0 0 48 14" role="img" aria-label="Solid line"><line x1="1" x2="47" y1="7" y2="7" stroke="${plotColor(m)}" stroke-width="${m.id === state.baseline ? 3 : 2.2}" stroke-dasharray=""/></svg><span>${esc(rideName(m.rideId))} · pass ${m.pass}${m.id === state.baseline ? " · baseline" : ""}${plot().colorMode !== "pass" ? ` · ${Number.isFinite(plotDate(m)) ? esc(date(plotDate(m))) : "Date unavailable"}` : ""}<small data-plot-value="${esc(m.id)}"></small></span></label>`,
    )
    .join("");
}
function highlightPlot(id) {
  const lines = [...$("comparison-chart").querySelectorAll("[data-plot-line]")];
  if (!lines.some((line) => line.dataset.plotLine === id)) id = null;
  for (const line of lines) {
    const selected = line.dataset.plotLine === id;
    line.style.opacity = id && !selected ? "0.18" : "1";
    line.style.strokeWidth = selected
      ? String(+line.getAttribute("stroke-width") + 1.5)
      : "";
  }
  for (const label of $("legend").querySelectorAll("[data-plot-key]"))
    label.classList.toggle("plot-highlighted", label.dataset.plotKey === id);
}
function plotValues(read) {
  for (const value of $("legend").querySelectorAll("[data-plot-value]"))
    value.textContent = read(value.dataset.plotValue) || "";
}
async function changePlot(update) {
  if (plotSaving) return;
  const c = comparisonWorkspace.active(),
    previous = structuredClone(c.plot),
    focusId = document.activeElement?.dataset.plotEntry;
  plotSaving = true;
  c.plot ||= { colorMode: "pass", hidden: [] };
  update(c.plot);
  renderComparison();
  try {
    await comparisonWorkspace.save();
  } catch (error) {
    c.plot = previous;
    message(error.message, true);
  } finally {
    plotSaving = false;
    renderComparison();
    if (focusId)
      [...$("legend").querySelectorAll("[data-plot-entry]")]
        .find((input) => input.dataset.plotEntry === focusId)
        ?.focus({ preventScroll: true });
  }
}
async function api(path, options) {
  let r;
  try {
    r = await fetch(path, options);
  } catch (cause) {
    const error = new Error(
      "Cannot reach Noboride’s local server. Check that Noboride is still running on your computer and that this device can connect, then try again.",
      { cause },
    );
    error.name = "NetworkError";
    throw error;
  }
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || "Request failed.");
  return v;
}
const json = (method, value = {}) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
function message(text, error = false) {
  $("messages").replaceChildren();
  if (!text) return;
  const div = document.createElement("div");
  div.className = "notice" + (error ? " error" : "");
  div.textContent = text;
  const b = document.createElement("button");
  b.textContent = "×";
  b.setAttribute("aria-label", "Dismiss");
  b.onclick = () => div.remove();
  div.append(b);
  $("messages").append(div);
}
async function task(label, fn) {
  if (state.busy) return;
  state.busy = true;
  message(label);
  document.body.classList.add("working");
  try {
    await fn();
    if (comparisonWorkspace) await comparisonWorkspace.save();
    message("");
  } catch (e) {
    message(e.message, true);
  } finally {
    state.busy = false;
    document.body.classList.remove("working");
  }
}
function persistSelection() {
  localStorage.setItem("noboride-included", JSON.stringify(state.selected));
}
async function getRide(id) {
  if (loaded.has(id)) return loaded.get(id);
  if (pending.has(id)) return pending.get(id);
  const promise = api(`/api/rides/${id}`)
    .then((r) => {
      loaded.set(id, r);
      return r;
    })
    .finally(() => pending.delete(id));
  pending.set(id, promise);
  return promise;
}
async function refresh(initial = false) {
  const hadRides = state.rides.length > 0;
  const v = await api("/api/workspace");
  state.rides = v.rides;
  state.settings = v.settings;
  let prior = state.selected;
  if (initial) {
    try {
      prior = JSON.parse(
        localStorage.getItem("noboride-included") ??
          localStorage.getItem("ridescope-included") ??
          "null",
      );
      if (Array.isArray(prior))
        localStorage.setItem("noboride-included", JSON.stringify(prior));
    } catch {
      prior = null;
    }
  }
  state.selected = Array.isArray(prior)
    ? prior.filter((id) => state.rides.some((r) => r.id === id))
    : state.rides.slice(0, 3).map((r) => r.id);
  if (!state.selected.length && state.rides.length && !initial && !hadRides)
    state.selected = state.rides.slice(0, 3).map((r) => r.id);
  await Promise.all(state.selected.map(getRide));
  await comparisonWorkspace.load(v.comparisons, initial);
  hillLibrary?.invalidate();
  // Hill discovery is metadata only in the browser; raw tracks remain on demand.
  await hillLibrary?.load();
  persistSelection();
  render();
}
function compute() {
  const r = ref();
  if (r) {
    state.start = Math.max(0, Math.min(state.start, r.points.length - 2));
    state.end = Math.min(
      r.points.length - 1,
      Math.max(state.start + 1, state.end),
    );
  }
  state.canonical =
    comparisonWorkspace.roadPoints() ||
    (r ? r.points.slice(state.start, state.end + 1) : []);
  state.matches = comparisonWorkspace.matches();
  state.stats = new Map(
    state.matches.map((m) => [m.id, summarize(m.points, state.settings)]),
  );
  const energyElevation = powerElevation();
  state.energyProfiles = new Map(
    state.matches.map((m) => [
      m.id,
      minimumInputProfile(
        m.points,
        state.settings,
        energyElevation || m.points,
      ),
    ]),
  );
  state.energyEstimates = new Map(
    [...state.energyProfiles].map(([id, result]) => [id, result.summary]),
  );
  state.budgets = new Map(
    comparisonWorkspace.active()?.mode === "terrain"
      ? []
      : state.matches.map((m) => [
          m.id,
          terrainBudget(m.points, state.canonical, state.settings),
        ]),
  );
  const savedEntries = comparisonWorkspace.active()?.entries || [];
  if (!savedEntries.some((entry) => entry.id === state.baseline))
    state.baseline =
      [...state.matches].sort((a, b) => a.points[0].t - b.points[0].t)[0]?.id ||
      "";
  if (
    !savedEntries.some(
      (m) => m.id === state.comparison && m.id !== state.baseline,
    )
  )
    state.comparison =
      [...state.matches].reverse().find((m) => m.id !== state.baseline)?.id ||
      "";
}
function render() {
  if (!state.selected.includes(state.referenceId)) {
    const candidate = [...included()].sort(
      (a, b) => a.points[0].t - b.points[0].t,
    )[0];
    state.referenceId = candidate?.id || "";
    state.start = 0;
    state.end = candidate ? candidate.points.length - 1 : 1;
  }
  compute();
  renderRides();
  renderSettings();
  $("welcome").hidden = !!state.rides.length;
  $("workspace").hidden = !state.rides.length;
  renderControls();
  comparisonWorkspace.render();
  if (ref()) renderEndpoints();
  else {
    for (const endpoint of ["start", "end"]) {
      $(`${endpoint}-label`).textContent = "—";
      $(`${endpoint}-coordinate`).value = "";
    }
    mainMap.update([], [], null, 0, 0);
    mainMap.highlight(null);
  }
  if (state.canonical.length > 1) renderSummary();
  else
    $("summary").textContent =
      "Include a source ride, select a stretch, and add it to this comparison.";
  renderMatches();
  renderGravityPower();
  renderComparison();
  renderBudget();
  renderContext();
  rideStory?.render();
  renderHillGuidance();
  hillLibrary?.render();
  progressView?.refresh();
}
async function showView(view) {
  $("comparisons-view").hidden = view !== "comparisons";
  $("hills-view").hidden = view !== "hills";
  $("progress-view").hidden = view !== "progress";
  $("progress-tab").setAttribute("aria-pressed", String(view === "progress"));
  $("comparisons-tab").setAttribute(
    "aria-pressed",
    String(view === "comparisons"),
  );
  $("hills-tab").setAttribute("aria-pressed", String(view === "hills"));
  if (view === "hills") await hillLibrary.open();
  else if (view === "progress") await progressView.open();
  else render();
}
function renderHillGuidance() {
  const data = hillLibrary?.data(),
    ride = ref(),
    container = $("hill-guidance");
  container.hidden = true;
  if (!data || !ride || !data.library.groups.length) return;
  const observation = sectionCandidates(
    { rideId: ride.id, start: state.start, end: state.end },
    data.observations.filter((o) =>
      data.library.groups.some((g) => g.observationIds.includes(o.id)),
    ),
    ride.points,
    60,
  )[0]?.candidate;
  const group =
    observation &&
    data.library.groups.find((g) => g.observationIds.includes(observation.id));
  if (!group) return;
  const entries = comparisonWorkspace.active()?.entries || [],
    others = data.observations.filter((o) => {
      if (!group.observationIds.includes(o.id)) return false;
      return !entries.some((entry) => {
        if (entry.hillObservationId === o.id) return true;
        const points = loaded.get(o.rideId)?.points;
        return points && sectionCandidates(o, [entry], points, 60).length > 0;
      });
    });
  container.hidden = false;
  container.innerHTML = `<span>Hill: <strong>${esc(group.name)}</strong></span> <button class="text-button" data-open-hills="${esc(group.id)}">View summary</button>${others.length ? `<details><summary>${others.length} library pass${others.length === 1 ? "" : "es"} not in this comparison</summary><div class="hill-actions">${others.map((o) => `<button class="button small" data-hill-preview="${esc(o.id)}">Preview ${esc(rideName(o.rideId))} · ${fmtTime(o.positionSeconds)}</button>`).join("")}</div></details>` : "<small>All library passes are included.</small>"}`;
}
function renderRides() {
  $("ride-count").textContent = state.rides.length;
  $("included-count").textContent = `${state.selected.length} included`;
  const q = $("filter").value.toLowerCase(),
    filtered = state.rides.filter((r) =>
      `${r.name} ${r.notes.bike} ${date(r.date)}`.toLowerCase().includes(q),
    );
  $("ride-list").innerHTML = filtered
    .map(
      (r) =>
        `<article class="ride-card ${state.selected.includes(r.id) ? "included" : ""}"><div class="ride-heading"><label class="ride-toggle"><input type="checkbox" aria-label="Include ${esc(r.name)}" data-include="${esc(r.id)}" ${state.selected.includes(r.id) ? "checked" : ""}><span class="ride-dot" style="background:${state.selected.includes(r.id) ? color(r.id) : "#b2bdc8"}"></span></label><div class="ride-identity">${rideRename?.id === r.id ? `<form data-ride-name-form="${esc(r.id)}"><label>Activity name<input data-ride-name-input value="${esc(rideRename.draft)}" maxlength="160" required></label><button class="text-button" type="submit">Save</button><button class="text-button" type="button" data-ride-name-cancel>Cancel</button><small data-ride-name-error role="alert">${esc(rideRename.error || "")}</small></form>` : `<button class="ride-name" data-ride-rename="${esc(r.id)}" title="Rename activity">${esc(r.name)}</button>`}<small>${esc(date(r.date))} ${r.demo ? '<b class="demo-pill">DEMO</b>' : ""}</small></div></div><div class="ride-stats"><span>${r.overview ? dist(r.overview.distance, 1) : ""}</span><span>${r.overview ? fmtTime(r.overview.elapsed) : ""}</span><button class="text-button" data-notes="${esc(r.id)}">Notes</button></div>${r.notes.bike ? `<div class="bike-tag">↝ ${esc(r.notes.bike)}</div>` : ""}</article>`,
    )
    .join("");
}
function renderSettings() {
  for (const [id, k] of [
    ["units", "units"],
    ["radius", "matchRadius"],
    ["grade-threshold", "gradeThreshold"],
    ["moving-threshold", "movingThreshold"],
    ["gap", "gapSeconds"],
  ])
    $(id).value = state.settings[k];
  $("grade-window").value = state.settings.gradeWindow;
  $("grade-window-value").textContent = `${state.settings.gradeWindow} m`;
  $("suggestion-overlap").value = state.settings.suggestionOverlap;
  $("suggestion-overlap-value").textContent =
    `${state.settings.suggestionOverlap}%`;
}
function renderControls() {
  $("ride-tabs").innerHTML =
    state.rides
      .filter((r) => state.selected.includes(r.id))
      .map(
        (r) =>
          `<button role="tab" aria-selected="${r.id === state.referenceId}" tabindex="${r.id === state.referenceId ? 0 : -1}" aria-controls="source-editor" data-source-ride="${esc(r.id)}" class="ride-tab">${esc(r.name)}<small>${esc(date(r.date))}</small></button>`,
      )
      .join("") ||
    '<p class="subtle">Include rides from the library to browse them here.</p>';
  for (const id of [
    "start-range",
    "end-range",
    "start-coordinate",
    "end-coordinate",
    "snap-start",
    "snap-end",
  ])
    $(id).disabled = !ref();
}
function baseline() {
  return state.matches.find((m) => m.id === state.baseline);
}
function comparison() {
  return state.matches.find((m) => m.id === state.comparison);
}
function renderSummary() {
  const saved = comparisonWorkspace.active()?.entries.length || 0;
  if (saved && !state.matches.length) {
    $("summary").innerHTML =
      '<div class="inline-empty"><h3>No available stretches from selected rides</h3><p>Include this comparison’s missing rides or choose another comparison. Your saved stretches are unchanged.</p></div>';
    return;
  }
  const b = baseline(),
    c = comparison(),
    terrain = comparisonWorkspace.active()?.mode === "terrain",
    s = summarize(b?.points || state.canonical, state.settings),
    gain =
      b && c
        ? state.stats.get(b.id).elapsed - state.stats.get(c.id).elapsed
        : null;
  const cards = [
    [
      "Comparison stretches",
      state.matches.length,
      `from ${new Set(state.matches.map((m) => m.rideId)).size} rides`,
    ],
    [
      b || saved ? "Baseline distance" : "Selection distance",
      saved && !b ? "—" : dist(s.distance),
      b
        ? "Current baseline stretch"
        : saved
          ? "Choose or include a baseline"
          : "Source selection · add it to begin",
    ],
    [
      b || saved ? "Baseline grade" : "Selection grade",
      saved && !b ? "—" : `${num(s.grade, 1)}%`,
      saved && !b
        ? "Saved baseline is unavailable"
        : `Peak ${num(s.maxGrade, 1)}% over ${state.settings.gradeWindow} m`,
    ],
    [
      terrain ? "Elapsed difference" : "Selected comparison",
      gain == null
        ? "—"
        : terrain
          ? fmtTime(-gain, true)
          : fmtTime(Math.abs(gain)),
      terrain
        ? "Selected effort vs baseline · independent boundaries"
        : gain == null
          ? "Include another matching ride"
          : gain >= 0
            ? "Faster than the baseline"
            : "Slower than the baseline",
    ],
  ];
  $("summary").innerHTML = cards
    .map(
      ([label, value, sub], i) =>
        `<div class="summary-card ${i === 3 && !terrain && gain > 0 ? "gain-card" : ""}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`,
    )
    .join("");
}
function changeRange(start, end) {
  state.start = start;
  state.end = end;
  comparisonWorkspace.selectionChanged({ adopt: true });
  render();
  comparisonWorkspace.soon();
}
function renderEndpoints() {
  const r = ref();
  for (const [which, index] of [
    ["start", state.start],
    ["end", state.end],
  ]) {
    const p = r.points[index],
      input = $(`${which}-range`);
    input.max = which === "start" ? r.points.length - 2 : r.points.length - 1;
    input.value = index;
    $(`${which}-label`).textContent =
      `${dist(p.d - r.points[0].d)} · ${fmtTime((p.t - r.points[0].t) / 1000)}`;
    $(`${which}-coordinate`).value = hasGPS(p)
      ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`
      : "";
  }
}
function selectOnMap(ll, endpoint) {
  const r = ref();
  if (!r) return;
  const i = nearestIndex(r.points, ll);
  if (i < 0) return;
  if (
    (endpoint === "start" && i >= state.end) ||
    (endpoint === "end" && i <= state.start)
  ) {
    message(
      "Start must come before end. Use the range controls to choose another lap.",
      true,
    );
    return;
  }
  changeRange(
    endpoint === "start" ? i : state.start,
    endpoint === "end" ? i : state.end,
  );
}
class RouteMap {
  constructor(id, onSelect) {
    this.map = L.map(id, { zoomControl: false, maxZoom: 19 }).setView(
      [45.52, -122.7],
      13,
    );
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    this.layers = L.layerGroup().addTo(this.map);
    this.hover = L.layerGroup().addTo(this.map);
    this.key = "";
    this.bounds = null;
    this.onSelect = onSelect;
    let resizeFrame = 0,
      lastSize = "";
    new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const element = $(id),
          size = `${element.clientWidth}:${element.clientHeight}`;
        if (!element.clientWidth || !element.clientHeight || size === lastSize)
          return;
        lastSize = size;
        this.map.invalidateSize();
        this.fit();
      });
    }).observe($(id));
  }
  update(rides, matches, reference, start, end) {
    this.layers.clearLayers();
    const bounds = L.latLngBounds([]);
    const add = (points, options) => {
      let group = [];
      const flush = () => {
        if (group.length) L.polyline(group, options).addTo(this.layers);
        group = [];
      };
      points.forEach((p, i) => {
        if (!hasGPS(p) || p.breakBefore || (i && p.t - points[i - 1].t > 30000))
          flush();
        if (hasGPS(p)) {
          group.push([p.lat, p.lon]);
          bounds.extend([p.lat, p.lon]);
        }
      });
      flush();
    };
    rides.forEach((r) =>
      add(r.points, {
        color: color(r.id),
        weight: 3,
        opacity: 0.27,
        interactive: false,
      }),
    );
    for (const m of matches) {
      add(m.points, {
        color: color(m.rideId),
        weight: m.editing ? 9 : 6,
        opacity: 0.8,
        className: m.number ? "saved-stretch-route" : "",
      });
      for (const [p, label] of [
        [m.points[0], "Start"],
        [m.points.at(-1), "End"],
      ])
        if (hasGPS(p)) {
          const tip = document.createElement("span");
          tip.textContent = `${rideName(m.rideId)} · ${m.number ? `stretch ${m.number}` : `pass ${m.pass}`} · ${label}`;
          L.circleMarker([p.lat, p.lon], {
            radius: 5,
            color: "white",
            fillColor: color(m.rideId),
            fillOpacity: 1,
            weight: 2,
          })
            .bindTooltip(tip)
            .addTo(this.layers);
        }
    }
    if (reference) {
      add(reference.points.slice(start, end + 1), {
        color: "#182d45",
        weight: 2,
        dashArray: "5 7",
        interactive: false,
      });
      for (const [index, type, label] of [
        [start, "start", "S"],
        [end, "end", "E"],
      ]) {
        const p = reference.points[index];
        if (!hasGPS(p)) continue;
        const marker = L.marker([p.lat, p.lon], {
          draggable: true,
          zIndexOffset: 800,
          icon: L.divIcon({
            className: `map-endpoint ${type}`,
            html: `<span>${label}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
        }).addTo(this.layers);
        marker.on("dragend", () => {
          const ll = marker.getLatLng();
          this.onSelect({ lat: ll.lat, lon: ll.lng }, type);
        });
      }
    }
    const key =
      rides.map((r) => r.viewKey || r.id).join(":") + ":" + reference?.id;
    this.bounds = bounds;
    if (bounds.isValid() && key !== this.key) {
      this.key = key;
      requestAnimationFrame(() => {
        this.map.invalidateSize();
        this.fit();
      });
    }
    setTimeout(() => this.map.invalidateSize(), 0);
  }
  fit() {
    if (this.bounds?.isValid())
      this.map.fitBounds(this.bounds, {
        padding: [35, 35],
        maxZoom: 16,
        animate: false,
      });
  }
  highlight(p) {
    this.hover.clearLayers();
    if (hasGPS(p))
      L.circleMarker([p.lat, p.lon], {
        radius: 7,
        color: "#172b42",
        fillColor: "white",
        fillOpacity: 1,
        weight: 2,
      }).addTo(this.hover);
  }
}
const mainMap = new RouteMap("map", (ll, type) => {
  if (type) selectOnMap(ll, type);
});
const CH = { w: 780, h: 218, l: 48, r: 16, t: 20, b: 32 };
function renderMatches() {
  const b = baseline(),
    terrain = comparisonWorkspace.active()?.mode === "terrain";
  $("baseline-description").textContent = terrain
    ? "Negative Δ elapsed means a shorter elapsed time than the chosen baseline. Different hills retain independent lengths and boundaries; this is not a same-road time advantage."
    : "Negative Δ means faster. GPS offsets show start / end miss distance.";
  const savedBaseline = comparisonWorkspace
    .active()
    ?.entries.find((entry) => entry.id === state.baseline);
  const excludedBaseline =
    savedBaseline && !state.selected.includes(savedBaseline.rideId);
  const rejectedBaseline = savedBaseline?.review === "rejected";
  const placeholder = !b
    ? `<option value="${esc(state.baseline)}" disabled>${savedBaseline ? `${esc(rideName(savedBaseline.rideId))} · ${excludedBaseline ? "ride not selected" : rejectedBaseline ? "pairing rejected" : "unavailable under current matching settings"}` : "Choose a baseline stretch"}</option>`
    : "";
  $("baseline").innerHTML =
    placeholder +
    state.matches
      .map(
        (m) =>
          `<option value="${esc(m.id)}">${esc(rideName(m.rideId))} · pass ${m.pass}</option>`,
      )
      .join("");
  $("baseline").value = state.baseline;
  $("baseline").disabled = !state.matches.length;
  $("baseline-notice").hidden = !savedBaseline || !!b;
  $("baseline-notice-text").textContent =
    savedBaseline && !b
      ? `Saved baseline “${rideName(savedBaseline.rideId)}” is ${excludedBaseline ? "not selected" : rejectedBaseline ? "rejected during road review" : "unavailable under the current matching settings"}. ${excludedBaseline ? "Include its ride or choose another available baseline." : rejectedBaseline ? "Review its road decision or choose another available baseline." : "Review matching settings or choose another available baseline."} Time differences and overlays wait for an available baseline.`
      : "";
  $("include-baseline-ride").hidden = !excludedBaseline;
  $("export").disabled = !state.matches.length;
  $("matches").innerHTML = state.matches.length
    ? `<table><thead><tr><th>Ride / pass</th><th>Elapsed</th><th>${terrain ? "Δ elapsed" : "Δ baseline"}</th><th>Moving est.</th><th>Avg speed</th><th>Avg HR</th><th>Cadence</th><th title="Time-weighted average of the local minimum-power curve; partial coverage is labelled">Est. min. avg power</th><th>${terrain ? "Peak grade" : "GPS offsets"}</th><th></th></tr></thead><tbody>${state.matches
        .map((m) => {
          const s = state.stats.get(m.id),
            estimate = state.energyEstimates.get(m.id),
            average = state.energyProfiles.get(m.id).average,
            base = m.id === b?.id,
            delta = b ? s.elapsed - state.stats.get(b.id).elapsed : null;
          return `<tr data-analysis-entry="${esc(m.id)}" class="${base ? "baseline" : ""}"><td><strong class="table-ride"><i style="background:${color(m.rideId)}"></i>${esc(rideName(m.rideId))}</strong><small>Pass ${m.pass} · ${dist(s.distance)}${m.manual ? " · manual" : ""}${base ? " · baseline" : ""}</small></td><td class="strong">${fmtTime(s.elapsed)}</td><td class="${b && !base && delta < 0 ? "positive" : ""}">${!b || base ? "—" : fmtTime(delta, true)}${terrain ? `<small>${elev(s.grade == null ? null : (s.grade * s.distance) / 100)} gain · ${num(s.grade, 1)}%</small>` : ""}</td><td>${fmtTime(s.moving)}</td><td>${spd(s.speed)} <small>${spdUnit()}</small></td><td>${num(s.hr)} <small>bpm</small></td><td>${num(s.cadence)} <small>rpm</small></td><td data-estimated-average="${esc(m.id)}" title="${esc(average?.watts == null ? estimate.reason || "No supported local power windows" : "Time-weighted windowed minimum estimate; resistance omitted, actual pedalling power may be higher.")}">${average?.watts == null ? "—" : `${Math.round(average.watts)} W`}${average?.watts != null && average.coverage < 0.999 ? `<small>Partial · ${(average.coverage * 100).toFixed(1)}% time</small>` : average?.watts == null ? `<small>${estimate.massKg == null ? "Enter weights" : "Unavailable"}</small>` : ""}</td><td title="${terrain ? "Independent terrain effort" : m.manual ? "Manual selection: automatic road checks bypassed" : `Max ordered-route offset: ${num(m.routeError, 1)}m${m.gpsBridgeSeconds ? `; GPS gap bridged for geometry checks: ${num(m.gpsBridgeSeconds)} seconds` : ""}`}">${terrain ? `${num(s.maxGrade, 1)}% over ${state.settings.gradeWindow} m` : m.manual ? "Manual" : `${Math.round(m.startMiss)} / ${Math.round(m.endMiss)} m`}${!m.manual && m.gpsBridgeSeconds ? `<small>GPS gap: ${num(m.gpsBridgeSeconds)} s</small>` : ""}</td><td><button class="text-button" data-entry-edit="${esc(m.id)}">Edit</button></td></tr>`;
        })
        .join("")}</tbody></table>`
    : comparisonWorkspace.active()?.entries.length
      ? '<div class="inline-empty"><h3>No available stretches from selected rides</h3><p>Include missing rides or review the matching settings. Saved stretches have not been removed.</p></div>'
      : '<div class="inline-empty"><h3>No stretches in this comparison yet</h3><p>Choose a source ride tab, select at least 20 meters, then add the stretch to this comparison.</p></div>';
  $("timing-note").textContent =
    `Moving time is estimated above ${spd(state.settings.movingThreshold)} ${spdUnit()}, excluding known pauses and recording gaps. It may differ from Garmin. HR/cadence/power averages are time-weighted; absent sensors stay blank.`;
  $("unmatched").innerHTML = "";
}
function gravityEstimate(match) {
  const common =
    comparisonWorkspace.active()?.mode !== "terrain" &&
    !comparisonWorkspace.hasEfforts() &&
    comparisonWorkspace.roadPoints();
  return {
    ...gravityOnlyPower(match.points, state.settings, common || match.points),
    basis: common ? "Shared road reference" : "This pass’s recorded elevation",
  };
}
function powerElevation() {
  return comparisonWorkspace.active()?.mode !== "terrain" &&
    !comparisonWorkspace.hasEfforts()
    ? comparisonWorkspace.roadPoints()
    : null;
}
function renderGravityPower() {
  const factor = unit() === "imperial" ? 1 / 0.45359237 : 1;
  for (const [id, key] of [
    ["gravity-rider", "riderMassKg"],
    ["gravity-bike", "bikeMassKg"],
  ]) {
    if (document.activeElement !== $(id))
      $(id).value =
        state.settings[key] == null
          ? ""
          : +(state.settings[key] * factor).toFixed(6);
  }
  for (const label of document.querySelectorAll("[data-mass-unit]"))
    label.textContent = unit() === "imperial" ? "lb" : "kg";
  for (const [id, key, conversion] of [
    [
      "power-height-error",
      "powerHeightErrorM",
      unit() === "imperial" ? 3.28084 : 1,
    ],
    [
      "power-speed-error",
      "powerSpeedErrorMps",
      unit() === "imperial" ? 2.236936 : 1,
    ],
  ]) {
    if (document.activeElement !== $(id))
      $(id).value =
        state.settings[key] == null
          ? ""
          : +(state.settings[key] * conversion).toFixed(6);
  }
  $("power-height-unit").textContent = unit() === "imperial" ? "ft" : "m";
  $("power-speed-unit").textContent = unit() === "imperial" ? "mph" : "m/s";
  const common =
    comparisonWorkspace.active()?.mode !== "terrain" &&
    !comparisonWorkspace.hasEfforts() &&
    comparisonWorkspace.roadPoints();
  $("gravity-basis").textContent =
    `${common ? `Height gain uses the shared road reference (${rideName(comparisonWorkspace.active().road.rideId)}) for every verified pass.` : "Each pass uses its own recorded endpoint height difference; different boundaries and elevation errors affect comparisons."} Weights apply to every pass in this comparison and are saved with it. Blank weights disable the estimate.`;
  $("gravity-results").innerHTML = state.matches.length
    ? `<table><thead><tr><th>Ride / pass</th><th>Avg. windowed minimum</th><th>Whole-range net bound</th><th>Start → end speed</th><th>Total weight</th><th>Net height gain</th><th>Elapsed</th></tr></thead><tbody>${state.matches
        .map((m) => {
          const estimate = state.energyEstimates.get(m.id),
            average = state.energyProfiles.get(m.id).average;
          return `<tr data-gravity-entry="${esc(m.id)}"><td>${esc(rideName(m.rideId))} · pass ${m.pass}</td><td data-windowed-average="${esc(m.id)}">${average?.watts == null ? "Unavailable" : `${Math.round(average.watts)} W`}${average?.watts != null ? `<small>${average.coverage < 0.999 ? "Partial · " : ""}${(average.coverage * 100).toFixed(1)}% of elapsed time supported</small>` : ""}</td><td><span data-gravity-watts data-minimum-watts>${estimate.minimumWatts == null ? esc(estimate.reason) : `${Math.round(estimate.minimumWatts)} W`}</span>${estimate.minimumWatts == null ? "" : `<small>Gravity ${Math.round(estimate.gravityWatts)} W · momentum ${Math.round(estimate.kineticWatts)} W</small><small data-power-error-range>${estimate.lowerWatts == null ? "Error range unquantified" : `Assumed-error sensitivity: ${Math.round(estimate.lowerWatts)}–${Math.round(estimate.upperWatts)} W`}</small>`}</td><td>${estimate.startSpeed == null ? "—" : `${spd(estimate.startSpeed)} → ${spd(estimate.endSpeed)} ${spdUnit()}`}</td><td>${estimate.massKg == null ? "—" : `${(estimate.massKg * factor).toFixed(1)} ${unit() === "imperial" ? "lb" : "kg"}`}</td><td>${elev(estimate.netGainMeters)}</td><td>${fmtTime(estimate.elapsedSeconds)}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : "Add a climbing stretch to this comparison to see its estimate.";
  mechanicalProfile?.render();
}
function estimatedTrace(match, axis = "progress") {
  const result = state.energyProfiles.get(match.id);
  const ascent =
    axis === "ascent"
      ? effortTrace(match.points, "ascent", state.settings.gapSeconds)
      : null;
  return result.rows.map((row, i) => {
    let x =
      axis === "progress"
        ? row.progress
        : axis === "elapsed"
          ? (row.t - match.points[0].t) / 1000
          : row.d;
    if (ascent) {
      const k = lowerBound(match.points, match.points[0].d + row.d),
        a = ascent[Math.max(0, k - 1)],
        b = ascent[k];
      x =
        a.x == null || b.x == null
          ? null
          : k === 0
            ? b.x
            : a.x +
              ((b.x - a.x) * (row.t - a.point.t)) / (b.point.t - a.point.t);
    }
    return {
      x,
      y: row.minimumWatts,
      point: row.point,
      connected:
        i > 0 &&
        result.rows[i - 1].minimumWatts != null &&
        row.minimumWatts != null,
    };
  });
}
function renderComparison() {
  renderPlotLegend();
  const terrain = comparisonWorkspace.active()?.mode === "terrain";
  if (terrain && state.metric === "delta") state.metric = "ele";
  const metric = state.metric,
    b = baseline();
  $("metric").querySelector('[value="delta"]').disabled = terrain;
  $("metric").querySelector('[value="delta"]').hidden = terrain;
  $("effort-axis-control").hidden = !terrain;
  $("comparison-chart-title").textContent = terrain
    ? "Effort traces on independent hills"
    : "Selected stretches, aligned by progress";
  $("comparison-chart-help").textContent = terrain
    ? "Original recorded samples share an axis. Relative progress describes effort shape, without geographic correspondence."
    : "Hover to locate the corresponding point on the map.";
  $("metric").value = metric;
  $("metric").disabled = !b;
  state.chartData = [];
  if (!b) {
    $("comparison-chart").textContent = state.matches.length
      ? "Choose an available baseline to show aligned overlays."
      : "";
    return;
  }
  if (terrain) return renderTerrainComparison(b, metric);
  const units =
    metric === "speed"
      ? spdUnit()
      : metric === "ele"
        ? unit() === "imperial"
          ? "ft"
          : "m"
        : metric === "hr"
          ? "bpm"
          : metric === "cad"
            ? "rpm"
            : metric === "power" || metric === "minimumPower"
              ? "W"
              : metric === "grade"
                ? "%"
                : "seconds";
  const lines = plotMatches().map((m) => {
    const gs =
      metric === "grade"
        ? gradeProfile(
            m.points,
            state.settings.gradeWindow,
            state.settings.gapSeconds,
          )
        : null;
    return {
      m,
      values:
        metric === "minimumPower"
          ? estimatedTrace(m)
          : metric === "delta"
            ? deltaCurve(m.points, b.points)
            : Array.from({ length: 151 }, (_, i) => {
                const f = i / 150,
                  p = atProgress(m.points, f);
                let v =
                  metric === "grade"
                    ? gs[lowerBound(m.points, p.d)]
                    : p[metric];
                if (metric === "ele")
                  v =
                    v != null && m.points[0].ele != null
                      ? (v - m.points[0].ele) *
                        (unit() === "imperial" ? 3.28084 : 1)
                      : null;
                if (metric === "speed" && v != null)
                  v *= unit() === "imperial" ? 2.236936 : 3.6;
                const k = lowerBound(m.points, p.d);
                if (
                  k > 0 &&
                  (m.points[k].breakBefore ||
                    m.points[k].t - m.points[k - 1].t >
                      state.settings.gapSeconds * 1000)
                )
                  v = null;
                return { x: f, y: v };
              }),
    };
  });
  const all = lines
      .flatMap((l) => l.values.map((p) => p.y))
      .filter((v) => v != null),
    min = all.length ? all.reduce((a, b) => Math.min(a, b), Infinity) : 0,
    max = all.length ? all.reduce((a, b) => Math.max(a, b), -Infinity) : 1,
    pad = Math.max(1, (max - min) * 0.12),
    lo = metric === "minimumPower" ? 0 : min - pad,
    hi = max + pad,
    y = (v) => CH.h - CH.b - ((v - lo) / (hi - lo)) * (CH.h - CH.b - CH.t);
  const path = (values) => {
    let down = false;
    return values
      .map((p) => {
        if (p.y == null) {
          down = false;
          return "";
        }
        const s = `${down ? "L" : "M"}${CH.l + p.x * (CH.w - CH.l - CH.r)},${y(p.y)}`;
        down = true;
        return s;
      })
      .join(" ");
  };
  $("comparison-chart").innerHTML =
    `<svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="${esc(metric)} comparison by distance progress">${[0, 0.5, 1].map((f) => `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(lo + (hi - lo) * f)}" y2="${y(lo + (hi - lo) * f)}" stroke="#e4e9ee"/><text x="${CH.l - 8}" y="${y(lo + (hi - lo) * f) + 4}" text-anchor="end">${Math.round(lo + (hi - lo) * f)}</text>`).join("")}${metric === "delta" ? `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(0)}" y2="${y(0)}" stroke="#8a9aac" stroke-dasharray="4 4"/>` : ""}${lines.map(({ m, values }) => `<path d="${path(values)}" fill="none" data-plot-line="${esc(m.id)}" stroke="${plotColor(m)}" stroke-width="${m.id === b.id ? 3 : 2.2}" stroke-dasharray=""/>`).join("")}${[0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${CH.l + f * (CH.w - CH.l - CH.r)}" y="${CH.h - 8}" text-anchor="middle">${Math.round(f * 100)}%</text>`).join("")}<line id="compare-cursor" y1="${CH.t}" y2="${CH.h - CH.b}" stroke="#172b42" opacity="0"/></svg><div class="chart-caption"><span>${esc(units)} ${metric === "delta" ? "· negative = ahead of baseline" : ""}</span><span>Distance progress between GPS endpoints</span></div>${!lines.length ? '<p class="no-channel">No passes selected for this plot. Use Show all passes or the checkboxes below.</p>' : all.length ? "" : metric === "minimumPower" ? '<p class="no-channel">Minimum power is unavailable. Enter weights below the table and inspect data-quality reasons in the table.</p>' : '<p class="no-channel">This sensor channel wasn’t recorded.</p>'}`;
  if (metric === "minimumPower")
    $("comparison-chart").insertAdjacentHTML(
      "beforeend",
      '<p class="data-note">Approximate minimum mechanical input · resistance losses omitted; actual pedalling power may be higher. Shared physical window: ' +
        state.settings.gradeWindow +
        " m. Unsupported windows remain gaps. Interior distance-progress alignment is approximate.</p>",
    );
  state.chartData = lines;
  const legend = (f) =>
    plotValues((id) => {
      const line = lines.find((l) => l.m.id === id);
      const sample =
        line && f != null
          ? line.values.reduce(
              (best, p) =>
                !best || Math.abs(p.x - f) < Math.abs(best.x - f) ? p : best,
              null,
            )
          : null;
      return sample ? `${num(sample.y, 1)} ${units}` : "";
    });
  legend(null);
  const svg = $("comparison-chart").querySelector("svg");
  svg.onpointermove = (e) => {
    const box = svg.getBoundingClientRect(),
      f = Math.max(
        0,
        Math.min(
          1,
          (((e.clientX - box.left) / box.width) * CH.w - CH.l) /
            (CH.w - CH.l - CH.r),
        ),
      ),
      x = CH.l + f * (CH.w - CH.l - CH.r),
      cursor = $("compare-cursor");
    cursor.setAttribute("x1", x);
    cursor.setAttribute("x2", x);
    cursor.setAttribute("opacity", ".5");
    legend(f);
    const sourceMatch = plotMatches().find(
      (m) => m.rideId === state.referenceId,
    );
    mainMap.highlight(sourceMatch ? atProgress(sourceMatch.points, f) : null);
  };
  svg.onpointerleave = () => {
    $("compare-cursor").setAttribute("opacity", "0");
    legend(null);
    mainMap.highlight(null);
  };
}
function renderTerrainComparison(b, metric) {
  const axis = comparisonWorkspace.active().axis || "progress";
  $("effort-axis").value = axis;
  const units =
    metric === "speed"
      ? spdUnit()
      : metric === "ele"
        ? unit() === "imperial"
          ? "ft"
          : "m"
        : metric === "hr"
          ? "bpm"
          : metric === "cad"
            ? "rpm"
            : metric === "power" || metric === "minimumPower"
              ? "W"
              : "%";
  const axisLabel =
    axis === "progress"
      ? "Relative distance (%) · independent hill lengths"
      : axis === "elapsed"
        ? "Elapsed time from section start"
        : axis === "distance"
          ? "Distance from section start"
          : "Accumulated positive elevation changes · raw, noise sensitive";
  const xValue = (x) =>
    axis === "distance"
      ? x / (unit() === "imperial" ? 1609.344 : 1000)
      : axis === "ascent"
        ? x * (unit() === "imperial" ? 3.28084 : 1)
        : x;
  const lines = plotMatches().map((m) => {
    const grades =
      metric === "grade"
        ? gradeProfile(
            m.points,
            state.settings.gradeWindow,
            state.settings.gapSeconds,
          )
        : null;
    return {
      m,
      values:
        metric === "minimumPower"
          ? estimatedTrace(m, axis).map((sample) => ({
              ...sample,
              x: sample.x == null ? null : xValue(sample.x),
            }))
          : effortTrace(m.points, axis, state.settings.gapSeconds).map(
              (sample) => {
                let y = grades ? grades[sample.index] : sample.point[metric];
                if (metric === "ele")
                  y =
                    y != null && m.points[0].ele != null
                      ? (y - m.points[0].ele) *
                        (unit() === "imperial" ? 3.28084 : 1)
                      : null;
                if (metric === "speed" && y != null)
                  y *= unit() === "imperial" ? 2.236936 : 3.6;
                return {
                  ...sample,
                  x: sample.x == null ? null : xValue(sample.x),
                  y,
                };
              },
            ),
    };
  });
  const values = lines.flatMap((l) =>
    l.values.filter((v) => v.x != null && v.y != null),
  );
  const xMax = values.reduce(
    (max, value) => Math.max(max, value.x),
    axis === "progress" ? 1 : 0.001,
  );
  let lo = 0,
    hi = 1;
  for (const value of values) {
    lo = Math.min(lo, value.y);
    hi = Math.max(hi, value.y);
  }
  const pad = Math.max(1, (hi - lo) * 0.08);
  lo -= pad;
  hi += pad;
  if (metric === "minimumPower") lo = 0;
  if (metric === "hr") {
    const domain = hillChartDomain(
      values.map((v) => ({ mean: v.y, min: v.y, max: v.y })),
      "hr",
      "range",
    );
    lo = domain.low;
    hi = domain.high;
  }
  const x = (v) => CH.l + (v / xMax) * (CH.w - CH.l - CH.r),
    y = (v) => CH.h - CH.b - ((v - lo) / (hi - lo)) * (CH.h - CH.b - CH.t);
  const path = (series) => {
    let down = false;
    return series
      .map((v) => {
        if (v.x == null || v.y == null) {
          down = false;
          return "";
        }
        const segment = `${down && v.connected ? "L" : "M"}${x(v.x)},${y(v.y)}`;
        down = true;
        return segment;
      })
      .join(" ");
  };
  const xLabel = (v) =>
    axis === "progress"
      ? `${Math.round(v * 100)}%`
      : axis === "elapsed"
        ? fmtTime(v)
        : `${v.toFixed(axis === "distance" ? 2 : 0)} ${axis === "distance" ? (unit() === "imperial" ? "mi" : "km") : unit() === "imperial" ? "ft" : "m"}`;
  $("comparison-chart").innerHTML =
    `<svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="${esc(metric)} across different hills by ${esc(axisLabel)}">${[0, 0.5, 1].map((f) => `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(lo + (hi - lo) * f)}" y2="${y(lo + (hi - lo) * f)}" stroke="#e4e9ee"/><text x="${CH.l - 8}" y="${y(lo + (hi - lo) * f) + 4}" text-anchor="end">${num(lo + (hi - lo) * f)}</text>`).join("")}${lines.map(({ m, values }) => `<path d="${path(values)}" fill="none" data-plot-line="${esc(m.id)}" stroke="${plotColor(m)}" stroke-width="${m.id === b.id ? 3 : 2.2}" stroke-dasharray=""/>`).join("")}${[0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${x(f * xMax)}" y="${CH.h - 8}" text-anchor="middle">${esc(xLabel(f * xMax))}</text>`).join("")}<line id="compare-cursor" y1="${CH.t}" y2="${CH.h - CH.b}" stroke="#172b42" opacity="0"/></svg><div class="chart-caption"><span>${esc(units)}</span><span>${esc(axisLabel)}</span></div>${!lines.length ? '<p class="no-channel">No passes selected for this plot. Use Show all passes or the checkboxes below.</p>' : !values.length ? '<p class="no-channel">This channel or axis is unavailable.</p>' : ""}${axis === "ascent" ? '<p class="data-note">Raw ascent is noise sensitive. A trace stops at the first missing elevation or recording gap; no climb is invented across missing data.</p>' : ""}`;
  if (metric === "minimumPower")
    $("comparison-chart").insertAdjacentHTML(
      "beforeend",
      '<p class="data-note">Approximate minimum mechanical input · resistance losses omitted; actual pedalling power may be higher. Shared physical window: ' +
        state.settings.gradeWindow +
        " m. Unsupported windows remain gaps. Interior distance-progress alignment is approximate.</p>",
    );
  state.chartData = lines;
  const legend = (value = null) =>
    plotValues((id) => {
      const line = lines.find((l) => l.m.id === id);
      const sample =
        line && value != null
          ? line.values
              .filter((v) => v.x != null)
              .reduce(
                (best, v) =>
                  !best || Math.abs(v.x - value) < Math.abs(best.x - value)
                    ? v
                    : best,
                null,
              )
          : null;
      return sample ? `${num(sample.y, 1)} ${units}` : "";
    });
  legend();
  const svg = $("comparison-chart").querySelector("svg");
  svg.onpointermove = (event) => {
    const box = svg.getBoundingClientRect(),
      f = Math.max(
        0,
        Math.min(
          1,
          (((event.clientX - box.left) / box.width) * CH.w - CH.l) /
            (CH.w - CH.l - CH.r),
        ),
      ),
      value = f * xMax,
      cursor = $("compare-cursor");
    cursor.setAttribute("x1", x(value));
    cursor.setAttribute("x2", x(value));
    cursor.setAttribute("opacity", ".5");
    legend(value);
    const source = lines.find((l) => l.m.rideId === state.referenceId),
      sample = source?.values
        .filter((v) => v.x != null)
        .reduce(
          (best, v) =>
            !best || Math.abs(v.x - value) < Math.abs(best.x - value)
              ? v
              : best,
          null,
        );
    mainMap.highlight(sample?.point || null);
  };
  svg.onpointerleave = () => {
    $("compare-cursor").setAttribute("opacity", "0");
    legend();
    mainMap.highlight(null);
  };
}
function renderBudget() {
  const b = baseline(),
    c = comparison();
  $("budget-panel").hidden = !b || !c || comparisonWorkspace.hasEfforts();
  if (!b || !c || comparisonWorkspace.hasEfforts()) return;
  $("budget-comparison").innerHTML = state.matches
    .filter((m) => m.id !== b.id)
    .map(
      (m) =>
        `<option value="${esc(m.id)}">${esc(rideName(m.rideId))} · pass ${m.pass}</option>`,
    )
    .join("");
  $("budget-comparison").value = c.id;
  const a = state.budgets.get(b.id),
    d = state.budgets.get(c.id),
    gain = state.stats.get(b.id).elapsed - state.stats.get(c.id).elapsed,
    max = Math.max(
      1,
      ...Object.keys(TERRAIN).map((k) => Math.abs(a[k] - d[k])),
    );
  $("budget").innerHTML =
    `<div class="budget-layout"><div class="budget-total"><span>Elapsed time ${gain >= 0 ? "saved" : "lost"}</span><strong>${fmtTime(Math.abs(gain))}</strong><p>across this matching section</p></div><div class="terrain-rows">${Object.entries(
      TERRAIN,
    )
      .filter(([k]) => a[k] > 0.01 || d[k] > 0.01)
      .map(([k, label]) => {
        const saved = a[k] - d[k];
        return `<div class="terrain-row"><span>${label}<small>${fmtTime(a[k])} → ${fmtTime(d[k])}</small></span><div class="terrain-bar"><i class="${saved >= 0 ? "saved" : "lost"}" style="width:${(Math.abs(saved) / max) * 100}%"></i></div><strong class="${saved >= 0 ? "positive" : "negative"}">${saved >= 0 ? "−" : "+"}${fmtTime(Math.abs(saved))}</strong></div>`;
      })
      .join(
        "",
      )}</div></div><p class="budget-method">Grade window: ${state.settings.gradeWindow} m · level road: ±${state.settings.gradeThreshold}% · road profile: ${esc(rideName(comparisonWorkspace.active().road.rideId))}</p>`;
}
function renderContext() {
  const contextRides = [
    ...new Set(
      comparisonWorkspace.active()?.entries.map((e) => e.rideId) || [],
    ),
  ]
    .filter((id) => state.selected.includes(id))
    .map((id) => loaded.get(id))
    .filter(Boolean);
  $("context").innerHTML = contextRides
    .map((r) => {
      const s = summarize(r.points, state.settings);
      return `<article class="context-card"><strong>${esc(r.name)}</strong><dl><dt>Recorded elapsed</dt><dd>${fmtTime(r.deviceElapsed ?? s.elapsed)}</dd><dt>Device timer</dt><dd>${fmtTime(r.deviceTimer)}</dd><dt>Device moving</dt><dd>${fmtTime(r.deviceMoving)}</dd><dt>Average / max HR</dt><dd>${num(s.hr)} / ${num(s.maxHr)} bpm</dd><dt>Power / cadence</dt><dd>${num(s.power)} W / ${num(s.cadence)} rpm</dd><dt>Recording gaps</dt><dd>${fmtTime(s.gaps)}</dd></dl><p>${esc(r.notes.bike || "Bike not noted")}${r.notes.gearing ? " · " + esc(r.notes.gearing) : ""}</p>${r.notes.conditions ? `<p>${esc(r.notes.conditions)}</p>` : ""}${r.notes.notes ? `<p>${esc(r.notes.notes)}</p>` : ""}<button class="text-button" data-notes="${esc(r.id)}">Edit setup and conditions</button>${r.warnings?.length ? `<details><summary>${r.warnings.length} data notes</summary>${r.warnings.map((w) => `<p>${esc(w)}</p>`).join("")}</details>` : ""}</article>`;
    })
    .join("");
}
async function imports(files) {
  await task(
    `Importing ${files.length} file${files.length === 1 ? "" : "s"}…`,
    async () => {
      const report = { imported: 0, duplicates: 0, skipped: [], warnings: [] };
      for (const file of files) {
        if (file.size > 200 * 1024 * 1024) {
          report.skipped.push(
            `${file.name}: exceeds 200 MiB. Select individual activity files.`,
          );
          continue;
        }
        const v = await api("/api/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        });
        report.imported += v.imported;
        report.duplicates += v.duplicates;
        report.skipped.push(...v.skipped);
        report.warnings.push(...v.warnings);
      }
      $("import-report").hidden = false;
      $("report-title").textContent =
        `${report.imported} imported · ${report.duplicates} duplicates · ${report.skipped.length} skipped`;
      $("report-content").innerHTML = [...report.skipped, ...report.warnings]
        .map((s) => `<p>${esc(s)}</p>`)
        .join("");
      await refresh();
    },
  );
  $("files").value = "";
}
function openNotes(id) {
  const r = loaded.get(id) || state.rides.find((r) => r.id === id);
  state.notesId = id;
  for (const k of ["name", "bike", "gearing", "conditions", "notes"])
    $(`note-${k}`).value = k === "name" ? r.name : r.notes[k];
  $("notes-dialog").showModal();
}
const csv = (v) => {
  let s = String(v ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
function exportCSV() {
  const head = [
    "ride",
    "date",
    "pass",
    "manual",
    "elapsed_s",
    "timer_s",
    "moving_estimate_s",
    "distance_m",
    "speed_m_s",
    "avg_hr_bpm",
    "max_hr_bpm",
    "cadence_rpm",
    "recorded_power_w",
    "grade_pct",
    "max_grade_pct",
    "grade_window_m",
    "start_lat",
    "start_lon",
    "end_lat",
    "end_lon",
    "start_offset_m",
    "end_offset_m",
    "max_route_offset_m",
    "gps_geometry_bridge_s",
    "bike",
    "gearing",
    "conditions",
    "notes",
    "comparison_name",
    "comparison_entry_id",
    "entry_kind",
    "baseline_entry_id",
    "source_start_index",
    "source_end_index",
    "road_relationship",
    "road_review",
    "comparison_mode",
    "effort_axis",
    "hill_observation_id",
    "hill_group_id",
    "gravity_only_power_w",
    "gravity_total_mass_kg",
    "gravity_net_gain_m",
    "gravity_elevation_basis",
    "gravity_estimate_status",
    "minimum_input_power_w",
    "kinetic_component_w",
    "minimum_input_sensitivity_low_w",
    "minimum_input_sensitivity_high_w",
    "start_speed_estimate_m_s",
    "end_speed_estimate_m_s",
    "assumed_height_difference_error_m",
    "assumed_endpoint_speed_error_m_s",
    "windowed_minimum_average_w",
    "windowed_minimum_supported_seconds",
    "windowed_minimum_time_coverage",
  ];
  const rows = state.matches.map((m) => {
    const r = loaded.get(m.rideId),
      s = state.stats.get(m.id),
      gravity = gravityEstimate(m),
      energy = state.energyEstimates.get(m.id);
    return [
      r.name,
      r.date,
      m.pass,
      !!m.manual,
      s.elapsed,
      s.timer,
      s.moving,
      s.distance,
      s.speed,
      s.hr,
      s.maxHr,
      s.cadence,
      s.power,
      s.grade,
      s.maxGrade,
      state.settings.gradeWindow,
      m.points[0].lat,
      m.points[0].lon,
      m.points.at(-1).lat,
      m.points.at(-1).lon,
      m.startMiss,
      m.endMiss,
      m.routeError,
      m.gpsBridgeSeconds ?? null,
      r.notes.bike,
      r.notes.gearing,
      r.notes.conditions,
      r.notes.notes,
      comparisonWorkspace.active().name || "Untitled comparison",
      m.id,
      m.kind,
      state.baseline,
      m.startIndex,
      m.endIndex,
      m.relation,
      m.review,
      comparisonWorkspace.active().mode || "same-road",
      comparisonWorkspace.active().axis || "progress",
      comparisonWorkspace.active().entries.find((e) => e.id === m.id)
        ?.hillObservationId || "",
      comparisonWorkspace.active().entries.find((e) => e.id === m.id)
        ?.hillGroupId || "",
      gravity.watts,
      gravity.massKg,
      gravity.netGainMeters,
      gravity.basis,
      gravity.reason || "Gravity-only estimate",
      energy.minimumWatts,
      energy.kineticWatts,
      energy.lowerWatts,
      energy.upperWatts,
      energy.startSpeed,
      energy.endSpeed,
      state.settings.powerHeightErrorM,
      state.settings.powerSpeedErrorMps,
      state.energyProfiles.get(m.id).average?.watts,
      state.energyProfiles.get(m.id).average?.supportedSeconds,
      state.energyProfiles.get(m.id).average?.coverage,
    ]
      .map(csv)
      .join(",");
  });
  const url = URL.createObjectURL(
      new Blob([[head.join(","), ...rows].join("\r\n")], { type: "text/csv" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "noboride-section-comparison.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function settingsChanged() {
  render();
  comparisonWorkspace.soon();
  clearTimeout(settingsTimeout);
  settingsTimeout = setTimeout(
    () =>
      api("/api/settings", json("PUT", state.settings)).catch((e) =>
        message(e.message, true),
      ),
    300,
  );
}
$("gravity-masses").onsubmit = async (event) => {
  event.preventDefault();
  if ($("gravity-apply").disabled) return;
  const c = comparisonWorkspace.active(),
    previous = {
      riderMassKg: state.settings.riderMassKg,
      bikeMassKg: state.settings.bikeMassKg,
      powerHeightErrorM: state.settings.powerHeightErrorM,
      powerSpeedErrorMps: state.settings.powerSpeedErrorMps,
    },
    draft = [
      $("gravity-rider").value,
      $("gravity-bike").value,
      $("power-height-error").value,
      $("power-speed-error").value,
    ],
    factor = unit() === "imperial" ? 0.45359237 : 1;
  try {
    const masses = validateGravityMasses({
      riderMassKg: draft[0].trim() ? Number(draft[0]) * factor : null,
      bikeMassKg: draft[1].trim() ? Number(draft[1]) * factor : null,
    });
    const errors = validatePowerErrors({
      powerHeightErrorM: draft[2].trim()
        ? Number(draft[2]) / (unit() === "imperial" ? 3.28084 : 1)
        : null,
      powerSpeedErrorMps: draft[3].trim()
        ? Number(draft[3]) / (unit() === "imperial" ? 2.236936 : 1)
        : null,
    });
    Object.assign(state.settings, masses, errors);
  } catch (error) {
    $("gravity-status").textContent = error.message;
    return;
  }
  $("gravity-apply").disabled = true;
  $("gravity-apply").setAttribute("aria-busy", "true");
  $("gravity-status").textContent = "Saving weights…";
  try {
    await comparisonWorkspace.save();
    $("gravity-status").textContent = "Weights saved in this comparison.";
    render();
  } catch (error) {
    Object.assign(state.settings, previous);
    Object.assign(c.settings, previous);
    render();
    $("gravity-rider").value = draft[0];
    $("gravity-bike").value = draft[1];
    $("power-height-error").value = draft[2];
    $("power-speed-error").value = draft[3];
    $("gravity-status").textContent =
      `Not saved: ${error.message}. Your weight entries are retained for retry.`;
  } finally {
    $("gravity-apply").disabled = false;
    $("gravity-apply").setAttribute("aria-busy", "false");
  }
};
for (const id of ["choose-files", "add-ride", "welcome-import"])
  $(id).onclick = () => $("files").click();
$("files").onchange = (e) => imports([...e.target.files]);
$("drop-zone").ondragover = (e) => {
  e.preventDefault();
};
$("drop-zone").ondrop = (e) => {
  e.preventDefault();
  imports([...e.dataTransfer.files]);
};
$("filter").oninput = renderRides;
$("ride-list").onchange = (e) => {
  const id = e.target.dataset.include;
  if (!id) return;
  task("Loading selected ride…", async () => {
    if (state.selected.includes(id))
      state.selected = state.selected.filter((x) => x !== id);
    else {
      await getRide(id);
      state.selected.push(id);
    }
    persistSelection();
    render();
  });
};
$("include-shown").onclick = () =>
  task("Loading rides…", async () => {
    const q = $("filter").value.toLowerCase(),
      ids = state.rides
        .filter((r) =>
          `${r.name} ${r.notes.bike} ${date(r.date)}`.toLowerCase().includes(q),
        )
        .map((r) => r.id);
    await Promise.all(ids.map(getRide));
    state.selected = ids;
    persistSelection();
    render();
  });
$("clear-rides").onclick = () =>
  task("Clearing source rides…", async () => {
    state.selected = [];
    persistSelection();
    render();
  });
$("demo").onclick = () =>
  task("Loading synthetic demonstration rides…", async () => {
    await api("/api/demo", json("POST"));
    await refresh();
  });
$("restore-button").onclick = () => $("restore-file").click();
$("restore-file").onchange = (e) => {
  const file = e.target.files[0];
  if (file)
    task("Restoring workspace…", async () => {
      if (file.size > 200 * 1024 * 1024)
        throw new Error("Backup exceeds 200 MiB.");
      await api("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      await refresh(true);
    });
  e.target.value = "";
};
$("ride-tabs").onclick = (e) => {
  const tab = e.target.closest("[data-source-ride]");
  if (tab)
    task("Opening source ride…", () =>
      comparisonWorkspace.browseRide(tab.dataset.sourceRide),
    );
};
$("ride-tabs").onkeydown = (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const tabs = [...$("ride-tabs").querySelectorAll("[role=tab]")];
  if (!tabs.length) return;
  const current = tabs.indexOf(document.activeElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (current + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  e.preventDefault();
  tabs[next].click();
};
$("start-range").oninput = (e) =>
  changeRange(Math.min(+e.target.value, state.end - 1), state.end);
$("end-range").oninput = (e) =>
  changeRange(state.start, Math.max(+e.target.value, state.start + 1));
for (const endpoint of ["start", "end"]) {
  const snap = () => {
    const raw = $(`${endpoint}-coordinate`).value.split(",");
    const coords = raw.map(Number);
    if (
      raw.length !== 2 ||
      raw.some((v) => !v.trim()) ||
      !coords.every(Number.isFinite) ||
      Math.abs(coords[0]) > 90 ||
      Math.abs(coords[1]) > 180
    ) {
      message("Use latitude, longitude in decimal degrees.", true);
      return;
    }
    selectOnMap({ lat: coords[0], lon: coords[1] }, endpoint);
  };
  $(`snap-${endpoint}`).onclick = snap;
  $(`${endpoint}-coordinate`).onkeydown = (e) => {
    if (e.key === "Enter") snap();
  };
}
$("fit-map").onclick = () => mainMap.fit();
$("grade-window").oninput = (e) => {
  state.settings.gradeWindow = +e.target.value;
  settingsChanged();
};
for (const [id, key] of [
  ["units", "units"],
  ["radius", "matchRadius"],
  ["grade-threshold", "gradeThreshold"],
  ["moving-threshold", "movingThreshold"],
  ["gap", "gapSeconds"],
])
  $(id).onchange = (e) => {
    state.settings[key] = key === "units" ? e.target.value : +e.target.value;
    settingsChanged();
  };
$("settings-button").onclick = () => {
  renderSettings();
  $("settings").showModal();
};
$("suggestion-overlap").oninput = (event) => {
  state.settings.suggestionOverlap = +event.target.value;
  settingsChanged();
};
$("help-button").onclick = () => $("help-dialog").showModal();
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
$("baseline").onchange = (e) => {
  state.baseline = e.target.value;
  render();
  comparisonWorkspace.soon();
};
$("budget-comparison").onchange = (e) => {
  state.comparison = e.target.value;
  renderSummary();
  renderBudget();
  comparisonWorkspace.soon();
};
$("plot-colors").onchange = (e) =>
  changePlot((p) => {
    p.colorMode = e.target.value;
  });
$("plot-all").onclick = () =>
  changePlot((p) => {
    p.hidden = [];
  });
$("plot-none").onclick = () =>
  changePlot((p) => {
    p.hidden = state.matches.map((m) => m.id);
  });
$("legend").onchange = (event) => {
  const input = event.target.closest("[data-plot-entry]");
  if (input)
    changePlot((p) => {
      p.hidden = input.checked
        ? p.hidden.filter((id) => id !== input.dataset.plotEntry)
        : [...new Set([...p.hidden, input.dataset.plotEntry])];
    });
};
$("legend").onpointerover = (event) =>
  highlightPlot(event.target.closest("[data-plot-key]")?.dataset.plotKey);
$("legend").onpointerleave = () =>
  highlightPlot(
    document.activeElement?.closest?.("[data-plot-key]")?.dataset.plotKey,
  );
$("legend").addEventListener("focusin", (event) =>
  highlightPlot(event.target.closest("[data-plot-key]")?.dataset.plotKey),
);
$("legend").addEventListener("focusout", (event) =>
  highlightPlot(
    event.relatedTarget?.closest?.("[data-plot-key]")?.dataset.plotKey,
  ),
);
$("metric").onchange = (e) => {
  state.metric = e.target.value;
  renderComparison();
  comparisonWorkspace.soon();
};
$("effort-axis").onchange = (event) => {
  comparisonWorkspace.active().axis = event.target.value;
  renderComparison();
  comparisonWorkspace.soon();
};
$("comparisons-tab").onclick = () => showView("comparisons");
$("hills-tab").onclick = () => showView("hills");
$("progress-tab").onclick = () => showView("progress");
$("hill-guidance").onclick = async (event) => {
  const summaryButton = event.target.closest("[data-open-hills]");
  if (summaryButton) {
    await showView("hills");
    await hillLibrary.showSummary(summaryButton.dataset.openHills);
  }
  const button = event.target.closest("[data-hill-preview]");
  if (button) {
    const observation = hillLibrary
      .data()
      ?.observations.find((o) => o.id === button.dataset.hillPreview);
    if (observation)
      task("Previewing a reviewed hill pass…", () =>
        comparisonWorkspace.previewHill(observation),
      );
  }
};
$("export").onclick = exportCSV;
window.addEventListener("click", (e) => {
  const rename = e.target.closest("[data-ride-rename]");
  if (rename && !state.busy) {
    const ride = state.rides.find((r) => r.id === rename.dataset.rideRename);
    rideRename = { id: ride.id, draft: ride.name, error: "" };
    renderRides();
    const input = $("ride-list").querySelector("[data-ride-name-input]");
    input.focus({ preventScroll: true });
    input.select();
  }
  if (e.target.closest("[data-ride-name-cancel]")) {
    rideRename = null;
    renderRides();
  }
  const notes = e.target.closest("[data-notes]");
  if (notes) openNotes(notes.dataset.notes);
  const edit = e.target.closest("#matches [data-entry-edit]");
  if (edit)
    task("Editing comparison stretch…", () =>
      comparisonWorkspace.editEntry(edit.dataset.entryEdit),
    );
});
$("ride-list").addEventListener("input", (event) => {
  if (event.target.matches("[data-ride-name-input]") && rideRename)
    rideRename.draft = event.target.value;
});
$("ride-list").addEventListener("keydown", (event) => {
  if (event.key === "Escape" && rideRename) {
    event.preventDefault();
    event.stopPropagation();
    rideRename = null;
    renderRides();
  }
});
$("ride-list").addEventListener("submit", (event) => {
  const form = event.target.closest("[data-ride-name-form]");
  if (!form) return;
  event.preventDefault();
  const name = form.querySelector("input").value.trim();
  if (!name) {
    rideRename.error = "Enter an activity name.";
    form.querySelector("[data-ride-name-error]").textContent = rideRename.error;
    return;
  }
  task("Renaming activity…", async () => {
    try {
      const id = form.dataset.rideNameForm;
      await api(`/api/rides/${id}`, json("PATCH", { name }));
      if (loaded.has(id)) loaded.get(id).name = name;
      state.rides.find((ride) => ride.id === id).name = name;
      rideRename = null;
      render();
    } catch (error) {
      if (rideRename) {
        rideRename.error = error.message;
        form.querySelector("[data-ride-name-error]").textContent =
          error.message;
      }
      throw error;
    }
  });
});
$("notes-form").onsubmit = (e) => {
  e.preventDefault();
  task("Saving notes…", async () => {
    const r =
        loaded.get(state.notesId) ||
        state.rides.find((r) => r.id === state.notesId),
      name = $("note-name").value,
      notes = Object.fromEntries(
        ["bike", "gearing", "conditions", "notes"].map((k) => [
          k,
          $(`note-${k}`).value,
        ]),
      );
    await api(`/api/rides/${r.id}`, json("PATCH", { name, notes }));
    if (loaded.has(r.id)) Object.assign(loaded.get(r.id), { name, notes });
    Object.assign(
      state.rides.find((x) => x.id === r.id),
      { name, notes },
    );
    $("notes-dialog").close();
    render();
  });
};
$("delete-ride").onclick = () => {
  if (confirm("Delete this ride from the local workspace?"))
    task("Deleting ride…", async () => {
      await api(`/api/rides/${state.notesId}`, json("DELETE"));
      loaded.delete(state.notesId);
      $("notes-dialog").close();
      await refresh(true);
    });
};
window.addEventListener("error", (e) =>
  message(`Dashboard error: ${e.message}`, true),
);
window.addEventListener("unhandledrejection", (e) =>
  message(e.reason?.message || String(e.reason), true),
);
comparisonWorkspace = createComparisonWorkspace({
  state,
  loaded,
  getRide,
  api,
  json,
  render,
  task,
  esc,
  rideName,
  persistSelection,
  onOpenRange: (entry) => rideStory?.openRange(entry),
  getSection: () => rideStory?.selectedSection(),
  onSavedSection: (section) => rideStory?.acceptSaved(section),
});
rideStory = createRideStory({
  state,
  loaded,
  task,
  esc,
  onRange: changeRange,
  onChooseSection: (section) => comparisonWorkspace.beginSelection(section),
  definitions: (ride) => comparisonWorkspace.sectionDefinitions(ride),
  members: (section) => comparisonWorkspace.sectionMembers(section),
  entrySectionId: (entry) => comparisonWorkspace.entrySectionId(entry),
  saveSection: (section) => comparisonWorkspace.saveSection(section),
  deleteSection: (section) => comparisonWorkspace.deleteSection(section),
  onDraftChange: () => comparisonWorkspace.render(),
  savedRanges: () => comparisonWorkspace.sourceStretches(),
  onSavedRange: (id) => comparisonWorkspace.editEntry(id, { scroll: false }),
  color,
  highlight: (point) => mainMap.highlight(point),
  updateMap: (ride, window, start, end) => {
    mainMap.update(
      [
        {
          ...ride,
          viewKey: `${ride.id}:${window.start}:${window.end}`,
          points: ride.points.slice(window.start, window.end + 1),
        },
      ],
      comparisonWorkspace
        .sourceStretches()
        .filter(
          (entry) => entry.end >= window.start && entry.start <= window.end,
        ),
      ride,
      start,
      end,
    );
  },
});
hillLibrary = createHillLibrary({
  applyHillBounds: (updates) => comparisonWorkspace.applyHillBounds(updates),
  rangeSummary: (range) => comparisonWorkspace.rangeSummary(range),
  state,
  getRide,
  api,
  json,
  esc,
  rideName,
  getComparison: () => comparisonWorkspace.active(),
  onChange: () => renderHillGuidance(),
  onCompare: async (observations, mode, name) => {
    if (state.busy)
      throw new Error(
        "Wait for the current operation to finish, then try again.",
      );
    state.busy = true;
    document.body.classList.add("working");
    try {
      await comparisonWorkspace.createFromHills(
        observations,
        mode,
        name,
        hillLibrary.data().library,
      );
      await showView("comparisons");
    } finally {
      state.busy = false;
      document.body.classList.remove("working");
    }
  },
});
mechanicalProfile = createGravityProfile({
  host: $("gravity-profile"),
  state,
  getMatches: () => state.matches,
  getProfile: (match) => state.energyProfiles.get(match.id),
  getElevation: powerElevation,
  name: (m) => `${rideName(m.rideId)} · pass ${m.pass}`,
  esc,
  onWindow(value) {
    state.settings.gradeWindow = value;
    settingsChanged();
  },
  onCursor: (point) => mainMap.highlight(point),
});
$("gravity-power").addEventListener("toggle", () => {
  if ($("gravity-power").open) mechanicalProfile.render();
});
progressView = createProgress({
  host: $("progress-content"),
  state,
  contexts: () => comparisonWorkspace.contexts(),
  getActiveId: () => comparisonWorkspace.active()?.id,
  getRide,
  esc,
  onComparisons: () => showView("comparisons"),
  onOpen: (contextId, entryId) =>
    task("Opening progress pass…", async () => {
      await showView("comparisons");
      await comparisonWorkspace.openProgressEntry(contextId, entryId);
    }),
  onInclude: (rideId) =>
    task("Including progress ride…", async () => {
      await comparisonWorkspace.includeRides([rideId]);
      comparisonWorkspace.soon();
    }),
});
task("Loading your local workspace…", () => refresh(true));
