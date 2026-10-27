import { hillProfile } from "/hill-profile.mjs";
import {
  spreadOptions,
  densityOptions,
  spreadDescription,
  hillChartDomain,
  spreadMarkup,
  describeSpread,
  hillLaneDefinitions,
  hillRowControls,
} from "/hill-chart.js";

// Compare aggregate terrain identities here; original pass editing stays in Comparisons.
export function createHillComparison({ host, state, getRide, esc }) {
  host.hidden = true;
  host.innerHTML = `<div class="hill-list-heading"><div><p class="eyebrow">DIFFERENT HILLS</p><h3>Hill shapes and recorded response</h3></div><button id="hill-cross-close" class="text-button">Close</button></div><div class="hill-summary-controls"><label>Horizontal axis<select id="hill-cross-axis"><option value="distance">Distance from hill start</option><option value="progress">Hill progress (%)</option></select></label><label>Spread<select id="hill-cross-spread">${spreadOptions}</select></label><label id="hill-cross-density-control" hidden>Box density<select id="hill-cross-density">${densityOptions}</select></label></div><p id="hill-cross-status" class="hill-muted" role="status"></p><div id="hill-cross-rows" class="plot-controls" aria-label="Expand or collapse plot rows"></div><svg id="hill-cross-profile" role="img" aria-label="Aggregate elevation and recorded features across different named hills"></svg><div id="hill-cross-legend" class="hill-cross-legend"></div><p id="hill-cross-value" class="hill-muted">Hover to inspect the hills at the same displayed position.</p><p class="hill-muted">Each line is one named hill, with equal weight per ride. Elevation is relative to each hill’s own start. <span id="hill-cross-spread-description"></span> Different terrain and recording coverage can affect the recorded response.</p><p id="hill-cross-power-note" class="data-note"></p>`;
  const $ = (id) => host.querySelector(`#${id}`),
    palette = [
      "#287bd5",
      "#cb742f",
      "#8163c1",
      "#15977e",
      "#c54e78",
      "#8c7c28",
    ],
    imperial = () => state.settings.units === "imperial";
  const collapsed = new Set();
  let series = [],
    openedIds = [],
    signature = "",
    generation = 0,
    lastWidth = 0,
    frame = 0;
  const key = (hills) =>
    JSON.stringify({
      settings: state.settings,
      hills: hills.map((h) => [
        h.id,
        h.members.map((o) => [o.id, o.rideId, o.start, o.end]),
      ]),
    });
  function draw() {
    const svg = $("hill-cross-profile"),
      W = Math.max(300, Math.round(svg.clientWidth || 900)),
      left = 58,
      right = W - 18,
      spread = $("hill-cross-spread").value,
      density = +$("hill-cross-density").value,
      progress = $("hill-cross-axis").value === "progress",
      xMax = progress
        ? 1
        : Math.max(1, ...series.map((s) => s.result.length || 0)),
      xf = (p) => (progress ? p.progress : p.s),
      x = (v) => left + (v / xMax) * (right - left),
      heightFactor = imperial() ? 3.28084 : 1,
      definitions = hillLaneDefinitions(imperial()),
      available = definitions.filter(
        (lane) =>
          lane.key === "ele" ||
          series.some((s) =>
            s.result.profile.some((p) => p[lane.key]?.mean != null),
          ),
      ),
      lanes = available.filter((row) => !collapsed.has(row.key));
    $("hill-cross-rows").innerHTML = hillRowControls(
      available,
      collapsed,
      "cross",
    );
    if (!lanes.length) {
      lastWidth = W;
      svg.setAttribute("viewBox", `0 0 ${W} 80`);
      svg.innerHTML = `<text x="${W / 2}" y="40" text-anchor="middle">Expand a plot row above</text>`;
      return;
    }
    let nextTop = 30;
    for (const lane of lanes) {
      lane.top = nextTop;
      lane.bottom = nextTop + (lane.key === "ele" ? 166 : 90);
      nextTop = lane.bottom + 42;
    }
    const bottom = lanes.at(-1).bottom,
      H = bottom + 58;
    lastWidth = W;
    $("hill-cross-density-control").hidden = spread !== "box";
    $("hill-cross-spread-description").textContent = spreadDescription(
      spread,
      density,
    );
    $("hill-cross-power-note").textContent = lanes.some(
      (row) => row.key === "minimumPower",
    )
      ? `Estimated minimum power uses the current ${(state.settings.riderMassKg / (imperial() ? 0.45359237 : 1)).toFixed(1)} ${imperial() ? "lb" : "kg"} rider + ${(state.settings.bikeMassKg / (imperial() ? 0.45359237 : 1)).toFixed(1)} ${imperial() ? "lb" : "kg"} bike/equipment assumptions and each pass’s own elevation over ${state.settings.gradeWindow} m. This is not measured crank power; resistance losses are omitted and actual pedalling power may be higher. Unsupported windows remain gaps; ride means receive equal weight.`
      : "Estimated minimum power needs rider and bike/equipment weights in Comparisons and supported elevation/speed data. Missing sensor channels have no plot row.";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    function lane(key, top, bottom, convert) {
      const values = series.flatMap((s) =>
          s.result.profile.map((p) => p[key]).filter((v) => v?.mean != null),
        ),
        { low, high } = hillChartDomain(values, key, spread, convert),
        y = (v) =>
          bottom - ((v * convert - low) / (high - low)) * (bottom - top);
      let markup = [0, 0.5, 1]
        .map((f) => {
          const value = low + (high - low) * f,
            position = bottom - f * (bottom - top);
          return `<line x1="${left}" x2="${right}" y1="${position}" y2="${position}" stroke="#e2e8ee"/><text data-cross-y-tick="${key}" x="${left - 7}" y="${position + 4}" text-anchor="end">${value.toFixed(key === "speed" ? 1 : 0)}</text>`;
        })
        .join("");
      for (const [index, s] of series.entries()) {
        let trace = "",
          down = false;
        const colour = palette[index % palette.length],
          boxWidth = Math.max(
            1,
            Math.min(12, (right - left) / (density * 1.5 * series.length) - 2),
          ),
          bands = spreadMarkup(s.result.profile, key, {
            mode: spread,
            density,
            x: (p) => x(xf(p)),
            y,
            color: colour,
            boxWidth,
            offset: (index - (series.length - 1) / 2) * (boxWidth + 2),
          });
        s.result.profile.forEach((p) => {
          const v = p[key];
          if (v.mean == null) {
            down = false;
            return;
          }
          trace += `${down ? "L" : "M"}${x(xf(p))},${y(spread === "box" ? v.median : v.mean)} `;
          down = true;
        });
        markup += `${bands}<path data-cross-hill="${esc(s.hill.id)}" data-cross-lane="${key}" d="${trace}" fill="none" stroke="${colour}" stroke-width="2"/>`;
      }
      if (key === "grade")
        markup += `<line x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}" stroke="#8b99a8" stroke-dasharray="3 4"/>`;
      if (!values.length)
        markup += `<text x="${(left + right) / 2}" y="${(top + bottom) / 2}" text-anchor="middle">Data unavailable</text>`;
      return markup;
    }
    svg.innerHTML =
      lanes
        .map(
          (row) =>
            `<g id="cross-row-${row.key}" data-cross-row="${row.key}"><text x="${left}" y="${row.top - 14}">${row.label} (${row.unit})</text>${lane(row.key, row.top, row.bottom, row.factor)}</g>`,
        )
        .join("") +
      `${[0, 0.5, 1].map((f) => `<text x="${x(xMax * f)}" y="${bottom + 24}" text-anchor="middle">${progress ? `${Math.round(f * 100)}%` : `${((xMax * f) / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}`}</text>`).join("")}<text x="${(left + right) / 2}" y="${bottom + 49}" text-anchor="middle">${progress ? "Relative progress through each mapped hill (%)" : "Distance from each mapped hill start"}</text><line data-cross-cursor y1="30" y2="${bottom}" opacity="0" stroke="#53687e"/>`;
    svg.onpointerleave = () =>
      svg.querySelector("[data-cross-cursor]").setAttribute("opacity", "0");
    svg.onpointermove = (event) => {
      const box = svg.getBoundingClientRect(),
        position = Math.max(
          0,
          Math.min(
            xMax,
            ((((event.clientX - box.left) / box.width) * W - left) /
              (right - left)) *
              xMax,
          ),
        ),
        cursor = svg.querySelector("[data-cross-cursor]");
      cursor.setAttribute("x1", x(position));
      cursor.setAttribute("x2", x(position));
      cursor.setAttribute("opacity", ".5");
      const localY = ((event.clientY - box.top) / box.height) * H;
      const hovered = lanes.reduce(
        (best, row) =>
          Math.abs(localY - (row.top + row.bottom) / 2) <
          Math.abs(localY - (best.top + best.bottom) / 2)
            ? row
            : best,
        lanes[0],
      );
      $("hill-cross-value").textContent =
        hovered.label +
        " · " +
        series
          .map((s) => {
            if (
              !s.result.profile.length ||
              (!progress && position > s.result.length)
            )
              return `${s.hill.name}: outside recorded hill`;
            const f = progress ? position : position / s.result.length,
              value =
                s.result.profile[
                  Math.round(f * (s.result.profile.length - 1))
                ]?.[hovered.key];
            return `${s.hill.name}: ${describeSpread(value, spread, hovered.factor, hovered.unit)} · ${value?.rides || 0} rides`;
          })
          .join(" · ");
    };
  }
  $("hill-cross-rows").onclick = (event) => {
    const button = event.target.closest("[data-cross-toggle]");
    if (!button) return;
    const id = button.dataset.crossToggle;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    draw();
    $("hill-cross-rows")
      .querySelector(`[data-cross-toggle="${id}"]`)
      ?.focus({ preventScroll: true });
  };
  $("hill-cross-axis").onchange = draw;
  $("hill-cross-spread").onchange = draw;
  $("hill-cross-density").onchange = draw;
  $("hill-cross-close").onclick = () => {
    generation++;
    host.hidden = true;
  };
  new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const width = $("hill-cross-profile").clientWidth;
      if (
        !host.hidden &&
        width > 0 &&
        Math.max(300, Math.round(width)) !== lastWidth
      )
        draw();
    });
  }).observe($("hill-cross-profile"));
  const controller = {
    async refresh(hills) {
      if (host.hidden || !openedIds.length) return;
      const current = hills.filter((h) => openedIds.includes(h.id));
      if (key(current) !== signature)
        await controller.show(current, { scroll: false });
    },
    async show(hills, { scroll = true } = {}) {
      if (!hills.length) {
        generation++;
        openedIds = [];
        host.hidden = true;
        return;
      }
      openedIds = hills.map((h) => h.id);
      signature = key(hills);
      const turn = ++generation;
      host.hidden = false;
      $("hill-cross-status").textContent = "Mapping the selected hills…";
      $("hill-cross-profile").innerHTML = "";
      const rides = new Map(
        await Promise.all(
          [...new Set(hills.flatMap((h) => h.rideIds))].map(async (id) => [
            id,
            await getRide(id),
          ]),
        ),
      );
      if (turn !== generation) return;
      series = hills.map((hill) => ({
        hill,
        result: hillProfile(hill.members, (id) => rides.get(id), null, {
          ...state.settings,
          includeMinimumPower: true,
        }),
      }));
      $("hill-cross-status").textContent =
        `${series.length} named hills · ${series.reduce((n, s) => n + s.result.passes.length, 0)} mapped passes${series.some((s) => s.result.excluded.length) ? " · some recordings need review in Comparisons" : ""}`;
      $("hill-cross-legend").innerHTML = series
        .map(
          (s, i) =>
            `<span><i style="background:${palette[i % palette.length]}"></i><strong>${esc(s.hill.name)}</strong> · ${s.result.passes.length}/${s.hill.members.length} passes · ${((s.result.length || 0) / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}</span>`,
        )
        .join("");
      draw();
      if (scroll) host.scrollIntoView({ block: "start", behavior: "smooth" });
    },
  };
  return controller;
}
