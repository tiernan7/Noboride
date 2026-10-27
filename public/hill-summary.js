import { hillProfile } from "/hill-profile.mjs";
import {
  spreadOptions,
  densityOptions,
  spreadDescription,
  hillChartDomain,
  spreadMarkup,
  describeSpread,
  gradeColor,
  hillGradeLegend,
  hillLaneDefinitions,
  hillRowControls,
} from "/hill-chart.js";
export function createHillSummary({
  host,
  state,
  getRide,
  esc,
  rideName,
  onCompare,
}) {
  host.innerHTML = `<div class="hill-list-heading"><div><p class="eyebrow">SAVED HILL</p><h3>Your hill, across rides</h3></div><label>Hill<select id="hill-summary-select"></select></label></div><p id="hill-summary-empty" class="subtle">Save a named hill from a comparison to explore it here.</p><div id="hill-summary-body" hidden><div class="hill-summary-controls"><label>Horizontal axis<select id="hill-summary-axis"><option value="progress">Hill progress (%)</option><option value="distance">Mapped distance</option></select></label><label>Spread<select id="hill-summary-spread">${spreadOptions}</select></label><label id="hill-summary-density-control" hidden>Box density<select id="hill-summary-density">${densityOptions}</select></label><button id="hill-summary-compare" class="button">Open passes in Comparisons →</button></div><p id="hill-summary-status" class="hill-muted" role="status"></p><div id="hill-summary-rows" class="plot-controls" aria-label="Expand or collapse plot rows"></div><p id="hill-summary-power-note" class="data-note"></p><div class="overview-legend" id="hill-summary-grade-key">${hillGradeLegend}</div><svg id="hill-summary-profile" role="img" aria-label="Hill elevation filled by grade with stacked channel rows and recording variation"></svg><p id="hill-summary-spread-description" class="hill-muted"></p><p id="hill-summary-value" class="hill-muted"></p><details id="hill-summary-recordings"><summary>Included recordings <span id="hill-summary-recording-count"></span></summary><div class="hill-actions"><button id="hill-summary-all" class="text-button">Include all</button><button id="hill-summary-none" class="text-button">Exclude all</button></div><div id="hill-summary-sources"></div></details></div>`;
  const $ = (id) => host.querySelector(`#${id}`);
  let catalog,
    result,
    profileStatus = "",
    key = "",
    generation = 0,
    lastWidth = 0,
    exclusions = {};
  const collapsed = new Set();
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
        includeMinimumPower: true,
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
      right = W - 20;
    const spread = $("hill-summary-spread").value,
      density = +$("hill-summary-density").value;
    lastWidth = W;
    $("hill-summary-density-control").hidden = spread !== "box";
    $("hill-summary-spread-description").textContent = spreadDescription(
      spread,
      density,
    );
    if (!result?.profile.length || !result.passes.length) {
      $("hill-summary-rows").innerHTML = "";
      svg.setAttribute("viewBox", `0 0 ${W} 180`);
      svg.innerHTML = `<text x="${W / 2}" y="100" text-anchor="middle">${members().length ? "Include a recording to view its mapped hill profile" : "No mapped terrain"}</text>`;
      return;
    }
    const available = hillLaneDefinitions(imperial()).filter(
      (row) =>
        row.key === "ele" ||
        result.profile.some((p) => p[row.key]?.mean != null),
    );
    $("hill-summary-power-note").textContent = available.some(
      (row) => row.key === "minimumPower",
    )
      ? `Estimated minimum power uses the current comparison weights and each pass’s own elevation over ${state.settings.gradeWindow} m. Resistance losses are omitted; actual pedalling power may be higher. It is separate from measured power.`
      : "Estimated minimum power needs rider/equipment weights in Comparisons and supported elevation/speed data.";
    $("hill-summary-rows").innerHTML = hillRowControls(
      available,
      collapsed,
      "summary",
    );
    const rows = available.filter((row) => !collapsed.has(row.key));
    if (!rows.length) {
      svg.setAttribute("viewBox", `0 0 ${W} 80`);
      svg.innerHTML = `<text x="${W / 2}" y="40" text-anchor="middle">Expand a plot row above</text>`;
      return;
    }
    let next = 28;
    for (const row of rows) {
      row.top = next;
      row.bottom = next + (row.key === "ele" ? 180 : 90);
      next = row.bottom + 42;
    }
    const bottom = rows.at(-1).bottom,
      H = bottom + 54,
      x = (f) => left + f * (right - left);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let markup = "";
    for (const row of rows) {
      const fields = result.profile.map((p) => p[row.key]),
        domain = hillChartDomain(fields, row.key, spread),
        y = (v) =>
          row.bottom -
          ((v - domain.low) / (domain.high - domain.low)) *
            (row.bottom - row.top),
        central = (p) =>
          spread === "box" ? p[row.key].median : p[row.key].mean;
      let trace = "",
        down = false;
      for (const p of result.profile) {
        const v = central(p);
        if (v == null) {
          down = false;
          continue;
        }
        trace += `${down ? "L" : "M"}${x(p.progress)},${y(v)} `;
        down = true;
      }
      let fill = "";
      if (row.key === "ele") {
        let area = "",
          stops = "",
          first = null,
          last = null;
        result.profile.forEach((p, i) => {
          const v = central(p);
          if (v == null) {
            if (first) {
              area += `L${x(last.progress)},${row.bottom} Z `;
              first = null;
            }
            return;
          }
          if (!first) {
            area += `M${x(p.progress)},${row.bottom} L${x(p.progress)},${y(v)} `;
            first = p;
          } else area += `L${x(p.progress)},${y(v)} `;
          last = p;
          if (i) {
            const a = result.profile[i - 1],
              unknown = a.grade.mean == null || p.grade.mean == null;
            stops += `<stop data-summary-position="${i}" offset="${a.progress}" stop-color="${gradeColor(unknown ? null : p.grade.mean)}"/><stop offset="${p.progress}" stop-color="${gradeColor(unknown ? null : p.grade.mean)}"/>`;
          }
        });
        if (first) area += `L${x(last.progress)},${row.bottom} Z`;
        fill = `<defs><linearGradient id="hill-summary-fill-colors" gradientUnits="userSpaceOnUse" x1="${left}" x2="${right}">${stops}</linearGradient></defs><path data-summary-fill d="${area}" fill="url(#hill-summary-fill-colors)" opacity=".85"/>`;
      }
      const band = spreadMarkup(result.profile, row.key, {
        mode: spread,
        density,
        boxWidth: Math.max(1, Math.min(10, (right - left) / (density * 1.7))),
        x: (p) => x(p.progress),
        y,
        color: row.key === "ele" ? "#546d75" : "#647c9a",
      });
      markup += `<g id="summary-row-${row.key}" data-summary-row="${row.key}"><text x="${left}" y="${row.top - 12}">${row.label} (${row.unit})</text>${[
        0, 0.5, 1,
      ]
        .map((f) => {
          const v = domain.low + f * (domain.high - domain.low);
          return `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8ee"/><text data-feature-y-tick="${row.key}" x="${left - 7}" y="${y(v) + 4}" text-anchor="end">${(v * row.factor).toFixed(row.key === "speed" ? 1 : 0)}</text>`;
        })
        .join(
          "",
        )}${fill}${band}<path data-summary-line="${row.key}" d="${trace}" fill="none" stroke="${row.key === "ele" ? "#617a51" : "#647c9a"}" stroke-width="1.8"/>${row.key === "grade" ? `<line x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}" stroke="#8b99a8" stroke-opacity=".4" stroke-dasharray="3 4"/>` : ""}</g>`;
    }
    svg.innerHTML =
      markup +
      `${[0, 0.5, 1].map((f) => `<text x="${x(f)}" y="${bottom + 24}" text-anchor="middle">${$("hill-summary-axis").value === "progress" ? `${Math.round(f * 100)}%` : `${(((result.length || 0) * f) / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}`}</text>`).join("")}<text x="${(left + right) / 2}" y="${bottom + 49}" text-anchor="middle">${$("hill-summary-axis").value === "progress" ? "Mapped hill progress (%)" : `Mapped distance (${imperial() ? "mi" : "km"})`}</text><line id="hill-summary-hover" y1="${rows[0].top}" y2="${bottom}" stroke="#53687e" opacity="0"/>`;
    $("hill-summary-value").textContent =
      "Elevation fill always shows grade. Hover a plot row to inspect its values; use the row buttons to collapse or expand it.";
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
        localY = ((event.clientY - box.top) / box.height) * H,
        row = rows.reduce(
          (best, r) =>
            Math.abs(localY - (r.top + r.bottom) / 2) <
            Math.abs(localY - (best.top + best.bottom) / 2)
              ? r
              : best,
          rows[0],
        ),
        p = result.profile[Math.round(f * (result.profile.length - 1))],
        value = p[row.key],
        cursor = $("hill-summary-hover");
      cursor.setAttribute("x1", x(f));
      cursor.setAttribute("x2", x(f));
      cursor.setAttribute("opacity", ".5");
      $("hill-summary-value").textContent =
        `${row.label} · ${$("hill-summary-axis").value === "distance" ? `${((f * result.length) / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"} into mapped hill` : `${Math.round(f * 100)}% of mapped hill`} · ${describeSpread(value, spread, row.factor, row.unit)} · ${value.rides} rides contributing`;
    };
    svg.onpointerleave = () =>
      $("hill-summary-hover").setAttribute("opacity", "0");
  }
  $("hill-summary-rows").onclick = (event) => {
    const button = event.target.closest("[data-summary-toggle]");
    if (!button) return;
    const id = button.dataset.summaryToggle;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    draw();
    $("hill-summary-rows")
      .querySelector(`[data-summary-toggle="${id}"]`)
      ?.focus({ preventScroll: true });
  };
  $("hill-summary-select").onchange = () => {
    key = "";
    load();
  };
  $("hill-summary-axis").onchange = draw;
  $("hill-summary-spread").onchange = draw;
  $("hill-summary-density").onchange = draw;
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
