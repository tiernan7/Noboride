import { gradeProfile } from "/analysis.mjs";
import { detectClimbs, storyWindow, CLIMB_DEFAULTS } from "/ride-story.mjs";

export function createRideStory({
  state,
  loaded,
  task,
  esc,
  onRange,
  onChooseSection,
  definitions,
  members,
  entrySectionId,
  saveSection,
  deleteSection,
  onDraftChange,
  savedRanges,
  onSavedRange,
  color,
  highlight,
  updateMap,
}) {
  const $ = (id) => document.getElementById(id);
  let focused = "",
    rideId = "",
    context = 500,
    full = true,
    axis = "d",
    cursor = 0,
    current = null,
    nodes = [],
    grades = [],
    view = null,
    draftName = "",
    draftKind = "hill",
    manualDraft = null,
    options = { ...CLIMB_DEFAULTS };
  let W = 800,
    renderedWidth = 0;
  const LEFT = 64,
    RIGHT = 20,
    ROW = 60;
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
    const overviewCursor = $("story-overview").querySelector(
      "[data-overview-cursor]",
    );
    if (overviewCursor) {
      overviewCursor.setAttribute("x1", x(cursor));
      overviewCursor.setAttribute("x2", x(cursor));
      $("overview-value").textContent =
        `${height(p.ele)} · ${grades[cursor] == null ? "gradient unavailable" : `${grades[cursor].toFixed(1)}%`}`;
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
      rideId = "";
      clearSelection();
      highlight(null);
      return;
    }
    renderedWidth = $("story-charts").clientWidth;
    W = Math.max(280, Math.round(renderedWidth || 800));
    if (rideId !== current.id) {
      rideId = current.id;
      focused = "";
      draftName = "";
      manualDraft = null;
      $("climb-status").textContent = "";
      $("climb-error").textContent = "";
      cursor = state.start;
    }
    const scopedDefinitions = definitions(current);
    nodes = detectClimbs(current.points, scopedDefinitions, options);
    grades = gradeProfile(
      current.points,
      state.settings.gradeWindow,
      state.settings.gapSeconds,
    );
    view = storyWindow(current.points, state.start, state.end, context, full);
    $("story-ride-name").textContent = current.name;
    $("story-context").value = context;
    $("story-context").disabled = full;
    $("story-full").checked = full;
    $("story-axis").value = axis;
    const metrics = channels().filter((channel) => channel.key !== "ele"),
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
        if (channel.key === "grade") {
          min = Math.min(0, min);
          max = Math.max(0, max);
        }
        const y = (v) => row * ROW + 51 - ((v - min) / (max - min)) * 29;
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
        return `<g data-story-lane="${channel.key}"><rect data-brush x="${x(state.start)}" y="${row * ROW + 20}" width="${Math.max(1, x(state.end) - x(state.start))}" height="34" fill="#edf5ff"/><text x="${LEFT}" y="${row * ROW + 13}">${channel.name}</text><text data-story-value="${channel.key}" x="${W - RIGHT}" y="${row * ROW + 13}" text-anchor="end"></text><text x="${LEFT - 8}" y="${row * ROW + 30}" text-anchor="end">${max.toFixed(0)}</text><text x="${LEFT - 8}" y="${row * ROW + 52}" text-anchor="end">${min.toFixed(0)}</text>${channel.key === "grade" ? `<line data-grade-zero x1="${LEFT}" x2="${W - RIGHT}" y1="${y(0)}" y2="${y(0)}" stroke="#7c8c9e" stroke-opacity="0.35" stroke-dasharray="3 4"/>` : ""}<path d="${d}" fill="none" stroke="${{ grade: "#bb8242", speed: "#287bd5", hr: "#ca5864", cad: "#8064b8", power: "#159982" }[channel.key]}" stroke-width="1.7"/>${!values.length ? `<text x="${W / 2}" y="${row * ROW + 48}">Not recorded</text>` : ""}</g>`;
      })
      .join("");
    const axisLabel = (i) =>
      axis === "d"
        ? distance(current.points[i].d - current.points[0].d)
        : clock(current.points[i].t - current.points[0].t);
    renderOverview(first, last, axisLabel);
    $("story-charts").innerHTML =
      `<svg class="story-traces" viewBox="0 0 ${W} ${metrics.length * ROW + 23}" role="img" aria-label="Linked elevation, gradient and sensor traces. Drag to select a range; Hover, tap or use arrow keys to inspect.">${paths}${[state.start, state.end].map((i, j) => `<line data-boundary="${j ? "end" : "start"}" x1="${x(i)}" x2="${x(i)}" y1="18" y2="${metrics.length * ROW}" stroke="${j ? "#d2764b" : "#287bd5"}" stroke-dasharray="4 3"/>`).join("")}<line data-story-cursor y1="0" y2="${metrics.length * ROW}" stroke="#20334a" stroke-dasharray="3 3"/>${[first, Math.round((first + last) / 2), last].map((i) => `<text x="${x(i)}" y="${metrics.length * ROW + 15}" text-anchor="middle">${axisLabel(i)}</text>`).join("")}</svg>`;
    const allSaved = savedRanges();
    const saved = allSaved.filter(
      (entry) => entry.end >= first && entry.start <= last,
    );
    if (saved.length) {
      const position = (point) =>
        Math.max(
          LEFT,
          Math.min(
            W - RIGHT,
            LEFT +
              ((point[axis] - current.points[first][axis]) /
                Math.max(
                  1,
                  current.points[last][axis] - current.points[first][axis],
                )) *
                (W - LEFT - RIGHT),
          ),
        );
      $("story-charts").insertAdjacentHTML(
        "beforeend",
        `<div class="saved-range-profile" aria-label="Comparison stretches along this ride"><svg viewBox="0 0 ${W} ${saved.length * 24}" role="group" aria-label="Select a comparison stretch to edit">${saved.map((entry, i) => `<g data-saved-range="${esc(entry.id)}" role="button" tabindex="0" aria-label="Edit comparison stretch ${entry.number}"><text x="${LEFT - 8}" y="${i * 24 + 16}" text-anchor="end">${entry.number}</text><line x1="${LEFT}" x2="${W - RIGHT}" y1="${i * 24 + 12}" y2="${i * 24 + 12}" stroke="#e3e9ef"/><rect x="${position(entry.points[0])}" y="${i * 24 + 5}" width="${Math.max(2, position(entry.points.at(-1)) - position(entry.points[0]))}" height="14" rx="4" fill="${color(entry.rideId)}" opacity="${entry.editing ? 1 : 0.65}"/></g>`).join("")}</svg></div>`,
      );
    }
    const svg = $("story-charts").querySelector("svg");
    const locate = (clientX, element = svg) => {
      const box = element.getBoundingClientRect(),
        fraction = Math.max(
          0,
          Math.min(
            1,
            (((clientX - box.left) / box.width) * W - LEFT) /
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
      return lo;
    };
    svg.setAttribute("tabindex", "0");
    svg.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      moveCursor(
        event.key === "Home"
          ? first
          : event.key === "End"
            ? last
            : cursor + (event.key === "ArrowLeft" ? -1 : 1),
      );
    };
    const overview = $("story-overview").querySelector("svg");
    overview.onpointermove = (event) =>
      moveCursor(locate(event.clientX, overview));
    let drag = null;
    svg.onpointerdown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      drag = {
        pointerId: event.pointerId,
        start: locate(event.clientX),
        x: event.clientX,
      };
      svg.setPointerCapture(event.pointerId);
      moveCursor(drag.start);
    };
    svg.onpointermove = (event) => {
      const index = locate(event.clientX);
      moveCursor(index);
      if (
        !drag ||
        drag.pointerId !== event.pointerId ||
        Math.abs(event.clientX - drag.x) < 4
      )
        return;
      for (const rect of svg.querySelectorAll("[data-brush]")) {
        rect.setAttribute("x", Math.min(x(index), x(drag.start)));
        rect.setAttribute(
          "width",
          Math.max(1, Math.abs(x(index) - x(drag.start))),
        );
      }
    };
    svg.onpointerup = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const start = drag.start,
        index = locate(event.clientX),
        moved = Math.abs(event.clientX - drag.x) >= 4;
      drag = null;
      svg.releasePointerCapture(event.pointerId);
      if (moved && start !== index)
        onRange(Math.min(start, index), Math.max(start, index));
      else render();
    };
    svg.onpointercancel = () => {
      drag = null;
      render();
    };
    $("story-cursor").min = first;
    $("story-cursor").max = last;
    updateMap(current, view, state.start, state.end);
    moveCursor(cursor < first || cursor > last ? state.start : cursor);
    const membership = new Map(
      nodes.map((node) => [node.id, members({ ...node, rideId: current.id })]),
    );
    const children = (parent = "") =>
      nodes
        .filter((node) => node.parentId === parent)
        .map(
          (node) =>
            `<li><button class="climb-node" data-climb="${esc(node.id)}" aria-pressed="${focused === node.id}"><strong>${esc(node.name)}</strong><small>${distance(node.length)} · net gain ${height(node.netGain)} · ${node.avgGrade == null ? "—" : node.avgGrade.toFixed(1)}% average · ${clock(node.startTime - current.points[0].t)} into ride · ${membership.get(node.id).length ? "Included" : scopedDefinitions.some((section) => section.id === node.id) ? "Saved in this comparison" : "Suggested"}</small></button>${membership
              .get(node.id)
              .map(
                (entry) =>
                  `<button class="button small section-version" data-source-entry="${esc(entry.id)}" aria-pressed="${allSaved.some((range) => range.id === entry.id && range.editing)}">Edit included stretch ${allSaved.find((range) => range.id === entry.id)?.number || ""}</button>`,
              )
              .join(
                "",
              )}${nodes.some((child) => child.parentId === node.id) ? `<ul>${children(node.id)}</ul>` : ""}</li>`,
        )
        .join("");
    $("climb-tree").innerHTML = nodes.length
      ? `<ul>${children()}</ul>`
      : "<p>No suggestions meet these terrain thresholds. Choose New section to define your own range.</p>";
    const selected = manualDraft || nodes.find((node) => node.id === focused);
    $("climb-editor").hidden = !selected;
    if (selected) {
      $("climb-editor-title").textContent = manualDraft
        ? "New section in this comparison"
        : "Edit section in this comparison";
      $("climb-kind-label").hidden = false;
      $("climb-kind").value = draftKind;
      $("climb-reset").hidden =
        !!selected.manual || selected.kind === "section";
      $("climb-delete").hidden = !!manualDraft;
      $("climb-cancel").hidden = !manualDraft;
      $("climb-name").value = draftName;
      $("climb-reset").disabled = !scopedDefinitions.some(
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
  function renderOverview(first, last, axisLabel) {
    const elevations = current.points
      .slice(first, last + 1)
      .map((p) => p.ele)
      .filter((v) => v != null);
    let min = elevations.reduce((a, b) => Math.min(a, b), Infinity),
      max = elevations.reduce((a, b) => Math.max(a, b), -Infinity);
    if (!elevations.length) {
      min = 0;
      max = 1;
    }
    const span = Math.max(1, max - min),
      low = min - span * 0.08,
      high = max + span * 0.04;
    const bottom = 105,
      top = 15,
      y = (v) => bottom - ((v - low) / (high - low)) * (bottom - top);
    const gradeColor = (g) =>
      g == null
        ? "#c4ccd5"
        : g >= 12
          ? "#a676b8"
          : g >= 9
            ? "#d86d64"
            : g >= 6
              ? "#e5a16c"
              : g >= 3
                ? "#d0c478"
                : "#a9c4b8";
    let areas = "";
    for (let i = first; i < last; i++) {
      const a = current.points[i],
        b = current.points[i + 1];
      if (
        a.ele == null ||
        b.ele == null ||
        b.breakBefore ||
        b.t - a.t > state.settings.gapSeconds * 1000
      )
        continue;
      areas += `<path data-grade-band="${grades[i] == null ? "unknown" : grades[i] >= 12 ? "12" : grades[i] >= 9 ? "9" : grades[i] >= 6 ? "6" : grades[i] >= 3 ? "3" : "gentle"}" d="M${x(i)},${bottom} L${x(i)},${y(a.ele)} L${x(i + 1)},${y(b.ele)} L${x(i + 1)},${bottom} Z" fill="${gradeColor(grades[i])}" opacity="${i >= state.start && i < state.end ? 1 : 0.45}"/>`;
    }
    $("story-overview").innerHTML =
      `<div class="overview-heading"><span>Elevation · gradient colours</span><span id="overview-value"></span></div><svg viewBox="0 0 ${W} 135" role="img" aria-label="Elevation filled by gradient over ${state.settings.gradeWindow} metres; follows the linked range and cursor">${[min, (min + max) / 2, max].map((v) => `<line x1="${LEFT}" x2="${W - RIGHT}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e9ef"/><text x="${LEFT - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * (imperial() ? 3.28084 : 1))}</text>`).join("")}<rect data-brush x="${x(state.start)}" y="${top}" width="${Math.max(1, x(state.end) - x(state.start))}" height="${bottom - top}" fill="#edf5ff"/>${areas}${[state.start, state.end].map((i, j) => `<line data-overview-boundary="${j ? "end" : "start"}" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${bottom}" stroke="${j ? "#d2764b" : "#287bd5"}" stroke-dasharray="4 3"/>`).join("")}<line data-overview-cursor y1="${top}" y2="${bottom}" stroke="#20334a" stroke-dasharray="3 3"/>${[first, Math.round((first + last) / 2), last].map((i) => `<text x="${x(i)}" y="126" text-anchor="middle">${axisLabel(i)}</text>`).join("")}${!elevations.length ? `<text x="${W / 2}" y="65" text-anchor="middle">Elevation not recorded</text>` : ""}</svg><div class="overview-legend"><span><i style="background:#a9c4b8"></i>&lt;3% / descent</span><span><i style="background:#d0c478"></i>3–6%</span><span><i style="background:#e5a16c"></i>6–9%</span><span><i style="background:#d86d64"></i>9–12%</span><span><i style="background:#a676b8"></i>≥12%</span><span><i style="background:#c4ccd5"></i>Unknown</span><span>${imperial() ? "ft" : "m"} · ${state.settings.gradeWindow} m grade window</span></div>`;
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
  const openSavedRange = (event) => {
    const target = event.target.closest("[data-saved-range]");
    if (!target) return;
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    task("Opening saved comparison stretch…", () =>
      onSavedRange(target.dataset.savedRange),
    );
  };
  $("story-charts").onclick = openSavedRange;
  $("story-charts").onkeydown = openSavedRange;
  $("climb-tree").onclick = (event) => {
    const button = event.target.closest("[data-climb]");
    const node =
      button && nodes.find((item) => item.id === button.dataset.climb);
    if (node) {
      manualDraft = null;
      focused = node.id;
      draftName = node.name;
      draftKind = node.kind;
      onChooseSection({ ...node, rideId: current.id });
      $("climb-error").textContent = "";
      $("climb-status").textContent = "";
      cursor = node.start;
      const included = members({ ...node, rideId: current.id });
      onRange(
        Math.floor(included.length === 1 ? included[0].start : node.start),
        Math.ceil(included.length === 1 ? included[0].end : node.end),
      );
    }
  };
  $("climb-new").onclick = () => {
    if (!current) return;
    onChooseSection(null);
    manualDraft = {
      id: `manual-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) => v.toString(16).padStart(2, "0")).join("")}`,
      kind: "section",
      manual: true,
    };
    focused = "";
    draftName = "New section";
    draftKind = "section";
    $("climb-error").textContent = "";
    $("climb-status").textContent = "";
    onRange(state.start, state.end);
    $("climb-name").focus({ preventScroll: true });
    $("climb-name").select();
  };
  $("climb-cancel").onclick = () => {
    manualDraft = null;
    draftName = "";
    $("climb-error").textContent = "";
    onDraftChange();
    render();
  };
  $("climb-kind").onchange = (event) => {
    draftKind = event.target.value;
    if (manualDraft) manualDraft.kind = event.target.value;
    onDraftChange();
  };
  $("climb-name").oninput = (event) => {
    draftName = event.target.value;
    onDraftChange();
  };
  function selectedSection() {
    const node = manualDraft || nodes.find((item) => item.id === focused);
    if (!node || !current || current.id !== state.referenceId) return null;
    const untouched =
      state.start === Math.floor(node.start) &&
      state.end === Math.ceil(node.end);
    return {
      id: node.id,
      rideId: current.id,
      kind: draftKind,
      name: draftName.trim(),
      start: untouched ? node.start : state.start,
      end: untouched ? node.end : state.end,
      ...(node.manual ? { manual: true } : {}),
      isNew: !!manualDraft,
    };
  }
  $("climb-delete").onclick = () =>
    task("Removing comparison section…", async () => {
      try {
        const section = selectedSection();
        if (section) await deleteSection(section);
      } catch (error) {
        $("climb-error").textContent = error.message;
        throw error;
      }
    });
  $("climb-reset").onclick = () =>
    task("Restoring suggestion…", async () => {
      const original = detectClimbs(current.points, [], options).find(
        (node) => node.id === focused,
      );
      if (original) await saveSection({ ...original, rideId: current.id });
    });
  for (const [id, key] of [
    ["passage-dip", "passageDip"],
    ["passage-gap", "passageGap"],
  ])
    $(id).onchange = (event) => {
      options[key] = +event.target.value;
      render();
    };
  let resizeFrame = 0;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const width = $("story-charts").clientWidth;
      if (current && width > 0 && Math.abs(width - renderedWidth) > 1) render();
    });
  }).observe($("story-charts"));
  function clearSelection() {
    focused = "";
    manualDraft = null;
    draftName = "";
    $("climb-error").textContent = "";
    $("climb-status").textContent = "";
  }
  function acceptSaved(section) {
    focused = section.id;
    manualDraft = null;
    draftName = section.name;
    draftKind = section.kind;
    state.start = Math.floor(section.start);
    state.end = Math.ceil(section.end);
    $("climb-status").textContent = "Saved in this comparison.";
  }
  function openRange(entry) {
    clearSelection();
    if (!entry) return;
    current = loaded.get(entry.rideId);
    if (!current) return;
    rideId = current.id;
    nodes = detectClimbs(current.points, definitions(current), options);
    const id = entrySectionId(entry),
      node = nodes.find((item) => item.id === id);
    if (node) {
      focused = node.id;
      draftName = node.name;
      draftKind = node.kind;
    }
  }
  return { render, clearSelection, selectedSection, acceptSaved, openRange };
}
