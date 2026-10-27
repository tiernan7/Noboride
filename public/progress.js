import { buildProgress, progressPoints } from "/progress.mjs";

export function createProgress({
  host,
  state,
  contexts,
  getActiveId,
  getRide,
  esc,
  onOpen,
  onInclude,
  onComparisons,
}) {
  host.innerHTML = `<div class="section-title"><div><div class="eyebrow">PROGRESS · PROTOTYPE</div><h2>The same road, over time</h2><p>Follow accepted passes at verified comparison endpoints. Each comparison keeps its own road definition.</p></div><button id="progress-reload" class="button small">Refresh progress</button></div><div class="progress-controls"><label>Comparison road<select id="progress-road"></select></label><label>Plot points<select id="progress-mode"><option value="ride-mean">Average per ride</option><option value="passes">Every pass</option><option value="best">Fastest pass per ride</option></select></label><label>Metric<select id="progress-metric"><option value="elapsed">Elapsed time</option><option value="hr">Average heart rate</option><option value="speed">Average speed</option><option value="entrySpeed">Entry speed</option></select></label><label>From<input id="progress-from" type="date"></label><label>Through<input id="progress-through" type="date"></label><label>Ride<select id="progress-ride"><option value="">All included rides</option></select></label></div><p id="progress-status" role="status"></p><div id="progress-summary" class="progress-summary"></div><svg id="progress-chart" role="img" aria-label="Performance observations by date"></svg><p id="progress-value" role="status">Choose a point to inspect its pass.</p><p class="data-note">Per-ride averages give each pass equal weight; sensor means within a pass are time weighted. Fastest means the shortest elapsed pass, with that same pass’s HR and speed. Entry speed uses the first five seconds of distance/time (or the shorter available range). These are observations, not proof of fitness or equipment effects.</p><div id="progress-passes" class="table-scroll"></div><details id="progress-excluded"><summary id="progress-excluded-count"></summary><div id="progress-excluded-list"></div></details><p class="data-note">Manual hill bounds can differ from common timing gates. Manual, rejected, unverified and unselected entries stay outside this trend. Progress never accepts new matches or edits comparison boundaries.</p><button id="progress-go-comparisons" class="text-button">Go to Comparisons</button>`;
  const $ = (id) => host.querySelector(`#${id}`);
  let result = null,
    comparison = null,
    plotted = [],
    generation = 0,
    signature = "",
    initialized = false,
    selectedRide = "",
    lastWidth = 0,
    frame = 0;
  const imperial = () => state.settings.units === "imperial";
  const rides = () => new Map(state.rides.map((r) => [r.id, r]));
  const title = (id) => rides().get(id)?.name || "Unavailable ride";
  const time = (value) =>
    value == null
      ? "—"
      : `${Math.floor(Math.round(value) / 60)}:${String(Math.round(value) % 60).padStart(2, "0")}`;
  const date = (t) =>
    new Date(t).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const definitions = () => ({
    elapsed: { label: "Elapsed time (min:sec)", show: time },
    hr: {
      label: "Average heart rate (bpm)",
      show: (v) => (v == null ? "—" : `${v.toFixed(1)} bpm`),
    },
    speed: {
      label: `Average speed (${imperial() ? "mph" : "km/h"})`,
      show: (v) =>
        v == null
          ? "—"
          : `${(v * (imperial() ? 2.236936 : 3.6)).toFixed(1)} ${imperial() ? "mph" : "km/h"}`,
    },
    entrySpeed: {
      label: `Entry speed (${imperial() ? "mph" : "km/h"})`,
      show: (v) =>
        v == null
          ? "—"
          : `${(v * (imperial() ? 2.236936 : 3.6)).toFixed(1)} ${imperial() ? "mph" : "km/h"}`,
    },
  });
  function filtered() {
    const from = $("progress-from").value
      ? new Date(`${$("progress-from").value}T00:00:00`).getTime()
      : -Infinity;
    const through = $("progress-through").value
      ? new Date(`${$("progress-through").value}T00:00:00`)
      : null;
    if (through) through.setDate(through.getDate() + 1);
    return (result?.rows || []).filter(
      (r) =>
        r.eligible &&
        r.timestamp >= from &&
        r.timestamp < (through?.getTime() ?? Infinity) &&
        (!$("progress-ride").value || r.rideId === $("progress-ride").value),
    );
  }
  function draw() {
    const rows = filtered(),
      mode = $("progress-mode").value,
      metric = $("progress-metric").value,
      def = definitions()[metric];
    plotted = progressPoints(rows, mode).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    const values = plotted.filter((p) => Number.isFinite(p[metric]));
    $("progress-summary").textContent =
      `${rows.length} verified passes · ${new Set(rows.map((r) => r.rideId)).size} rides · ${values.length} plotted points${comparison ? ` · fixed road ${((result.roadDistance || 0) / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}` : ""}`;
    const svg = $("progress-chart"),
      W = Math.max(300, Math.round(svg.clientWidth || 900)),
      H = 300,
      L = 65,
      R = W - 20,
      top = 30,
      bottom = 245;
    lastWidth = W;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (!values.length)
      svg.innerHTML = `<text x="${W / 2}" y="130" text-anchor="middle">${rows.length ? "This metric is missing for the filtered passes" : "No verified passes in this selection"}</text>`;
    else {
      let xMin = Math.min(...values.map((p) => p.timestamp)),
        xMax = Math.max(...values.map((p) => p.timestamp));
      if (xMin === xMax) {
        xMin -= 43200000;
        xMax += 43200000;
      }
      const low = Math.min(...values.map((p) => p[metric])),
        high = Math.max(...values.map((p) => p[metric])),
        pad = Math.max(
          metric === "hr" ? 5 : metric === "elapsed" ? 1 : 0.2,
          (high - low) * 0.12,
        ),
        lo = Math.max(0, low - pad),
        hi = high + pad,
        x = (t) => L + ((t - xMin) / (xMax - xMin)) * (R - L),
        y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
      svg.innerHTML = `<text x="${L}" y="16">${esc(def.label)}</text>${[
        0, 0.5, 1,
      ]
        .map((f) => {
          const v = lo + f * (hi - lo);
          return `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8ee"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(metric === "elapsed" ? time(v) : metric === "hr" ? v.toFixed(0) : (v * (imperial() ? 2.236936 : 3.6)).toFixed(1))}</text>`;
        })
        .join(
          "",
        )}${[0, 0.5, 1].map((f) => `<text x="${x(xMin + f * (xMax - xMin))}" y="274" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${esc(date(xMin + f * (xMax - xMin)))}</text>`).join("")}${values
        .map((p) => {
          const index = plotted.indexOf(p),
            description = `${title(p.rideId)} · ${date(p.timestamp)} · ${def.show(p[metric])} · ${mode === "ride-mean" ? `${p.count} passes averaged` : mode === "best" ? `fastest of ${p.count} passes` : `pass ${p.pass}`}${p.support && p.support[metric] < p.count ? ` · ${p.support[metric]}/${p.count} passes have this channel` : ""}`;
          return `<g data-progress-point="${index}" tabindex="0" role="button" aria-label="${esc(description)}"><title>${esc(description)}</title><circle cx="${x(p.timestamp)}" cy="${y(p[metric])}" r="7" fill="${mode === "best" ? "#bd6d2e" : "#287bd5"}" stroke="white" stroke-width="2"/></g>`;
        })
        .join("")}`;
    }
    $("progress-passes").innerHTML = rows.length
      ? `<table><thead><tr><th>Ride / pass</th><th>Date</th><th>Elapsed</th><th>Distance</th><th>Avg HR</th><th>Entry speed</th><th>Bike / conditions / notes</th><th></th></tr></thead><tbody>${rows
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((r) => {
            const ride = rides().get(r.rideId),
              notes = ride?.notes || {};
            return `<tr data-progress-entry="${esc(r.entryId)}" class="${r.rideId === selectedRide ? "baseline" : ""}"><td>${esc(title(r.rideId))} · pass ${r.pass}</td><td>${esc(date(r.timestamp))}</td><td>${time(r.elapsed)}</td><td>${(r.distance / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}</td><td>${esc(definitions().hr.show(r.hr))}</td><td>${esc(definitions().entrySpeed.show(r.entrySpeed))}</td><td>${esc([notes.bike, notes.conditions, notes.notes].filter(Boolean).join(" · ") || "Not noted")}</td><td><button type="button" class="text-button" data-progress-open="${esc(r.entryId)}">Open pass</button></td></tr>`;
          })
          .join("")}</tbody></table>`
      : "";
    const excluded = result?.rows.filter((r) => !r.eligible) || [];
    $("progress-excluded-count").textContent =
      `${excluded.length} saved passes outside the verified trend`;
    $("progress-excluded-list").innerHTML = excluded
      .map(
        (r) =>
          `<p>${esc(title(r.rideId))} · pass ${r.pass}: ${esc(r.reason)} ${!state.selected.includes(r.rideId) ? `<button type="button" class="text-button" data-progress-include="${esc(r.rideId)}">Include ride</button>` : ""}</p>`,
      )
      .join("");
  }
  async function load(force = false) {
    const all = contexts().filter(
        (c) => c.road && c.mode !== "terrain" && c.entries.length,
      ),
      previous = $("progress-road").value;
    $("progress-road").innerHTML =
      '<option value="">Choose a saved comparison road</option>' +
      all
        .map(
          (c) =>
            `<option value="${esc(c.id)}">${esc(c.name || "Untitled comparison")}</option>`,
        )
        .join("");
    const chosen = all.some((c) => c.id === previous)
      ? previous
      : !initialized
        ? all.find((c) => c.id === getActiveId())?.id || all[0]?.id || ""
        : "";
    initialized = true;
    $("progress-road").value = chosen;
    comparison = all.find((c) => c.id === chosen) || null;
    const next = JSON.stringify([
      comparison,
      state.selected,
      state.settings.units,
      state.rides.map((r) => [r.id, r.name, r.notes]),
    ]);
    if (!force && next === signature) return;
    signature = next;
    const turn = ++generation;
    if (!comparison) {
      result = null;
      $("progress-status").textContent =
        "Save or choose a comparison with a common road to explore progress.";
      draw();
      return;
    }
    $("progress-status").textContent =
      "Checking accepted passes against the saved road…";
    try {
      const ids = [
        ...new Set([
          comparison.road.rideId,
          ...comparison.entries
            .filter((e) => state.selected.includes(e.rideId))
            .map((e) => e.rideId),
        ]),
      ];
      const loaded = new Map(
        await Promise.all(ids.map(async (id) => [id, await getRide(id)])),
      );
      if (turn !== generation) return;
      result = buildProgress(
        comparison,
        (id) => loaded.get(id),
        state.selected,
      );
      const rideFilter = $("progress-ride").value;
      $("progress-ride").innerHTML =
        '<option value="">All included rides</option>' +
        [...new Set(comparison.entries.map((e) => e.rideId))]
          .map((id) => `<option value="${esc(id)}">${esc(title(id))}</option>`)
          .join("");
      if ([...$("progress-ride").options].some((o) => o.value === rideFilter))
        $("progress-ride").value = rideFilter;
      $("progress-status").textContent =
        `${comparison.name || "Untitled comparison"} · accepted passes only · GPS gate ${comparison.settings.matchRadius} m · uses currently included rides. All results are descriptive.`;
      draw();
    } catch (error) {
      if (turn !== generation) return;
      signature = "";
      result = null;
      $("progress-status").textContent =
        `Progress unavailable: ${error.message}. Refresh to retry.`;
      draw();
    }
  }
  for (const id of [
    "progress-mode",
    "progress-metric",
    "progress-from",
    "progress-through",
    "progress-ride",
  ])
    $(id).onchange = () => {
      selectedRide = "";
      draw();
    };
  $("progress-road").onchange = () => {
    signature = "";
    selectedRide = "";
    $("progress-ride").value = "";
    load();
  };
  $("progress-reload").onclick = () => load(true);
  $("progress-go-comparisons").onclick = onComparisons;
  host.addEventListener("click", (event) => {
    const open = event.target.closest("[data-progress-open]"),
      include = event.target.closest("[data-progress-include]"),
      point = event.target.closest("[data-progress-point]");
    if (open) onOpen(comparison.id, open.dataset.progressOpen);
    else if (include) onInclude(include.dataset.progressInclude);
    else if (point) choose(+point.dataset.progressPoint);
  });
  host.addEventListener("keydown", (event) => {
    const point = event.target.closest("[data-progress-point]");
    if (point && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      choose(+point.dataset.progressPoint);
    }
  });
  function choose(index) {
    const point = plotted[index];
    if (!point) return;
    const metric = $("progress-metric").value;
    $("progress-value").textContent =
      `${title(point.rideId)} · ${definitions()[metric].show(point[metric])} · ${point.count} accepted passes${point.entryId ? "" : " averaged; choose an individual pass below"}`;
    if (point.entryId) onOpen(comparison.id, point.entryId);
    else {
      selectedRide = point.rideId;
      draw();
    }
  }
  new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (
        !host.closest("section").hidden &&
        host.clientWidth > 0 &&
        Math.max(300, Math.round($("progress-chart").clientWidth)) !== lastWidth
      )
        draw();
    });
  }).observe(host);
  return {
    open: () => load(true),
    refresh: () => {
      if (!host.closest("section").hidden) load();
    },
  };
}
