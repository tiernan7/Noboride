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
  findMatches,
  manualMatch,
  terrainBudget,
  deltaCurve,
} from "/analysis.mjs";
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
  segments: [],
  settings: { ...DEFAULTS },
  selected: [],
  referenceId: "",
  start: 0,
  end: 1,
  scope: "full",
  overrides: {},
  baseline: "",
  comparison: "",
  metric: "ele",
  tool: null,
  matches: [],
  stats: new Map(),
  budgets: new Map(),
  canonical: [],
  busy: false,
  manual: null,
  notesId: "",
  chartData: [],
};
const loaded = new Map(),
  pending = new Map();
let settingsTimeout,
  hoverPoint = null,
  profileDrag = null;
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
async function api(path, options) {
  const r = await fetch(path, options),
    v = await r.json();
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
  const v = await api("/api/workspace");
  state.rides = v.rides;
  state.segments = v.segments;
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
  if (!state.selected.length && state.rides.length && !initial)
    state.selected = state.rides.slice(0, 3).map((r) => r.id);
  await Promise.all(state.selected.map(getRide));
  if (
    !state.referenceId ||
    !state.rides.some((r) => r.id === state.referenceId)
  ) {
    const candidate =
      [...included()].sort((a, b) => a.points[0].t - b.points[0].t)[0] ||
      (state.rides.length ? await getRide(state.rides[0].id) : null);
    if (candidate) {
      state.referenceId = candidate.id;
      state.start = 0;
      state.end = candidate.points.length - 1;
      state.scope = "full";
      state.overrides = {};
    }
  }
  persistSelection();
  render();
}
function compute() {
  const r = ref();
  if (!r) {
    state.canonical = [];
    state.matches = [];
    return;
  }
  state.start = Math.max(0, Math.min(state.start, r.points.length - 2));
  state.end = Math.min(
    r.points.length - 1,
    Math.max(state.start + 1, state.end),
  );
  state.canonical = r.points.slice(state.start, state.end + 1);
  state.matches = included().flatMap((ride) => {
    const o = state.overrides[ride.id];
    return o
      ? [manualMatch(ride, o.start, o.end)]
      : findMatches(ride, state.canonical, state.settings.matchRadius);
  });
  state.stats = new Map(
    state.matches.map((m) => [m.id, summarize(m.points, state.settings)]),
  );
  state.budgets = new Map(
    state.matches.map((m) => [
      m.id,
      terrainBudget(m.points, state.canonical, state.settings),
    ]),
  );
  if (!state.matches.some((m) => m.id === state.baseline))
    state.baseline =
      [...state.matches].sort((a, b) => a.points[0].t - b.points[0].t)[0]?.id ||
      "";
  if (
    !state.matches.some(
      (m) => m.id === state.comparison && m.id !== state.baseline,
    )
  )
    state.comparison =
      [...state.matches].reverse().find((m) => m.id !== state.baseline)?.id ||
      "";
}
function render() {
  compute();
  renderRides();
  renderSettings();
  $("welcome").hidden = !!state.rides.length;
  $("workspace").hidden = !state.rides.length;
  renderControls();
  if (ref()) {
    renderSummary();
    renderProfile();
    renderEndpoints();
    renderMatches();
    renderComparison();
    renderBudget();
    renderContext();
    mainMap.update(included(), state.matches, ref(), state.start, state.end);
  }
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
        `<article class="ride-card ${state.selected.includes(r.id) ? "included" : ""}"><label class="ride-toggle"><input type="checkbox" data-include="${esc(r.id)}" ${state.selected.includes(r.id) ? "checked" : ""}><span class="ride-dot" style="background:${state.selected.includes(r.id) ? color(r.id) : "#b2bdc8"}"></span><span><strong>${esc(r.name)}</strong><small>${esc(date(r.date))} ${r.demo ? '<b class="demo-pill">DEMO</b>' : ""}</small></span></label><div class="ride-stats"><span>${r.overview ? dist(r.overview.distance, 1) : ""}</span><span>${r.overview ? fmtTime(r.overview.elapsed) : ""}</span><button class="text-button" data-notes="${esc(r.id)}">Notes</button></div>${r.notes.bike ? `<div class="bike-tag">↝ ${esc(r.notes.bike)}</div>` : ""}</article>`,
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
}
function renderControls() {
  $("reference").innerHTML = state.rides
    .map(
      (r) =>
        `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(date(r.date))}</option>`,
    )
    .join("");
  $("reference").value = state.referenceId;
  $("scope").innerHTML =
    '<option value="full">Full reference route</option>' +
    (state.scope === "draft"
      ? '<option value="draft">Unsaved selection</option>'
      : "") +
    state.segments
      .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
      .join("");
  $("scope").value = state.scope;
  $("delete-section").hidden = !state.segments.some(
    (s) => s.id === state.scope,
  );
  $("set-start").classList.toggle("active", state.tool === "start");
  $("set-end").classList.toggle("active", state.tool === "end");
}
function baseline() {
  return state.matches.find((m) => m.id === state.baseline);
}
function comparison() {
  return state.matches.find((m) => m.id === state.comparison);
}
function renderSummary() {
  const s = summarize(state.canonical, state.settings),
    b = baseline(),
    c = comparison(),
    gain =
      b && c
        ? state.stats.get(b.id).elapsed - state.stats.get(c.id).elapsed
        : null;
  const cards = [
    ["Matched passes", state.matches.length, `from ${included().length} rides`],
    [
      "Selected road",
      dist(s.distance),
      state.scope === "full" ? "Full reference route" : "GPS-matched section",
    ],
    [
      "Reference grade",
      `${num(s.grade, 1)}%`,
      `Peak ${num(s.maxGrade, 1)}% over ${state.settings.gradeWindow} m`,
    ],
    [
      "Selected comparison",
      gain == null ? "—" : fmtTime(Math.abs(gain)),
      gain == null
        ? "Include another matching ride"
        : gain >= 0
          ? "Faster than the baseline"
          : "Slower than the baseline",
    ],
  ];
  $("summary").innerHTML = cards
    .map(
      ([label, value, sub], i) =>
        `<div class="summary-card ${i === 3 && gain > 0 ? "gain-card" : ""}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`,
    )
    .join("");
}
function changeRange(start, end) {
  state.start = start;
  state.end = end;
  state.scope = "draft";
  state.overrides = {};
  render();
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
  state.tool = null;
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
    this.tile = null;
    this.key = "";
    this.bounds = null;
    this.onSelect = onSelect;
    this.map.on("click", (e) => onSelect(e.latlng, state.tool));
    new ResizeObserver(() => this.map.invalidateSize()).observe($(id));
  }
  tiles(on) {
    if (on && !this.tile)
      this.tile = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        },
      ).addTo(this.map);
    else if (!on && this.tile) {
      this.map.removeLayer(this.tile);
      this.tile = null;
    }
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
      add(m.points, { color: color(m.rideId), weight: 5, opacity: 0.9 });
      for (const [p, label] of [
        [m.points[0], "Start"],
        [m.points.at(-1), "End"],
      ])
        if (hasGPS(p)) {
          const tip = document.createElement("span");
          tip.textContent = `${rideName(m.rideId)} · pass ${m.pass} · ${label}`;
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
        marker.on("dragend", () => this.onSelect(marker.getLatLng(), type));
      }
    }
    const key = rides.map((r) => r.id).join(":") + ":" + reference?.id;
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
      this.map.fitBounds(this.bounds, { padding: [35, 35], maxZoom: 16 });
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
let manualMap = null;
const CH = { w: 780, h: 218, l: 48, r: 16, t: 20, b: 32 };
function gradeColor(g) {
  return g == null
    ? "#ccd5de"
    : g < 3
      ? "#b4ceb4"
      : g < 6
        ? "#ebc16a"
        : g < 9
          ? "#e98a4d"
          : g < 12
            ? "#d95d53"
            : "#a63b4d";
}
function profileHTML(points, start, end) {
  if (points.length < 2) return "";
  const g = gradeProfile(
      points,
      state.settings.gradeWindow,
      state.settings.gapSeconds,
    ),
    alts = points.filter((p) => p.ele != null).map((p) => p.ele),
    lo = alts.length ? alts.reduce((a, b) => Math.min(a, b), Infinity) - 5 : 0,
    hi = alts.length
      ? alts.reduce((a, b) => Math.max(a, b), -Infinity) + 5
      : 100,
    len = points.at(-1).d - points[0].d,
    x = (p) =>
      CH.l + (len ? (p.d - points[0].d) / len : 0) * (CH.w - CH.l - CH.r),
    y = (v) => CH.h - CH.b - ((v - lo) / (hi - lo)) * (CH.h - CH.b - CH.t),
    step = Math.max(1, Math.floor(points.length / 900));
  let content = "";
  for (let i = 0; i < points.length - 1; i += step) {
    const j = Math.min(points.length - 1, i + step),
      a = points[i],
      b = points[j];
    if (
      a.ele == null ||
      b.ele == null ||
      b.breakBefore ||
      b.t - a.t > state.settings.gapSeconds * 1000
    )
      continue;
    content += `<path d="M${x(a)},${CH.h - CH.b}L${x(a)},${y(a.ele)}L${x(b)},${y(b.ele)}L${x(b)},${CH.h - CH.b}Z" fill="${gradeColor(g[i])}"/>`;
  }
  const grid = [0, 0.5, 1]
    .map((f) => {
      const v = lo + (hi - lo) * f;
      return `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e9ef"/><text x="${CH.l - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * (unit() === "imperial" ? 3.28084 : 1))}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${CH.w} ${CH.h}" class="profile-svg" role="img" aria-label="Elevation profile. Drag to select a road section.">${grid}${content}<rect data-brush x="${x(points[start])}" y="${CH.t}" width="${Math.max(1, x(points[end]) - x(points[start]))}" height="${CH.h - CH.b - CH.t}" fill="#2075d3" opacity=".12"/>${[start, end].map((i, j) => `<line x1="${x(points[i])}" x2="${x(points[i])}" y1="${CH.t}" y2="${CH.h - CH.b}" stroke="${j ? "#d2764b" : "#287bd5"}" stroke-width="2" stroke-dasharray="4 3"/><text x="${x(points[i]) + (j ? -4 : 4)}" y="12" text-anchor="${j ? "end" : "start"}">${j ? "END" : "START"}</text>`).join("")}${[0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${CH.l + f * (CH.w - CH.l - CH.r)}" y="${CH.h - 8}" text-anchor="middle">${dist(len * f, 1)}</text>`).join("")}</svg><div class="chart-caption"><span data-profile-caption>Drag a range to select road</span><span>${state.settings.gradeWindow} m grade window</span></div>`;
}
function bindProfile(container, points, onRange, onHover) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const locate = (clientX) => {
    const box = svg.getBoundingClientRect(),
      f = Math.max(
        0,
        Math.min(
          1,
          (((clientX - box.left) / box.width) * CH.w - CH.l) /
            (CH.w - CH.l - CH.r),
        ),
      );
    return lowerBound(
      points,
      points[0].d + (points.at(-1).d - points[0].d) * f,
    );
  };
  svg.onpointerdown = (e) => {
    if (e.button !== 0) return;
    profileDrag = {
      svg,
      container,
      points,
      start: locate(e.clientX),
      locate,
      onRange,
    };
    e.preventDefault();
  };
  svg.onpointermove = (e) => {
    if (profileDrag) return;
    const i = locate(e.clientX),
      g = gradeProfile(
        points,
        state.settings.gradeWindow,
        state.settings.gapSeconds,
      );
    container.querySelector("[data-profile-caption]").textContent =
      `${dist(points[i].d - points[0].d)} · ${elev(points[i].ele)} · ${num(g[i], 1)}%`;
    onHover(points[i]);
  };
  svg.onpointerleave = () => {
    if (!profileDrag) onHover(null);
  };
}
function renderProfile() {
  $("profile").innerHTML = profileHTML(ref().points, state.start, state.end);
  bindProfile($("profile"), ref().points, changeRange, (p) =>
    mainMap.highlight(p),
  );
}
window.addEventListener("pointermove", (e) => {
  if (!profileDrag) return;
  const d = profileDrag,
    i = d.locate(e.clientX),
    points = d.points,
    len = points.at(-1).d - points[0].d,
    x = (k) =>
      CH.l +
      (len ? (points[k].d - points[0].d) / len : 0) * (CH.w - CH.l - CH.r),
    r = d.svg.querySelector("[data-brush]");
  r.setAttribute("x", Math.min(x(i), x(d.start)));
  r.setAttribute("width", Math.max(1, Math.abs(x(i) - x(d.start))));
});
window.addEventListener("pointerup", (e) => {
  if (!profileDrag) return;
  const d = profileDrag,
    i = d.locate(e.clientX);
  profileDrag = null;
  if (i !== d.start) d.onRange(Math.min(i, d.start), Math.max(i, d.start));
});
window.addEventListener("pointercancel", () => (profileDrag = null));
function renderMatches() {
  const b = baseline();
  $("baseline").innerHTML = state.matches
    .map(
      (m) =>
        `<option value="${esc(m.id)}">${esc(rideName(m.rideId))} · pass ${m.pass}</option>`,
    )
    .join("");
  $("baseline").value = state.baseline;
  $("matches").innerHTML = state.matches.length
    ? `<table><thead><tr><th>Ride / pass</th><th>Elapsed</th><th>Δ baseline</th><th>Moving est.</th><th>Avg speed</th><th>Avg HR</th><th>Cadence</th><th>GPS offsets</th><th></th></tr></thead><tbody>${state.matches
        .map((m) => {
          const s = state.stats.get(m.id),
            base = m.id === b.id,
            delta = s.elapsed - state.stats.get(b.id).elapsed;
          return `<tr class="${base ? "baseline" : ""}"><td><strong class="table-ride"><i style="background:${color(m.rideId)}"></i>${esc(rideName(m.rideId))}</strong><small>Pass ${m.pass} · ${dist(s.distance)}${m.manual ? " · manual" : ""}${base ? " · baseline" : ""}</small></td><td class="strong">${fmtTime(s.elapsed)}</td><td class="${delta < 0 ? "positive" : ""}">${base ? "—" : fmtTime(delta, true)}</td><td>${fmtTime(s.moving)}</td><td>${spd(s.speed)} <small>${spdUnit()}</small></td><td>${num(s.hr)} <small>bpm</small></td><td>${num(s.cadence)} <small>rpm</small></td><td title="${m.manual ? "Manual selection: automatic road checks bypassed" : `Max ordered-route offset: ${num(m.routeError, 1)}m${m.gpsBridgeSeconds ? `; GPS gap bridged for geometry checks: ${num(m.gpsBridgeSeconds)} seconds` : ""}`}">${m.manual ? "Manual" : `${Math.round(m.startMiss)} / ${Math.round(m.endMiss)} m`}${!m.manual && m.gpsBridgeSeconds ? `<small>GPS gap: ${num(m.gpsBridgeSeconds)} s</small>` : ""}</td><td><button class="text-button" data-adjust="${esc(m.id)}">Adjust</button></td></tr>`;
        })
        .join("")}</tbody></table>`
    : '<div class="inline-empty"><h3>No matching passes yet</h3><p>Include a ride, select at least 20 meters, and check that both endpoints have GPS. Try a wider GPS gate radius for noisy tracks.</p></div>';
  $("timing-note").textContent =
    `Moving time is estimated above ${spd(state.settings.movingThreshold)} ${spdUnit()}, excluding known pauses and recording gaps. It may differ from Garmin. HR/cadence/power averages are time-weighted; absent sensors stay blank.`;
  const unmatched = included().filter(
    (r) => !state.matches.some((m) => m.rideId === r.id),
  );
  $("unmatched").innerHTML = unmatched.length
    ? `<div class="unmatched"><strong>Not matched:</strong>${unmatched.map((r) => `<span>${esc(r.name)} <button class="text-button" data-manual-ride="${esc(r.id)}">Select manually</button></span>`).join("")}<p>Both gates, direction and ordered route shape must agree. Manual passes are your judgment and are labeled.</p></div>`
    : "";
}
function renderComparison() {
  const metric = state.metric,
    b = baseline();
  $("metric").value = metric;
  state.chartData = [];
  if (!b) {
    $("comparison-chart").innerHTML = "";
    $("legend").innerHTML = "";
    return;
  }
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
            : metric === "power"
              ? "W"
              : metric === "grade"
                ? "%"
                : "seconds";
  const lines = state.matches.map((m) => {
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
        metric === "delta"
          ? deltaCurve(m.points, b.points)
          : Array.from({ length: 151 }, (_, i) => {
              const f = i / 150,
                p = atProgress(m.points, f);
              let v =
                metric === "grade" ? gs[lowerBound(m.points, p.d)] : p[metric];
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
    lo = min - pad,
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
    `<svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="${esc(metric)} comparison by distance progress">${[0, 0.5, 1].map((f) => `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(lo + (hi - lo) * f)}" y2="${y(lo + (hi - lo) * f)}" stroke="#e4e9ee"/><text x="${CH.l - 8}" y="${y(lo + (hi - lo) * f) + 4}" text-anchor="end">${Math.round(lo + (hi - lo) * f)}</text>`).join("")}${metric === "delta" ? `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(0)}" y2="${y(0)}" stroke="#8a9aac" stroke-dasharray="4 4"/>` : ""}${lines.map(({ m, values }) => `<path d="${path(values)}" fill="none" stroke="${color(m.rideId)}" stroke-width="${m.id === b.id ? 3 : 2.2}" ${m.pass > 1 ? 'stroke-dasharray="6 3"' : ""}/>`).join("")}${[0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${CH.l + f * (CH.w - CH.l - CH.r)}" y="${CH.h - 8}" text-anchor="middle">${Math.round(f * 100)}%</text>`).join("")}<line id="compare-cursor" y1="${CH.t}" y2="${CH.h - CH.b}" stroke="#172b42" opacity="0"/></svg><div class="chart-caption"><span>${esc(units)} ${metric === "delta" ? "· negative = ahead of baseline" : ""}</span><span>Distance progress between GPS endpoints</span></div>${all.length ? "" : '<p class="no-channel">This sensor channel wasn’t recorded.</p>'}`;
  state.chartData = lines;
  const legend = (f) => {
    $("legend").innerHTML = lines
      .map(
        ({ m, values }) =>
          `<span><i style="background:${color(m.rideId)}"></i>${esc(rideName(m.rideId))}${m.pass > 1 ? " · pass " + m.pass : ""}${f != null ? ` · ${num(values[Math.round(f * (values.length - 1))]?.y, 1)} ${esc(units)}` : ""}</span>`,
      )
      .join("");
  };
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
    mainMap.highlight(atProgress(state.canonical, f));
  };
  svg.onpointerleave = () => {
    $("compare-cursor").setAttribute("opacity", "0");
    legend(null);
    mainMap.highlight(null);
  };
}
function renderBudget() {
  const b = baseline(),
    c = comparison();
  $("budget-panel").hidden = !b || !c;
  if (!b || !c) return;
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
      )}</div></div><p class="budget-method">Grade window: ${state.settings.gradeWindow} m · level road: ±${state.settings.gradeThreshold}% · reference: ${esc(rideName(state.referenceId))}</p>`;
}
function renderContext() {
  $("context").innerHTML = included()
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
function openManual(id, start, end) {
  const r = loaded.get(id);
  state.manual = {
    ride: r,
    start: Math.max(0, start),
    end: Math.min(r.points.length - 1, end),
  };
  $("manual-title").textContent = `Adjust pass · ${r.name}`;
  $("manual-dialog").showModal();
  if (!manualMap)
    manualMap = new RouteMap("manual-map", (ll, type) => {
      if (!type) return;
      const m = state.manual,
        i = nearestIndex(m.ride.points, ll);
      if (type === "start" && i >= 0 && i < m.end) m.start = i;
      if (type === "end" && i > m.start) m.end = i;
      renderManual();
    });
  renderManual();
  setTimeout(() => manualMap.fit(), 0);
}
function renderManual() {
  const m = state.manual;
  if (!m) return;
  $("manual-start").max = m.ride.points.length - 2;
  $("manual-start").value = m.start;
  $("manual-end").max = m.ride.points.length - 1;
  $("manual-end").value = m.end;
  $("manual-profile").innerHTML = profileHTML(m.ride.points, m.start, m.end);
  bindProfile(
    $("manual-profile"),
    m.ride.points,
    (a, b) => {
      m.start = a;
      m.end = b;
      renderManual();
    },
    (p) => manualMap.highlight(p),
  );
  manualMap.update([m.ride], [], m.ride, m.start, m.end);
  $("manual-description").textContent =
    `${dist(m.ride.points[m.start].d)} → ${dist(m.ride.points[m.end].d)} · ${fmtTime((m.ride.points[m.end].t - m.ride.points[m.start].t) / 1000)} · endpoints ${hasGPS(m.ride.points[m.start]) ? m.ride.points[m.start].lat.toFixed(6) + ", " + m.ride.points[m.start].lon.toFixed(6) : "no GPS"} / ${hasGPS(m.ride.points[m.end]) ? m.ride.points[m.end].lat.toFixed(6) + ", " + m.ride.points[m.end].lon.toFixed(6) : "no GPS"}`;
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
  ];
  const rows = state.matches.map((m) => {
    const r = loaded.get(m.rideId),
      s = state.stats.get(m.id);
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
  clearTimeout(settingsTimeout);
  settingsTimeout = setTimeout(
    () =>
      api("/api/settings", json("PUT", state.settings)).catch((e) =>
        message(e.message, true),
      ),
    300,
  );
}
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
$("clear-rides").onclick = () => {
  state.selected = [];
  persistSelection();
  render();
};
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
      await refresh();
    });
  e.target.value = "";
};
$("reference").onchange = (e) =>
  task("Loading reference ride…", async () => {
    const r = await getRide(e.target.value);
    state.referenceId = r.id;
    state.start = 0;
    state.end = r.points.length - 1;
    state.scope = "full";
    state.overrides = {};
    render();
  });
$("scope").onchange = (e) =>
  task("Opening road section…", async () => {
    if (e.target.value === "full") {
      state.start = 0;
      state.end = ref().points.length - 1;
      state.scope = "full";
      state.overrides = {};
    } else {
      const s = state.segments.find((s) => s.id === e.target.value);
      if (!s) return;
      await getRide(s.referenceId);
      state.referenceId = s.referenceId;
      state.start = s.start;
      state.end = s.end;
      state.scope = s.id;
      state.overrides = structuredClone(s.overrides || {});
      $("section-name").value = s.name;
    }
    render();
  });
$("start-range").oninput = (e) =>
  changeRange(Math.min(+e.target.value, state.end - 1), state.end);
$("end-range").oninput = (e) =>
  changeRange(state.start, Math.max(+e.target.value, state.start + 1));
for (const endpoint of ["start", "end"]) {
  $(`set-${endpoint}`).onclick = () => {
    state.tool = state.tool === endpoint ? null : endpoint;
    renderControls();
    $("map").classList.toggle("selecting", !!state.tool);
    $("map-hint").textContent = state.tool
      ? `Click near the ${state.tool} on the reference ride.`
      : "Drag a marker or select a range on the profile.";
  };
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
$("tiles").onchange = (e) => {
  mainMap.tiles(e.target.checked);
  $("map-hint").textContent = e.target.checked
    ? "Street tiles use OpenStreetMap. Activity files stay local."
    : "Routes only · enable Street map to load online map tiles.";
};
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
  $("settings").hidden = !$("settings").hidden;
};
$("help-button").onclick = () => $("help-dialog").showModal();
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
$("save-section").onclick = () =>
  task("Saving road section…", async () => {
    const previous = state.segments.find((s) => s.id === state.scope),
      s = await api(
        "/api/segments",
        json("POST", {
          id: previous?.id,
          name: $("section-name").value,
          referenceId: state.referenceId,
          start: state.start,
          end: state.end,
          overrides: state.overrides,
        }),
      );
    state.segments = state.segments.filter((x) => x.id !== s.id).concat(s);
    state.scope = s.id;
    renderControls();
  });
$("delete-section").onclick = () => {
  if (confirm("Delete this saved section? Ride data will be kept."))
    task("Deleting section…", async () => {
      await api(`/api/segments/${state.scope}`, json("DELETE"));
      state.segments = state.segments.filter((s) => s.id !== state.scope);
      state.scope = "draft";
      renderControls();
    });
};
$("baseline").onchange = (e) => {
  state.baseline = e.target.value;
  render();
};
$("budget-comparison").onchange = (e) => {
  state.comparison = e.target.value;
  renderSummary();
  renderBudget();
};
$("metric").onchange = (e) => {
  state.metric = e.target.value;
  renderComparison();
};
$("export").onclick = exportCSV;
window.addEventListener("click", (e) => {
  const notes = e.target.closest("[data-notes]");
  if (notes) openNotes(notes.dataset.notes);
  const adjust = e.target.closest("[data-adjust]");
  if (adjust) {
    const m = state.matches.find((m) => m.id === adjust.dataset.adjust);
    openManual(m.rideId, Math.floor(m.startIndex), Math.ceil(m.endIndex));
  }
  const manual = e.target.closest("[data-manual-ride]");
  if (manual) {
    const r = loaded.get(manual.dataset.manualRide);
    openManual(r.id, 0, r.points.length - 1);
  }
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
      await refresh();
    });
};
$("manual-start").oninput = (e) => {
  state.manual.start = Math.min(+e.target.value, state.manual.end - 1);
  renderManual();
};
$("manual-end").oninput = (e) => {
  state.manual.end = Math.max(+e.target.value, state.manual.start + 1);
  renderManual();
};
$("save-manual").onclick = () => {
  const m = state.manual;
  state.overrides[m.ride.id] = { start: m.start, end: m.end };
  $("manual-dialog").close();
  render();
  message("Manual pass applied. Save the section to retain the adjustment.");
};
$("reset-manual").onclick = () => {
  delete state.overrides[state.manual.ride.id];
  $("manual-dialog").close();
  render();
};
window.addEventListener("error", (e) =>
  message(`Dashboard error: ${e.message}`, true),
);
window.addEventListener("unhandledrejection", (e) =>
  message(e.reason?.message || String(e.reason), true),
);
task("Loading your local workspace…", () => refresh(true));
