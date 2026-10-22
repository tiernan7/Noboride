import { createHillComparison } from "/hill-compare.js";
import { summarizeHillGroups } from "/hills.mjs";
import { createHillSummary } from "/hill-summary.js";
import { createHillPublisher } from "/hill-publish.js";
export function createHillLibrary({
  state,
  getRide,
  api,
  json,
  esc,
  rideName,
  onCompare,
  onChange = () => {},
  getComparison,
}) {
  const $ = (id) => document.getElementById(id),
    selected = new Set();
  let catalog = null,
    stale = true,
    pending = null,
    mounted = false,
    summary,
    hillComparison,
    suppressPointClick = false,
    handingOff = false;
  const observations = () => catalog?.observations || [],
    groups = () => catalog?.library.groups || [],
    hills = () =>
      catalog ? summarizeHillGroups(catalog.library, observations()) : [],
    chosen = () => hills().filter((h) => selected.has(h.id));
  const nameOf = (item) => item.name,
    imperial = () => state.settings.units === "imperial",
    normalized = (v) => v.normalize("NFKC").toLowerCase().trim();
  const publisher = createHillPublisher({
    host: $("hill-publish"),
    state,
    getComparison,
    getCatalog: () => catalog,
    esc,
    rideName,
    getRide,
    saveLibrary: async (library) => {
      await api("/api/hills", json("PUT", library));
      stale = true;
      await load();
      render();
    },
  });
  function mount() {
    if (mounted) return;
    mounted = true;
    $("hills-content").innerHTML =
      `<div class="hill-heading"><div><p class="eyebrow">YOUR HILL LIBRARY</p><h2>Hills</h2><p>Explore the shape of each named hill and how your rides vary. Define hills from saved stretches in Comparisons.</p></div><button id="hill-refresh" class="button small">Refresh hills</button></div><section id="hill-library-summary" class="hill-library-summary"></section>
      <details class="hill-cross-terrain" id="hill-terrain-explorer"><summary>Explore terrain across different hills</summary><div class="hill-cross-heading"><h3>How do your hills differ?</h3><p>One point is one named hill, combining its vetted recordings. Ranges show variation between rides. Select one hill to view its profile, or several to compare their hill summaries below.</p></div><div class="hill-toolbar"><label>Find a hill or ride<input id="hill-query" type="search" placeholder="Hill or ride"></label><label>Ride<select id="hill-ride-filter"></select></label><label>Bike<select id="hill-bike-filter"></select></label><label>Hill<select id="hill-identity-filter"></select></label></div><div class="hill-scatter-controls"><label>Terrain axis<select id="hill-scatter-x"><option value="length">Hill length</option><option value="netGain">Height gained</option><option value="avgGrade">Average gradient</option></select></label><label>Show against<select id="hill-scatter-y"><option value="netGain">Height gained</option><option value="avgGrade">Average gradient</option><option value="meanSpeed">Mean speed</option><option value="meanHr">Mean heart rate</option></select></label></div>
      <div class="hill-bulk-controls"><button id="hill-select-shown" class="button small">Select shown</button><button id="hill-clear-shown" class="button small">Deselect shown</button><button id="hill-clear-all" class="text-button">Clear all</button><label>Drag box<select id="hill-brush-mode"><option value="replace">Replace selection</option><option value="add">Add to selection</option><option value="remove">Remove from selection</option></select></label><span id="hill-plot-selection" class="hill-muted"></span></div><svg id="hill-scatter-svg" viewBox="0 0 820 260" role="group" aria-label="Terrain characteristics of vetted hill sections"></svg><p id="hill-scatter-caption" class="hill-muted"></p><div class="hill-cross-handoff"><button id="hill-create-comparison" class="button">Compare selected hills below</button><p id="hill-handoff-status" role="status"></p></div><section id="hill-cross-comparison" class="hill-inline-comparison" hidden></section></details><p id="hill-status" role="status"></p>`;
    summary = createHillSummary({
      host: $("hill-library-summary"),
      state,
      getRide,
      esc,
      rideName,
      onCompare,
    });
    hillComparison = createHillComparison({
      host: $("hill-cross-comparison"),
      state,
      getRide,
      esc,
    });
    $("hill-select-shown").onclick = () => {
      filtered().forEach((o) => selected.add(o.id));
      render();
    };
    $("hill-clear-shown").onclick = () => {
      filtered().forEach((o) => selected.delete(o.id));
      render();
    };
    $("hill-clear-all").onclick = () => {
      selected.clear();
      render();
    };
    let brush = null;
    const location = (event) => {
      const box = $("hill-scatter-svg").getBoundingClientRect(),
        vb = $("hill-scatter-svg").viewBox.baseVal;
      return {
        x: ((event.clientX - box.left) / box.width) * vb.width,
        y: ((event.clientY - box.top) / box.height) * vb.height,
      };
    };
    $("hill-scatter-svg").onpointerdown = (event) => {
      if (event.button !== 0) return;
      brush = { ...location(event), id: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    };
    $("hill-scatter-svg").onpointermove = (event) => {
      if (!brush) return;
      const point = location(event);
      let rect = $("hill-scatter-svg").querySelector("[data-hill-brush]");
      if (!rect) {
        rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("data-hill-brush", "");
        rect.setAttribute("fill", "#287bd522");
        rect.setAttribute("stroke", "#287bd5");
        rect.style.pointerEvents = "none";
        $("hill-scatter-svg").append(rect);
      }
      for (const [key, value] of Object.entries({
        x: Math.min(brush.x, point.x),
        y: Math.min(brush.y, point.y),
        width: Math.abs(point.x - brush.x),
        height: Math.abs(point.y - brush.y),
      }))
        rect.setAttribute(key, value);
    };
    $("hill-scatter-svg").onpointerup = (event) => {
      if (!brush) return;
      const point = location(event),
        start = brush;
      brush = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      $("hill-scatter-svg").querySelector("[data-hill-brush]")?.remove();
      if (Math.hypot(point.x - start.x, point.y - start.y) < 5) return;
      const mode = $("hill-brush-mode").value;
      if (mode === "replace") selected.clear();
      for (const circle of $("hill-scatter-svg").querySelectorAll(
        "[data-hill-point]",
      )) {
        const x = +circle.getAttribute("cx"),
          y = +circle.getAttribute("cy");
        if (
          x >= Math.min(start.x, point.x) &&
          x <= Math.max(start.x, point.x) &&
          y >= Math.min(start.y, point.y) &&
          y <= Math.max(start.y, point.y)
        ) {
          if (mode === "remove") selected.delete(circle.dataset.hillPoint);
          else selected.add(circle.dataset.hillPoint);
        }
      }
      suppressPointClick = true;
      setTimeout(() => {
        suppressPointClick = false;
      }, 0);
      render();
    };
    $("hill-scatter-svg").onpointercancel = () => {
      brush = null;
      $("hill-scatter-svg").querySelector("[data-hill-brush]")?.remove();
    };
    const selectPoint = (event) => {
      if (suppressPointClick) {
        suppressPointClick = false;
        return;
      }
      const point = event.target.closest("[data-hill-point]");
      if (!point) return;
      const id = point.dataset.hillPoint;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render();
    };
    $("hill-scatter-svg").onclick = selectPoint;
    $("hill-scatter-svg").onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPoint(event);
      }
    };
    for (const id of [
      "hill-query",
      "hill-ride-filter",
      "hill-bike-filter",
      "hill-identity-filter",
    ])
      $(id).addEventListener(id === "hill-query" ? "input" : "change", () =>
        renderScatter(filtered()),
      );
    for (const id of ["hill-scatter-x", "hill-scatter-y"])
      $(id).onchange = () => renderScatter(filtered());
    $("hill-refresh").onclick = async () => {
      stale = true;
      await open();
    };
    $("hill-terrain-explorer").ontoggle = () => {
      if ($("hill-terrain-explorer").open) renderScatter(filtered());
    };
    let resizeFrame = 0,
      lastWidth = 0;
    new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const width = $("hill-scatter-svg").clientWidth;
        if (
          $("hill-terrain-explorer").open &&
          width > 0 &&
          Math.abs(width - lastWidth) > 1
        ) {
          lastWidth = width;
          renderScatter(filtered());
        }
      });
    }).observe($("hill-scatter-svg"));
    $("hill-create-comparison").onclick = async () => {
      if (handingOff) return;
      handingOff = true;
      $("hill-create-comparison").disabled = true;
      $("hill-handoff-status").textContent =
        `Loading ${selected.size} selected hill${selected.size === 1 ? "" : "s"}…`;
      try {
        if (selected.size === 1) await summary.select(chosen()[0].id);
        else await hillComparison.show(chosen());
        $("hill-handoff-status").textContent = "";
      } catch (error) {
        $("hill-handoff-status").textContent = error.message;
      } finally {
        handingOff = false;
        $("hill-create-comparison").disabled = handingOff || !selected.size;
      }
    };
  }
  function filtered() {
    const q = normalized($("hill-query").value),
      ride = $("hill-ride-filter").value,
      bike = $("hill-bike-filter").value,
      identity = $("hill-identity-filter").value;
    return hills().filter(
      (hill) =>
        (!identity || hill.id === identity) &&
        (!q ||
          normalized(
            `${hill.name} ${hill.members.map((o) => `${rideName(o.rideId)} ${o.name}`).join(" ")}`,
          ).includes(q)) &&
        (!ride || hill.rideIds.includes(ride)) &&
        (!bike ||
          hill.members.some(
            (o) =>
              state.rides.find((r) => r.id === o.rideId)?.notes?.bike === bike,
          )),
    );
  }

  function options(id, values) {
    const old = $(id).value;
    $(id).innerHTML = values
      .map(
        ([value, label]) =>
          `<option value="${esc(value)}">${esc(label)}</option>`,
      )
      .join("");
    if (values.some(([v]) => v === old)) $(id).value = old;
  }
  function render() {
    publisher.render();
    if (!mounted || !catalog) return;
    options("hill-ride-filter", [
      ["", "All rides"],
      ...state.rides.map((r) => [r.id, r.name]),
    ]);
    options("hill-identity-filter", [
      ["", "All named hills"],
      ...groups().map((g) => [g.id, g.name]),
    ]);
    const bikes = [
      ...new Set(state.rides.map((r) => r.notes?.bike).filter(Boolean)),
    ];
    options("hill-bike-filter", [
      ["", "All bikes"],
      ...bikes.map((b) => [b, b]),
    ]);
    $("hill-bike-filter").parentElement.hidden = !bikes.length;
    summary.render(catalog);
    if ($("hill-terrain-explorer").open) renderScatter(filtered());
  }
  async function load() {
    if (!stale && catalog) return catalog;
    if (pending) return pending;
    pending = api("/api/hills")
      .then((value) => {
        catalog = value;
        stale = false;
        for (const id of selected)
          if (!groups().some((g) => g.id === id)) selected.delete(id);
        onChange(catalog);
        publisher.render();
        return catalog;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  async function open() {
    mount();
    try {
      await load();
      render();
    } catch (error) {
      $("hill-status").textContent = error.message;
    }
  }
  function renderScatter(items) {
    $("hill-plot-selection").textContent =
      `${selected.size} selected hill${selected.size === 1 ? "" : "s"} · ${chosen().reduce((n, h) => n + h.members.length, 0)} passes · drag a box to select several`;
    $("hill-create-comparison").disabled = handingOff || !selected.size;
    $("hill-create-comparison").textContent =
      selected.size === 1
        ? "View this hill’s profile"
        : `Compare ${selected.size || "selected"} hills below`;
    const xMetric = $("hill-scatter-x").value,
      yMetric = $("hill-scatter-y").value,
      xValue = (item) =>
        item[xMetric] *
        (xMetric === "length"
          ? 1 / (imperial() ? 1609.344 : 1000)
          : xMetric === "netGain"
            ? imperial()
              ? 3.28084
              : 1
            : 1),
      yValue = (item) =>
        item[yMetric] *
        (yMetric === "meanSpeed"
          ? imperial()
            ? 2.236936
            : 3.6
          : yMetric === "netGain"
            ? imperial()
              ? 3.28084
              : 1
            : 1),
      available = items.filter(
        (item) =>
          Number.isFinite(item[xMetric]) && Number.isFinite(item[yMetric]),
      ),
      xLabel =
        xMetric === "length"
          ? `Mean section length (${imperial() ? "mi" : "km"})`
          : xMetric === "netGain"
            ? `Mean net height gained (${imperial() ? "ft" : "m"})`
            : "Average gradient (%)",
      yLabel =
        yMetric === "meanSpeed"
          ? `Mean speed (${imperial() ? "mph" : "km/h"})`
          : yMetric === "meanHr"
            ? "Mean heart rate (bpm)"
            : yMetric === "netGain"
              ? `Mean height gained (${imperial() ? "ft" : "m"})`
              : "Average gradient (%)",
      xMax =
        available.reduce((max, item) => Math.max(max, xValue(item)), 1) * 1.08,
      yMax =
        available.reduce((max, item) => Math.max(max, yValue(item)), 1) * 1.08,
      plotWidth = Math.max(280, $("hill-scatter-svg").clientWidth),
      plotSpan = plotWidth - 96,
      x = (item) => 68 + (plotSpan * xValue(item)) / xMax,
      y = (item) => 212 - (172 * yValue(item)) / yMax;
    $("hill-scatter-svg").setAttribute("viewBox", `0 0 ${plotWidth} 260`);
    $("hill-scatter-svg").innerHTML =
      `<path d="M68,36 V212 H${plotWidth - 28}" fill="none" stroke="#aebdce"/>${[0, 0.5, 1].map((f) => `<text x="${68 + plotSpan * f}" y="232" text-anchor="middle" fill="#667b93">${(xMax * f).toFixed(xMetric === "length" ? 2 : 1)}</text><text x="60" y="${216 - 172 * f}" text-anchor="end" fill="#667b93">${(yMax * f).toFixed(0)}</text>`).join("")}<text x="68" y="22" fill="#344e6b">${yLabel}</text><text x="${(plotWidth + 40) / 2}" y="254" text-anchor="middle" fill="#344e6b">${xLabel}</text>${available
        .map((item) => {
          const label = `${nameOf(item)} · ${item.members.length} passes from ${item.rideIds.length} rides · ${xValue(item).toFixed(2)} ${xLabel} · ${yValue(item).toFixed(1)} ${yLabel}`;
          const xr = item.ranges[xMetric],
            yr = item.ranges[yMetric];
          const range = `<path data-hill-range="${esc(item.id)}" d="M${x({ ...item, [xMetric]: xr.min })},${y(item)} H${x({ ...item, [xMetric]: xr.max })} M${x(item)},${y({ ...item, [yMetric]: yr.min })} V${y({ ...item, [yMetric]: yr.max })}" stroke="#7899b5" stroke-opacity=".5" fill="none" pointer-events="none"/>`;
          return `${range}<circle data-hill-point="${esc(item.id)}" role="button" tabindex="0" aria-label="${esc(label)}" aria-pressed="${selected.has(item.id)}" cx="${x(item)}" cy="${y(item)}" r="${selected.has(item.id) ? 7 : 5}" fill="${selected.has(item.id) ? "#1e6dcc" : "#7899b5"}" stroke="#fff" stroke-width="1.5"><title>${esc(label)}</title></circle>`;
        })
        .join(
          "",
        )}${!available.length ? `<text x="${(plotWidth + 40) / 2}" y="126" text-anchor="middle" fill="#667b93">No observations with both selected channels</text>` : ""}`;
    $("hill-scatter-caption").textContent =
      `${available.length} named hills plotted; ${items.length - available.length} omitted because a selected channel is missing. Each ride has equal weight after averaging its passes; ranges show ride means, not confidence intervals. Filters choose hills, not individual passes. Differing source boundaries remain visible as variation within one hill.`;
  }
  return {
    open,
    async showSummary(id) {
      await open();
      await summary.select(id);
    },
    load,
    render,
    data: () => catalog,
    invalidate() {
      stale = true;
    },
  };
}
