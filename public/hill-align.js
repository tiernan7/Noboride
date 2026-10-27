import { hasGPS, summarize, gradeProfile, lowerBound } from "/analysis.mjs";
import { stretchPoints } from "/comparisons.mjs";
import { hillProfile } from "/hill-profile.mjs";

export function createHillAlignment({
  host,
  state,
  getRide,
  esc,
  onConfirm,
  onChange,
}) {
  host.hidden = true;
  host.innerHTML = `<h4 id="hill-align-title">Review hill alignment</h4><p class="subtle">Adjust this saved hill pass’s boundaries. Comparison sections keep their own boundaries. Check the road and where each pass finishes on the hill.</p><div class="hill-alignment-visuals"><svg id="hill-align-map" role="img" aria-label="Original tracks for this hill alignment review"></svg><div><svg id="hill-align-profile" role="img" aria-label="Elevation and gradient around each pass with approach and aftermath"></svg><p class="hill-muted">Blue: this pass · gray: other hill passes. Elevation is relative to each selected start; distance is not stretched to force agreement. About 150 m of surrounding terrain is included.</p></div></div><p id="hill-align-end-context" class="hill-muted"></p><button id="hill-align-crest" type="button" class="text-button" disabled>Use nearby recorded high point as end</button><label>Hill-only start<input id="hill-align-start" type="range" min="0" step="any"></label><label>Hill-only end<input id="hill-align-end" type="range" min="0" step="any"></label><p id="hill-align-range" class="hill-muted"></p><p id="hill-align-status" role="status"></p><button id="hill-align-confirm" type="button" class="button">Confirm this pass follows this hill in this direction</button>`;
  const $ = (id) => host.querySelector(`#${id}`);
  let value = null,
    ride = null,
    generation = 0,
    crestIndex = null,
    renderedWidth = 0,
    valid = false;
  function profile(geometry, rides, candidate) {
    const imperial = state.settings.units === "imperial",
      distanceFactor = imperial ? 1609.344 : 1000,
      heightFactor = imperial ? 3.28084 : 1,
      unit = imperial ? "mi" : "km";
    const curves = geometry.map(({ o, points }) => {
      const full = rides.get(o.rideId).points,
        start = points[0],
        end = points.at(-1),
        lo = Math.max(
          0,
          lowerBound(full, Math.max(full[0].d, start.d - 150)) - 1,
        ),
        hi = Math.min(full.length - 1, lowerBound(full, end.d + 150)),
        grades = gradeProfile(
          full,
          state.settings.gradeWindow,
          state.settings.gapSeconds,
        );
      return {
        o,
        full,
        start,
        end,
        grades,
        rows: full.slice(lo, hi + 1).map((p, i) => ({
          p,
          index: lo + i,
          x: p.d - start.d,
          ele:
            p.ele == null || start.ele == null
              ? null
              : (p.ele - start.ele) * heightFactor,
          grade: grades[lo + i],
        })),
      };
    });
    const svg = $("hill-align-profile"),
      W = Math.max(300, Math.round(svg.clientWidth || 600)),
      left = 45,
      right = W - 12,
      rows = curves.flatMap((c) => c.rows),
      lowX = rows.reduce((a, r) => Math.min(a, r.x), 0),
      highX = rows.reduce((a, r) => Math.max(a, r.x), 1),
      x = (v) =>
        left + ((v - lowX) / Math.max(1, highX - lowX)) * (right - left),
      domains = Object.fromEntries(
        ["ele", "grade"].map((k) => [
          k,
          {
            low: rows.reduce(
              (a, r) => (r[k] == null ? a : Math.min(a, r[k])),
              0,
            ),
            high: rows.reduce(
              (a, r) => (r[k] == null ? a : Math.max(a, r[k])),
              1,
            ),
          },
        ]),
      );
    const lanes = [
      {
        key: "ele",
        top: 24,
        bottom: 135,
        label: `Relative elevation (${imperial ? "ft" : "m"})`,
      },
      { key: "grade", top: 169, bottom: 230, label: "Gradient (%)" },
    ];
    svg.setAttribute("viewBox", `0 0 ${W} 280`);
    let markup = lanes
      .map((lane) => {
        const domain = domains[lane.key],
          y = (v) =>
            lane.bottom -
            ((v - domain.low) / Math.max(1, domain.high - domain.low)) *
              (lane.bottom - lane.top);
        let html = `<text x="${left}" y="${lane.top - 9}">${lane.label}</text>`;
        for (const f of [0, 0.5, 1]) {
          const v = domain.low + f * (domain.high - domain.low);
          html += `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8ee"/><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`;
        }
        const selected = curves.find((c) => c.o.id === candidate.id);
        html += `<rect x="${x(0)}" y="${lane.top}" width="${Math.max(0, x(selected.end.d - selected.start.d) - x(0))}" height="${lane.bottom - lane.top}" fill="#287bd510"/>`;
        for (const c of curves) {
          let d = "",
            down = false;
          c.rows.forEach((r, i) => {
            if (r[lane.key] == null) {
              down = false;
              return;
            }
            if (r.p.breakBefore || (i && r.p.t - c.rows[i - 1].p.t > 30000))
              down = false;
            d += `${down ? "L" : "M"}${x(r.x)},${y(r[lane.key])} `;
            down = true;
          });
          const color = c.o.id === candidate.id ? "#287bd5" : "#a4afbc";
          html += `<path data-hill-${lane.key === "ele" ? "elevation" : "gradient"}="${esc(c.o.id)}" d="${d}" fill="none" stroke="${color}" stroke-width="${c.o.id === candidate.id ? 2.3 : 1.5}"><title>${esc(rides.get(c.o.rideId).name || "Other hill pass")}</title></path><line data-hill-profile-end="${esc(c.o.id)}" x1="${x(c.end.d - c.start.d)}" x2="${x(c.end.d - c.start.d)}" y1="${lane.top}" y2="${lane.bottom}" stroke="${color}" stroke-dasharray="3 4"/>`;
        }
        if (lane.key === "grade")
          html += `<line x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}" stroke="#8192a2" stroke-opacity=".5" stroke-dasharray="3 4"/>`;
        return html;
      })
      .join("");
    markup +=
      [lowX, (lowX + highX) / 2, highX]
        .map(
          (v) =>
            `<text x="${x(v)}" y="253" text-anchor="middle">${(v / distanceFactor).toFixed(2)}</text>`,
        )
        .join("") +
      `<text x="${(left + right) / 2}" y="276" text-anchor="middle">Distance from each selected start (${unit})</text>`;
    svg.innerHTML = markup;
    const selected = curves.find((c) => c.o.id === candidate.id),
      full = selected.full,
      peakLo = Math.max(
        Math.ceil(candidate.start),
        lowerBound(full, selected.end.d - 150),
      ),
      peakHi = Math.min(
        full.length - 1,
        lowerBound(full, selected.end.d + 150),
      ),
      window = full.slice(peakLo, peakHi + 1);
    crestIndex = null;
    if (
      window.length &&
      window.every(
        (p, i) =>
          p.ele != null &&
          (!i || (!p.breakBefore && p.t - window[i - 1].t <= 30000)),
      )
    ) {
      for (let i = peakLo; i <= peakHi; i++)
        if (
          full[i].d - selected.start.d >= 20 &&
          (crestIndex == null ||
            full[i].ele > full[crestIndex].ele ||
            (full[i].ele === full[crestIndex].ele &&
              Math.abs(full[i].d - selected.end.d) <
                Math.abs(full[crestIndex].d - selected.end.d)))
        )
          crestIndex = i;
    }
    const lo = Math.floor(candidate.end),
      hi = Math.ceil(candidate.end),
      a = selected.grades[lo],
      b = selected.grades[hi],
      grade =
        a == null || b == null ? null : a + (b - a) * (candidate.end - lo);
    let text =
      grade == null
        ? "End gradient unavailable."
        : `End gradient ${grade.toFixed(1)}%.`;
    if (crestIndex != null && selected.end.ele != null) {
      const delta = selected.end.d - full[crestIndex].d,
        drop = (full[crestIndex].ele - selected.end.ele) * heightFactor;
      text += ` End ${Math.abs(delta) < 1 ? "at" : `${Math.abs(delta).toFixed(0)} m ${delta > 0 ? "after" : "before"}`} the nearby recorded high point${drop > 0 ? ` · ${drop.toFixed(1)} ${imperial ? "ft" : "m"} below it` : ""}. Review the profile before using this point.`;
    } else
      text +=
        " Nearby high point unavailable across missing elevation or recording gaps.";
    $("hill-align-end-context").textContent = text;
    $("hill-align-crest").disabled =
      crestIndex == null || Math.abs(crestIndex - candidate.end) < 0.01;
  }
  async function draw() {
    if (!value || !ride) return;
    const turn = ++generation;
    renderedWidth = host.clientWidth;
    valid = false;
    crestIndex = null;
    $("hill-align-crest").disabled = true;
    $("hill-align-confirm").disabled = true;
    const candidate = {
      id: value.id,
      rideId: value.rideId,
      start: +$("hill-align-start").value,
      end: +$("hill-align-end").value,
    };
    if (candidate.start >= candidate.end) {
      $("hill-align-range").textContent =
        "Invalid hill range; distance and elapsed time unavailable.";
      $("hill-align-status").textContent = "Start must come before end.";
      return;
    }
    value.onBounds(candidate.start, candidate.end);
    const points = stretchPoints(ride.points, candidate.start, candidate.end),
      stats = summarize(points);
    const clock = (t) => {
      const seconds = Math.round((t - ride.points[0].t) / 1000);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    };
    $("hill-align-range").textContent =
      `Hill draft: ${(stats.distance / (state.settings.units === "imperial" ? 1609.344 : 1000)).toFixed(2)} ${state.settings.units === "imperial" ? "mi" : "km"} · elapsed ${Math.floor(Math.round(stats.elapsed) / 60)}:${String(Math.round(stats.elapsed) % 60).padStart(2, "0")} · ${clock(points[0].t)}–${clock(points.at(-1).t)} into ride. ${candidate.start === value.comparisonStart && candidate.end === value.comparisonEnd ? "Same bounds as comparison timing." : "Differs from comparison timing; save the hill, then use Apply saved hill bounds to comparison to update its analysis."}`;
    const other = value.others.filter((o) => o.id !== candidate.id),
      all = [...other, candidate],
      rides = new Map(
        await Promise.all(
          [...new Set(all.map((o) => o.rideId))].map(async (id) => [
            id,
            await getRide(id),
          ]),
        ),
      );
    if (turn !== generation) return;
    const result = hillProfile(all, (id) => rides.get(id), null, {
        ...state.settings,
        preferredObservationIds: other.map((o) => o.id),
      }),
      mapped = result.passes.find((p) => p.observation.id === candidate.id),
      geometry = all.map((o) => ({
        o,
        points: stretchPoints(rides.get(o.rideId).points, o.start, o.end),
      })),
      gps = geometry.flatMap((g) => g.points.filter(hasGPS)),
      minLat = gps.reduce((a, p) => Math.min(a, p.lat), Infinity),
      maxLat = gps.reduce((a, p) => Math.max(a, p.lat), -Infinity),
      minLon = gps.reduce((a, p) => Math.min(a, p.lon), Infinity),
      maxLon = gps.reduce((a, p) => Math.max(a, p.lon), -Infinity),
      cosine = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180),
      spanX = (maxLon - minLon) * cosine,
      spanY = maxLat - minLat,
      mapWidth = Math.max(
        280,
        Math.round($("hill-align-map").clientWidth || 670),
      ),
      mapSpan = mapWidth - 70,
      scale = Math.min(
        mapSpan / Math.max(1e-9, spanX),
        170 / Math.max(1e-9, spanY),
      ),
      x = (p) =>
        35 + (p.lon - minLon) * cosine * scale + (mapSpan - spanX * scale) / 2,
      y = (p) => 205 - (p.lat - minLat) * scale - (170 - spanY * scale) / 2;
    $("hill-align-map").setAttribute("viewBox", `0 0 ${mapWidth} 235`);
    $("hill-align-map").innerHTML =
      geometry
        .map(({ o, points }) => {
          let d = "",
            down = false;
          points.forEach((p, i) => {
            if (!hasGPS(p)) {
              down = false;
              return;
            }
            if (p.breakBefore || (i && p.t - points[i - 1].t > 30000))
              down = false;
            d += `${down ? "L" : "M"}${x(p)},${y(p)} `;
            down = true;
          });
          const selected = o.id === candidate.id,
            first = points[0],
            last = points.at(-1);
          return `<path d="${d}" fill="none" stroke="${selected ? "#287bd5" : "#aebdce"}" stroke-width="${selected ? 4 : 2}"/>${
            selected
              ? [
                  [first, "S"],
                  [last, "E"],
                ]
                  .filter(([p]) => hasGPS(p))
                  .map(
                    ([p, label]) =>
                      `<circle cx="${x(p)}" cy="${y(p)}" r="5" fill="#287bd5"/><text x="${x(p) + 8}" y="${y(p) - 7}">${label}</text>`,
                  )
                  .join("")
              : ""
          }`;
        })
        .join("") +
      `<text x="12" y="225">Original GPS coordinates · S → E</text>`;
    profile(geometry, rides, candidate);
    valid =
      !!mapped && stats.distance >= 20 && result.passes.length === all.length;
    $("hill-align-status").textContent = valid
      ? `GPS geometry check passed · mapped coverage ${Math.round((mapped.mapped[0].s / result.length) * 100)}–${Math.round((mapped.mapped.at(-1).s / result.length) * 100)}% · largest route offset ${mapped.maxOffset.toFixed(1)} m. This does not verify matching crests or elevation. Review the profiles and boundaries before confirming.`
      : "These ranges cannot all be mapped together continuously. Adjust this hill-only range, or leave an incompatible recording out. Check gaps, opposite directions and nearby roads.";
    $("hill-align-confirm").disabled = !valid;
  }
  for (const id of ["hill-align-start", "hill-align-end"])
    $(id).oninput = () => {
      onChange(
        value.id,
        +$("hill-align-start").value,
        +$("hill-align-end").value,
      );
      draw().catch((e) => {
        $("hill-align-status").textContent = e.message;
      });
    };
  $("hill-align-crest").onclick = () => {
    if (crestIndex == null || !value) return;
    $("hill-align-end").value = crestIndex;
    onChange(
      value.id,
      +$("hill-align-start").value,
      +$("hill-align-end").value,
    );
    draw().catch((e) => {
      $("hill-align-status").textContent = e.message;
    });
  };
  $("hill-align-confirm").onclick = () => {
    if (valid) {
      onConfirm(
        value.id,
        +$("hill-align-start").value,
        +$("hill-align-end").value,
      );
      host.hidden = true;
    }
  };
  let resizeFrame = 0;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (
        !host.hidden &&
        value &&
        host.clientWidth > 0 &&
        Math.abs(host.clientWidth - renderedWidth) > 1
      )
        draw().catch((e) => {
          $("hill-align-status").textContent = e.message;
        });
    });
  }).observe(host);
  return {
    async open(input) {
      value = input;
      host.hidden = false;
      $("hill-align-title").textContent =
        `Review ${input.hillName || "hill alignment"} · ${input.name}`;
      $("hill-align-status").textContent = "Loading recorded tracks…";
      ride = await getRide(input.rideId);
      if (value !== input) return;
      for (const [id, v] of [
        ["hill-align-start", input.start],
        ["hill-align-end", input.end],
      ]) {
        $(id).max = ride.points.length - 1;
        $(id).value = v;
      }
      await draw();
      host.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    close() {
      generation++;
      value = null;
      host.hidden = true;
    },
  };
}
