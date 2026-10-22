import { hillProfile } from "/hill-profile.mjs";

// Compare aggregate terrain identities here; original pass editing stays in Comparisons.
export function createHillComparison({ host, state, getRide, esc }) {
  host.hidden = true;
  host.innerHTML = `<div class="hill-list-heading"><div><p class="eyebrow">DIFFERENT HILLS</p><h3>Hill shapes and recorded response</h3></div><button id="hill-cross-close" class="text-button">Close</button></div><div class="hill-summary-controls"><label>Ride feature<select id="hill-cross-metric"><option value="grade">Gradient</option><option value="speed">Recorded speed</option><option value="hr">Heart rate</option><option value="power">Measured power</option></select></label><label>Horizontal axis<select id="hill-cross-axis"><option value="distance">Distance from hill start</option><option value="progress">Hill progress (%)</option></select></label></div><p id="hill-cross-status" class="hill-muted" role="status"></p><svg id="hill-cross-profile" role="img" aria-label="Aggregate elevation and recorded features across different named hills"></svg><div id="hill-cross-legend" class="hill-cross-legend"></div><p id="hill-cross-value" class="hill-muted">Hover to inspect the hills at the same displayed position.</p><p class="hill-muted">Each line is one named hill, with equal weight per ride. Bands show the range of ride means, not confidence intervals. Different terrain and recording coverage can affect the recorded response.</p>`;
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
  let series = [],
    generation = 0,
    lastWidth = 0,
    frame = 0;
  function draw() {
    const svg = $("hill-cross-profile"),
      W = Math.max(300, Math.round(svg.clientWidth || 900)),
      left = 58,
      right = W - 18,
      metric = $("hill-cross-metric").value,
      progress = $("hill-cross-axis").value === "progress",
      xMax = progress
        ? 1
        : Math.max(1, ...series.map((s) => s.result.length || 0)),
      xf = (p) => (progress ? p.progress : p.s),
      x = (v) => left + (v / xMax) * (right - left),
      heightFactor = imperial() ? 3.28084 : 1,
      factor = metric === "speed" ? (imperial() ? 2.236936 : 3.6) : 1,
      unit =
        metric === "speed"
          ? imperial()
            ? "mph"
            : "km/h"
          : metric === "grade"
            ? "%"
            : metric === "hr"
              ? "bpm"
              : "W",
      label =
        metric === "speed"
          ? "Recorded speed"
          : metric === "grade"
            ? "Gradient"
            : metric === "hr"
              ? "Heart rate"
              : "Measured power";
    lastWidth = W;
    svg.setAttribute("viewBox", `0 0 ${W} 370`);
    function lane(key, top, bottom, convert) {
      const values = series.flatMap((s) =>
          s.result.profile.map((p) => p[key]).filter((v) => v?.mean != null),
        ),
        low = Math.min(0, ...values.map((v) => v.min * convert)),
        high = Math.max(low + 1, ...values.map((v) => v.max * convert)),
        y = (v) =>
          bottom - ((v * convert - low) / (high - low)) * (bottom - top);
      let markup = [0, 0.5, 1]
        .map((f) => {
          const value = low + (high - low) * f,
            position = bottom - f * (bottom - top);
          return `<line x1="${left}" x2="${right}" y1="${position}" y2="${position}" stroke="#e2e8ee"/><text x="${left - 7}" y="${position + 4}" text-anchor="end">${value.toFixed(key === "speed" ? 1 : 0)}</text>`;
        })
        .join("");
      for (const [index, s] of series.entries()) {
        let trace = "",
          bands = "",
          down = false;
        const colour = palette[index % palette.length];
        s.result.profile.forEach((p, i, points) => {
          const v = p[key];
          if (v.mean == null) {
            down = false;
            return;
          }
          trace += `${down ? "L" : "M"}${x(xf(p))},${y(v.mean)} `;
          down = true;
          const a = points[i - 1];
          if (a?.[key].mean != null)
            bands += `<path d="M${x(xf(a))},${y(a[key].min)} L${x(xf(p))},${y(v.min)} L${x(xf(p))},${y(v.max)} L${x(xf(a))},${y(a[key].max)} Z" fill="${colour}" opacity=".12"/>`;
        });
        markup += `${bands}<path data-cross-hill="${esc(s.hill.id)}" data-cross-lane="${key}" d="${trace}" fill="none" stroke="${colour}" stroke-width="2"/>`;
      }
      if (key === "grade")
        markup += `<line x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}" stroke="#8b99a8" stroke-dasharray="3 4"/>`;
      if (!values.length)
        markup += `<text x="${(left + right) / 2}" y="${(top + bottom) / 2}" text-anchor="middle">${label} not recorded</text>`;
      return markup;
    }
    svg.innerHTML = `<text x="${left}" y="16">Relative elevation (${imperial() ? "ft" : "m"}) · each hill starts at its own elevation</text>${lane("ele", 30, 196, heightFactor)}<text x="${left}" y="227">${label} (${unit})</text>${lane(metric, 242, 314, factor)}${[0, 0.5, 1].map((f) => `<text x="${x(xMax * f)}" y="338" text-anchor="middle">${progress ? `${Math.round(f * 100)}%` : `${((xMax * f) / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}`}</text>`).join("")}<text x="${(left + right) / 2}" y="363" text-anchor="middle">${progress ? "Relative progress through each mapped hill (%)" : "Distance from each mapped hill start"}</text><line data-cross-cursor y1="30" y2="314" opacity="0" stroke="#53687e"/>`;
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
      $("hill-cross-value").textContent = series
        .map((s) => {
          if (
            !s.result.profile.length ||
            (!progress && position > s.result.length)
          )
            return `${s.hill.name}: outside recorded hill`;
          const f = progress ? position : position / s.result.length,
            value = s.result.profile[Math.round(f * 100)]?.[metric];
          return `${s.hill.name}: ${value?.mean == null ? "not recorded" : `${(value.mean * factor).toFixed(1)} ${unit} · ${value.rides} rides`}`;
        })
        .join(" · ");
    };
  }
  $("hill-cross-metric").onchange = draw;
  $("hill-cross-axis").onchange = draw;
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
  return {
    async show(hills) {
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
        result: hillProfile(
          hill.members,
          (id) => rides.get(id),
          null,
          state.settings,
        ),
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
      host.scrollIntoView({ block: "start", behavior: "smooth" });
    },
  };
}
