import { minimumInputProfile } from "/gravity-power.mjs";

export function createGravityProfile({
  host,
  state,
  getMatches,
  getProfile,
  getElevation,
  name,
  esc,
  onWindow,
  onCursor,
}) {
  host.innerHTML = `<div class="plot-controls"><label>Pass on the slope<select id="mechanical-pass"></select></label><label>Horizontal axis<select id="mechanical-axis"><option value="distance">Distance along selected range</option><option value="progress">Progress (%)</option><option value="time">Elapsed time</option></select></label><label>Local distance window <strong id="mechanical-window-value"></strong><input id="mechanical-window" type="range" min="10" max="300" step="5"></label></div><p id="mechanical-profile-status" class="data-note" role="status"></p><svg id="mechanical-profile" role="img" aria-label="Elevation coloured by grade over the power window with a windowed power trace"></svg><div class="overview-legend" id="mechanical-grade-legend"><span><i style="background:#a9c4b8"></i>&lt;3% / descent</span><span><i style="background:#d0c478"></i>3–6%</span><span><i style="background:#e5a16c"></i>6–9%</span><span><i style="background:#d86d64"></i>9–12%</span><span><i style="background:#a676b8"></i>≥12%</span><span><i style="background:#c4ccd5"></i>Grade unavailable</span></div><p id="mechanical-profile-value" role="status"></p><p class="data-note">Elevation fill: grade over the exact distance window used for power; gray means grade unavailable. The lower trace is approximate minimum mechanical input, assuming no motor, towing or propulsive wind. Shading varies the stated height/speed error assumptions and is not a confidence interval. Local windows overlap and are not exact instantaneous watts. The average integrates this curve over time, using supported intervals only. The separate whole-range net bound allows descents to cancel climbs and can be much smaller. A zero minimum does not establish coasting.</p>`;
  const $ = (id) => host.querySelector(`#${id}`);
  let result = null,
    match = null,
    lastWidth = 0,
    frame = 0;
  const imperial = () => state.settings.units === "imperial";
  function draw() {
    const svg = $("mechanical-profile"),
      W = Math.max(300, Math.round(svg.clientWidth || 900)),
      left = 54,
      right = W - 15,
      rows = result?.rows || [],
      axis = $("mechanical-axis").value;
    lastWidth = W;
    svg.setAttribute("viewBox", `0 0 ${W} 410`);
    if (!rows.length) {
      svg.innerHTML = "";
      $("mechanical-profile-status").textContent =
        result?.reason || "Select an available pass and apply weights.";
      return;
    }
    const distanceFactor = imperial() ? 1609.344 : 1000,
      heightFactor = imperial() ? 3.28084 : 1,
      valueX = (r) =>
        axis === "time"
          ? (r.t - rows[0].t) / 1000
          : axis === "progress"
            ? r.progress * 100
            : r.d / distanceFactor,
      maxX = Math.max(0.001, valueX(rows.at(-1))),
      x = (r) => left + (valueX(r) / maxX) * (right - left),
      heights = rows.map((r) => r.elevation).filter(Number.isFinite),
      rawLow = heights.length ? Math.min(...heights) : 0,
      rawHigh = heights.length ? Math.max(...heights) : 1,
      pad = Math.max(1, (rawHigh - rawLow) * 0.06),
      low = rawLow - pad,
      high = rawHigh + pad,
      maxPower =
        Math.max(
          1,
          ...rows
            .flatMap((r) => [r.minimumWatts, r.upperWatts])
            .filter(Number.isFinite),
        ) * 1.1,
      ey = (v) => 180 - ((v - low) / (high - low)) * 145,
      py = (v) => 345 - (v / maxPower) * 112,
      color = (grade) =>
        grade == null
          ? "#c4ccd5"
          : grade >= 12
            ? "#a676b8"
            : grade >= 9
              ? "#d86d64"
              : grade >= 6
                ? "#e5a16c"
                : grade >= 3
                  ? "#d0c478"
                  : "#a9c4b8";
    let area = "",
      slope = "",
      power = "",
      band = "",
      stops = "",
      first = null,
      last = null,
      slopeDown = false,
      powerDown = false;
    rows.forEach((r, i) => {
      if (r.elevation == null) {
        slopeDown = false;
        if (first) {
          area += `L${x(last)},180 Z `;
          first = null;
        }
      } else {
        slope += `${slopeDown ? "L" : "M"}${x(r)},${ey(r.elevation)} `;
        slopeDown = true;
        if (!first) {
          first = r;
          area += `M${x(r)},180 L${x(r)},${ey(r.elevation)} `;
        } else area += `L${x(r)},${ey(r.elevation)} `;
        last = r;
      }
      if (r.minimumWatts == null) powerDown = false;
      else {
        power += `${powerDown ? "L" : "M"}${x(r)},${py(r.minimumWatts)} `;
        powerDown = true;
      }
      const a = rows[i - 1];
      if (a) {
        const known = a.gradePercent != null && r.gradePercent != null;
        stops += `<stop offset="${valueX(a) / maxX}" stop-color="${color(known ? a.gradePercent : null)}"/><stop offset="${valueX(r) / maxX}" stop-color="${color(known ? r.gradePercent : null)}"/>`;
        if (a.lowerWatts != null && r.lowerWatts != null)
          band += `<path data-mechanical-band d="M${x(a)},${py(a.lowerWatts)} L${x(r)},${py(r.lowerWatts)} L${x(r)},${py(r.upperWatts)} L${x(a)},${py(a.upperWatts)} Z" fill="#287bd5" opacity=".16"/>`;
      }
    });
    if (first) area += `L${x(last)},180 Z`;
    svg.innerHTML = `<text x="${left}" y="18">${getElevation(match) ? "Reference" : "Recorded"} elevation (${imperial() ? "ft" : "m"})</text>${[
      0, 0.5, 1,
    ]
      .map((f) => {
        const v = low + (high - low) * f;
        return `<line x1="${left}" x2="${right}" y1="${ey(v)}" y2="${ey(v)}" stroke="#e4e9ee"/><text x="${left - 6}" y="${ey(v) + 4}" text-anchor="end">${(v * heightFactor).toFixed(0)}</text>`;
      })
      .join(
        "",
      )}<defs><linearGradient id="mechanical-slope-fill" gradientUnits="userSpaceOnUse" x1="${left}" x2="${right}">${stops}</linearGradient></defs><path data-mechanical-slope d="${area}" fill="url(#mechanical-slope-fill)"/><path d="${slope}" fill="none" stroke="#61758a" stroke-width="1.5"/><text x="${left}" y="217">Windowed minimum mechanical input (W)</text>${[0, 0.5, 1].map((f) => `<line x1="${left}" x2="${right}" y1="${py(f * maxPower)}" y2="${py(f * maxPower)}" stroke="#e4e9ee"/><text x="${left - 6}" y="${py(f * maxPower) + 4}" text-anchor="end">${Math.round(f * maxPower)}</text>`).join("")}${band}<path data-mechanical-power d="${power}" fill="none" stroke="#185d9f" stroke-width="2"/>${[0, 0.5, 1].map((f) => `<text x="${left + f * (right - left)}" y="368" text-anchor="middle">${(maxX * f).toFixed(axis === "distance" ? 2 : 0)}${axis === "progress" ? "%" : axis === "time" ? " s" : imperial() ? " mi" : " km"}</text>`).join("")}<text x="${(left + right) / 2}" y="396" text-anchor="middle">${axis === "time" ? "Elapsed time in selected range" : axis === "progress" ? "Approximate distance progress" : "Distance along selected range"}</text><line id="mechanical-cursor" y1="30" y2="345" stroke="#53687e" opacity="0"/>`;
    const count = rows.filter((r) => r.minimumWatts != null).length;
    $("mechanical-profile-status").textContent =
      `${count}/${rows.length} local positions supported · ${result.windowMeters} m physical window (shared with gradient) · speeds use up to 5 s time averaging of the speed channel, or distance/time when absent. Windows with speed/distance disagreement are unavailable. Zero means no positive lower bound: air/tyre/drivetrain losses are omitted, and pedalling power may still be positive. ${getElevation(match) ? "Reference elevation is aligned by normalized distance progress; interior alignment is approximate." : "Uses this pass’s own recorded elevation."} ${state.settings.powerHeightErrorM == null || state.settings.powerSpeedErrorMps == null ? "Error sensitivity is unquantified until both error assumptions are entered." : "Shading is sensitivity to the entered height and speed errors."}`;
    svg.onpointermove = (event) => {
      const bounds = svg.getBoundingClientRect(),
        position = Math.max(
          0,
          Math.min(
            maxX,
            ((((event.clientX - bounds.left) / bounds.width) * W - left) /
              (right - left)) *
              maxX,
          ),
        ),
        row = rows.reduce(
          (best, r) =>
            Math.abs(valueX(r) - position) < Math.abs(valueX(best) - position)
              ? r
              : best,
          rows[0],
        ),
        cursor = $("mechanical-cursor"),
        show = (v) => (v == null ? "unavailable" : `${v.toFixed(0)} W`);
      cursor.setAttribute("x1", x(row));
      cursor.setAttribute("x2", x(row));
      cursor.setAttribute("opacity", ".6");
      $("mechanical-profile-value").textContent =
        `${Math.round((row.t - rows[0].t) / 1000)} s into range · grade ${row.gradePercent == null ? "unavailable" : `${row.gradePercent.toFixed(1)}%`} · minimum ${show(row.minimumWatts)} · gravity ${show(row.gravityWatts)} · momentum ${show(row.kineticWatts)}${row.minimumWatts === 0 ? " · no positive lower bound; pedalling may still be positive" : ""}${row.lowerWatts == null ? " · error range unquantified" : ` · assumed-error sensitivity ${show(row.lowerWatts)}–${show(row.upperWatts)}`}${row.reason ? ` · ${row.reason}` : ` · local window ${row.windowMeters.toFixed(1)} m / ${row.windowSeconds.toFixed(1)} s`}`;
      onCursor(row.point);
    };
    svg.onpointerleave = () => {
      $("mechanical-cursor").setAttribute("opacity", "0");
      onCursor(null);
    };
  }
  function render() {
    if (!host.closest("details").open) return;
    const matches = getMatches(),
      previous = $("mechanical-pass").value;
    $("mechanical-pass").innerHTML = matches
      .map((m) => `<option value="${esc(m.id)}">${esc(name(m))}</option>`)
      .join("");
    $("mechanical-pass").value = matches.some((m) => m.id === previous)
      ? previous
      : matches.some((m) => m.id === state.baseline)
        ? state.baseline
        : matches[0]?.id || "";
    match = matches.find((m) => m.id === $("mechanical-pass").value);
    $("mechanical-window").value = state.settings.gradeWindow;
    $("mechanical-window-value").textContent =
      `${state.settings.gradeWindow} m`;
    result = match
      ? getProfile?.(match) ||
        minimumInputProfile(
          match.points,
          state.settings,
          getElevation(match) || match.points,
        )
      : null;
    $("mechanical-profile-value").textContent =
      "Hover to inspect gravity, momentum and minimum input; the cursor links to the source map.";
    draw();
  }
  $("mechanical-pass").onchange = render;
  $("mechanical-axis").onchange = draw;
  $("mechanical-window").oninput = (e) => onWindow(+e.target.value);
  new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (
        host.closest("details").open &&
        host.clientWidth > 0 &&
        Math.max(300, Math.round(host.clientWidth)) !== lastWidth
      )
        draw();
    });
  }).observe(host);
  return { render };
}
