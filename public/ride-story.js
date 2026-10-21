import { gradeProfile } from "/analysis.mjs";
import { detectClimbs, storyWindow, CLIMB_DEFAULTS } from "/ride-story.mjs";

export function createRideStory({
  state,
  loaded,
  api,
  json,
  task,
  esc,
  onRange,
  highlight,
  updateMap,
}) {
  const $ = (id) => document.getElementById(id);
  let focused = "",
    rideId = "",
    context = 500,
    full = false,
    axis = "d",
    cursor = 0,
    current = null,
    nodes = [],
    grades = [],
    view = null,
    draftName = "",
    options = { ...CLIMB_DEFAULTS };
  let W = 800,
    renderedWidth = 0;
  const LEFT = 64,
    RIGHT = 20,
    ROW = 72;
  const imperial = () => state.settings.units === "imperial";
  const distance = (meters) =>
    `${(meters / (imperial() ? 1609.344 : 1000)).toFixed(2)} ${imperial() ? "mi" : "km"}`;
  const height = (meters) =>
    meters == null
      ? "—"
      : `${Math.round(meters * (imperial() ? 3.28084 : 1))} ${imperial() ? "ft" : "m"}`;
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const channels = () => [
    {
      key: "ele",
      name: "Elevation",
      unit: imperial() ? "ft" : "m",
      convert: (v) => v * (imperial() ? 3.28084 : 1),
    },
    { key: "grade", name: "Gradient", unit: "%", convert: (v) => v },
    {
      key: "speed",
      name: "Speed",
      unit: imperial() ? "mph" : "km/h",
      convert: (v) => v * (imperial() ? 2.236936 : 3.6),
    },
    { key: "hr", name: "Heart rate", unit: "bpm", convert: (v) => v },
    ...[
      ["cad", "Cadence", "rpm"],
      ["power", "Measured power", "W"],
    ]
      .filter(([key]) => current.points.some((p) => p[key] != null))
      .map(([key, name, unit]) => ({ key, name, unit, convert: (v) => v })),
  ];
  const value = (key, i) =>
    key === "grade" ? grades[i] : current.points[i][key];
  const x = (i) =>
    LEFT +
    ((current.points[i][axis] - current.points[view.start][axis]) /
      Math.max(
        1,
        current.points[view.end][axis] - current.points[view.start][axis],
      )) *
      (W - LEFT - RIGHT);
  function moveCursor(index) {
    if (!current || !view) return;
    cursor = Math.max(view.start, Math.min(view.end, index));
    const p = current.points[cursor];
    $("story-cursor").value = cursor;
    const line = $("story-charts").querySelector("[data-story-cursor]");
    if (line) {
      line.setAttribute("x1", x(cursor));
      line.setAttribute("x2", x(cursor));
    }
    for (const channel of channels()) {
      const output = $("story-charts").querySelector(
          `[data-story-value="${channel.key}"]`,
        ),
        v = value(channel.key, cursor);
      if (output)
        output.textContent =
          v == null
            ? "Not recorded"
            : `${channel.convert(v).toFixed(channel.key === "hr" || channel.key === "cad" || channel.key === "power" ? 0 : 1)} ${channel.unit}`;
    }
    $("story-position").textContent =
      `${clock(p.t - current.points[0].t)} into ride · ${distance(p.d - current.points[0].d)} · recorded sample ${cursor + 1}${p.timer === false ? " · device timer paused" : ""}`;
    highlight(p);
  }
  function render() {
    current = loaded.get(state.referenceId);
    $("ride-story").hidden = !current;
    if (!current) {
      highlight(null);
      return;
    }
    renderedWidth = $("story-charts").clientWidth;
    W = Math.max(280, Math.round(renderedWidth || 800));
    if (rideId !== current.id) {
      rideId = current.id;
      focused = "";
      draftName = "";
      cursor = state.start;
    }
    nodes = detectClimbs(current.points, current.climbEdits || [], options);
    grades = gradeProfile(
      current.points,
      state.settings.gradeWindow,
      state.settings.gapSeconds,
    );
    view = storyWindow(current.points, state.start, state.end, context, full);
    $("story-ride-name").textContent = current.name;
    $("story-context").value = context;
    $("story-full").checked = full;
    $("story-axis").value = axis;
    const metrics = channels(),
      last = view.end,
      first = view.start;
    const paths = metrics
      .map((channel, row) => {
        const values = [];
        for (let i = first; i <= last; i++) {
          const v = value(channel.key, i);
          if (v != null) values.push(channel.convert(v));
        }
        let min = values.length
            ? values.reduce((a, b) => Math.min(a, b), Infinity)
            : 0,
          max = values.length
            ? values.reduce((a, b) => Math.max(a, b), -Infinity)
            : 1;
        const span = Math.max(
          max - min,
          channel.convert(
            { ele: 1, grade: 1, speed: 0.5, hr: 5, cad: 5, power: 10 }[
              channel.key
            ],
          ),
        );
        const center = (max + min) / 2;
        min = center - span / 2;
        max = center + span / 2;
        if (["speed", "hr", "cad", "power"].includes(channel.key) && min < 0) {
          max -= min;
          min = 0;
        }
        const y = (v) => row * ROW + 61 - ((v - min) / (max - min)) * 35;
        let d = "",
          connected = false;
        for (let i = first; i <= last; i++) {
          const p = current.points[i],
            v = value(channel.key, i);
          if (
            v == null ||
            p.breakBefore ||
            (i > first &&
              p.t - current.points[i - 1].t > state.settings.gapSeconds * 1000)
          )
            connected = false;
          if (v == null) continue;
          d += `${connected ? "L" : "M"}${x(i).toFixed(2)},${y(channel.convert(v)).toFixed(2)}`;
          connected = true;
        }
        return `<g data-story-lane="${channel.key}"><rect x="${x(state.start)}" y="${row * ROW + 20}" width="${Math.max(1, x(state.end) - x(state.start))}" height="45" fill="#edf5ff"/><text x="${LEFT}" y="${row * ROW + 13}">${channel.name}</text><text data-story-value="${channel.key}" x="${W - RIGHT}" y="${row * ROW + 13}" text-anchor="end"></text><text x="${LEFT - 8}" y="${row * ROW + 30}" text-anchor="end">${max.toFixed(0)}</text><text x="${LEFT - 8}" y="${row * ROW + 62}" text-anchor="end">${min.toFixed(0)}</text><path d="${d}" fill="none" stroke="${["#617a51", "#bb8242", "#287bd5", "#ca5864", "#8064b8", "#159982"][row]}" stroke-width="1.7"/>${!values.length ? `<text x="${W / 2}" y="${row * ROW + 48}">Not recorded</text>` : ""}</g>`;
      })
      .join("");
    const axisLabel = (i) =>
      axis === "d"
        ? distance(current.points[i].d - current.points[0].d)
        : clock(current.points[i].t - current.points[0].t);
    $("story-charts").innerHTML =
      `<svg viewBox="0 0 ${W} ${metrics.length * ROW + 23}" role="img" aria-label="Linked elevation, gradient and sensor traces. Hover or use the cursor slider.">${paths}<line data-story-cursor y1="0" y2="${metrics.length * ROW}" stroke="#20334a" stroke-dasharray="3 3"/>${[first, Math.round((first + last) / 2), last].map((i) => `<text x="${x(i)}" y="${metrics.length * ROW + 15}" text-anchor="middle">${axisLabel(i)}</text>`).join("")}</svg>`;
    const svg = $("story-charts").querySelector("svg");
    const hover = (event) => {
      const box = svg.getBoundingClientRect(),
        fraction = Math.max(
          0,
          Math.min(
            1,
            (((event.clientX - box.left) / box.width) * W - LEFT) /
              (W - LEFT - RIGHT),
          ),
        );
      const target =
        current.points[first][axis] +
        fraction * (current.points[last][axis] - current.points[first][axis]);
      let lo = first,
        hi = last;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (current.points[mid][axis] < target) lo = mid + 1;
        else hi = mid;
      }
      moveCursor(lo);
    };
    svg.onpointermove = hover;
    svg.onpointerdown = hover;
    $("story-cursor").min = first;
    $("story-cursor").max = last;
    updateMap(current, view, state.start, state.end);
    moveCursor(cursor < first || cursor > last ? state.start : cursor);
    const children = (parent = "") =>
      nodes
        .filter((node) => node.parentId === parent)
        .map(
          (node) =>
            `<li><button class="climb-node" data-climb="${esc(node.id)}" aria-pressed="${focused === node.id}"><strong>${esc(node.name)}${node.corrected ? " · corrected" : ""}</strong><small>${distance(node.length)} · net gain ${height(node.netGain)} · ${node.avgGrade == null ? "—" : node.avgGrade.toFixed(1)}% average · ${clock(current.points[node.start].t - current.points[0].t)} into ride</small></button>${nodes.some((child) => child.parentId === node.id) ? `<ul>${children(node.id)}</ul>` : ""}</li>`,
        )
        .join("");
    $("climb-tree").innerHTML = nodes.length
      ? `<ul>${children()}</ul>`
      : "<p>No climbing passages meet these terrain thresholds. You can still select any range in the source editor.</p>";
    const selected = nodes.find((node) => node.id === focused);
    $("climb-editor").hidden = !selected;
    if (selected) {
      $("climb-name").value = draftName || selected.name;
      $("climb-start").max = current.points.length - 2;
      $("climb-end").max = current.points.length - 1;
      $("climb-start").value = state.start;
      $("climb-end").value = state.end;
      $("climb-boundaries").textContent =
        `${distance(current.points[state.start].d - current.points[0].d)}–${distance(current.points[state.end].d - current.points[0].d)} · ${clock(current.points[state.start].t - current.points[0].t)}–${clock(current.points[state.end].t - current.points[0].t)}`;
      $("climb-reset").disabled = !(current.climbEdits || []).some(
        (edit) => edit.id === selected.id,
      );
    }
    const before = current.points[state.start].d - current.points[first].d,
      after = current.points[last].d - current.points[state.end].d;
    let recentGain = 0,
      interruptions = 0;
    const recentStart = Math.max(first, 1);
    for (let i = recentStart; i <= state.start; i++) {
      const a = current.points[i - 1],
        b = current.points[i];
      if (b.breakBefore || b.t - a.t > state.settings.gapSeconds * 1000) {
        interruptions++;
        continue;
      }
      if (a.ele != null && b.ele != null)
        recentGain += Math.max(0, b.ele - a.ele);
    }
    $("story-surroundings").textContent =
      `Approach shown: ${distance(before)} with ${height(recentGain)} of recorded positive elevation changes. Aftermath shown: ${distance(after)}. ${interruptions} recording interruptions in the approach. Elevation noise affects accumulated gain; gaps stay visible. Gradient uses the selected physical window. Imported speed may be derived from distance/time; missing HR, cadence or power is never filled. Missing optional sensor lanes are omitted.`;
  }
  $("story-context").onchange = (event) => {
    context = +event.target.value;
    render();
  };
  $("story-full").onchange = (event) => {
    full = event.target.checked;
    render();
  };
  $("story-axis").onchange = (event) => {
    axis = event.target.value;
    render();
  };
  $("story-cursor").oninput = (event) => moveCursor(+event.target.value);
  $("climb-tree").onclick = (event) => {
    const button = event.target.closest("[data-climb]");
    const node =
      button && nodes.find((item) => item.id === button.dataset.climb);
    if (node) {
      focused = node.id;
      draftName = node.name;
      full = false;
      cursor = node.start;
      onRange(node.start, node.end);
    }
  };
  $("climb-name").oninput = (event) => {
    draftName = event.target.value;
  };
  $("climb-start").onchange = (event) =>
    onRange(Math.min(+event.target.value, state.end - 1), state.end);
  $("climb-end").onchange = (event) =>
    onRange(state.start, Math.max(+event.target.value, state.start + 1));
  const saveEdits = async (edits) => {
    await api(`/api/rides/${current.id}`, json("PATCH", { climbEdits: edits }));
    current.climbEdits = edits;
    const meta = state.rides.find((ride) => ride.id === current.id);
    if (meta) meta.climbEdits = edits;
    $("climb-status").textContent =
      "Climb boundaries saved locally. Comparison stretches are unchanged until you explicitly add or update them.";
  };
  $("climb-save").onclick = () =>
    task("Saving climb correction…", async () => {
      const node = nodes.find((item) => item.id === focused);
      if (!node) return;
      await saveEdits([
        ...(current.climbEdits || []).filter((edit) => edit.id !== node.id),
        {
          id: node.id,
          kind: node.kind,
          name: $("climb-name").value.trim(),
          start: state.start,
          end: state.end,
        },
      ]);
      render();
    });
  $("climb-reset").onclick = () =>
    task("Restoring detected boundaries…", async () => {
      const id = focused;
      await saveEdits(
        (current.climbEdits || []).filter((edit) => edit.id !== id),
      );
      const original = detectClimbs(
        current.points,
        current.climbEdits,
        options,
      ).find((node) => node.id === id);
      draftName = "";
      if (original) onRange(original.start, original.end);
      else {
        focused = "";
        render();
      }
    });
  for (const [id, key] of [
    ["passage-dip", "passageDip"],
    ["passage-gap", "passageGap"],
  ])
    $(id).onchange = (event) => {
      options[key] = +event.target.value;
      render();
    };
  new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width || 0;
    if (current && width > 0 && Math.abs(width - renderedWidth) > 1) render();
  }).observe($("story-charts"));
  return { render };
}
