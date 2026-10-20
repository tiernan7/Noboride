import {
  comparisonNameKey,
  stretchPoints,
  coversSuggestedPass,
} from "/comparisons.mjs";
import { findMatches } from "/analysis.mjs";

// HTTP over the local network lacks randomUUID on some mobile browsers.
const newId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");

export function createComparisonWorkspace({
  state,
  loaded,
  getRide,
  api,
  json,
  render,
  task,
  esc,
  rideName,
  persistSelection,
}) {
  const $ = (id) => document.getElementById(id);
  let collection = { activeId: "", items: [] },
    pendingAction = null,
    deletionTarget = null,
    writes = Promise.resolve(),
    timer,
    editing = null,
    entryFeedback = "";
  const active = () =>
    collection.items.find((c) => c.id === collection.activeId);
  const fresh = () => ({
    id: newId(),
    name: "",
    entries: [],
    road: null,
    selected: [...state.selected],
    browse: null,
    drafts: [],
    baseline: "",
    comparison: "",
    metric: "ele",
    settings: { ...state.settings },
  });
  const editorRange = () =>
    state.referenceId && loaded.has(state.referenceId)
      ? { rideId: state.referenceId, start: state.start, end: state.end }
      : null;
  function rememberDraft() {
    const c = active(),
      draft = editorRange();
    if (!c || !draft || editing) return;
    c.drafts = (c.drafts || [])
      .filter((d) => d.rideId !== draft.rideId)
      .concat(draft);
  }
  function snapshot() {
    const c = active();
    if (!c) return;
    rememberDraft();
    Object.assign(c, {
      selected: [...state.selected],
      baseline: state.baseline,
      comparison: state.comparison,
      metric: state.metric,
      settings: { ...state.settings },
      browse:
        state.referenceId && loaded.has(state.referenceId)
          ? {
              rideId: state.referenceId,
              start: state.start,
              end: state.end,
            }
          : null,
    });
  }
  async function save() {
    clearTimeout(timer);
    snapshot();
    const body = json("PUT", collection);
    writes = writes.catch(() => {}).then(() => api("/api/comparisons", body));
    try {
      await writes;
      $("comparison-status").textContent = "Saved locally.";
      if (entryFeedback) {
        $("stretch-status").classList.remove("error");
        $("stretch-status").textContent = entryFeedback;
        entryFeedback = "";
      }
    } catch (e) {
      $("comparison-status").textContent = `Not saved: ${e.message}`;
      $("stretch-status").textContent = `Not saved: ${e.message}`;
      $("stretch-status").classList.add("error");
      throw e;
    }
  }
  function soon() {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        save().catch((e) => {
          $("comparison-status").textContent = `Not saved: ${e.message}`;
        }),
      250,
    );
  }
  async function activate(id) {
    deletionTarget = null;
    pendingAction = null;
    $("comparison-delete-confirm").hidden = true;
    $("comparison-name-editor").hidden = true;
    editing = null;
    entryFeedback = "";
    collection.activeId = id;
    const c = active();
    const available = new Set(state.rides.map((r) => r.id));
    state.selected = c.selected.filter((id) => available.has(id));
    await Promise.all(
      [
        ...new Set([
          ...state.selected,
          ...c.entries.map((e) => e.rideId),
          ...(c.road ? [c.road.rideId] : []),
        ]),
      ]
        .filter((id) => available.has(id))
        .map(getRide),
    );
    state.referenceId = c.browse?.rideId || "";
    state.start = c.browse?.start || 0;
    state.end = c.browse?.end ?? 1;
    state.baseline = c.baseline;
    state.comparison = c.comparison;
    state.metric = c.metric;
    state.settings = { ...c.settings };
    persistSelection();
    $("stretch-status").textContent = "";
    render();
  }
  async function load(value, initial) {
    if (initial || !active()) {
      collection = value?.items?.length ? value : { activeId: "", items: [] };
      if (!collection.items.length) {
        const c = fresh();
        collection.items.push(c);
        collection.activeId = c.id;
      }
      await activate(collection.activeId);
    }
  }
  function roadPoints() {
    const road = active()?.road,
      ride = road && loaded.get(road.rideId);
    return ride ? stretchPoints(ride.points, road.start, road.end) : null;
  }
  function matches() {
    const c = active(),
      canonical = roadPoints();
    if (!c) return [];
    const counts = new Map();
    return c.entries.flatMap((entry) => {
      const ride = loaded.get(entry.rideId);
      if (!ride) return [];
      const pass = (counts.get(entry.rideId) || 0) + 1;
      counts.set(entry.rideId, pass);
      let match;
      if (entry.kind === "matched") {
        match =
          canonical &&
          findMatches(ride, canonical, state.settings.matchRadius).find(
            (m) =>
              Math.abs(m.startIndex - entry.start) < 0.02 &&
              Math.abs(m.endIndex - entry.end) < 0.02,
          );
        if (!match) return [];
      } else
        match = {
          points: stretchPoints(ride.points, entry.start, entry.end),
          startIndex: entry.start,
          endIndex: entry.end,
          startMiss: 0,
          endMiss: 0,
          routeError: 0,
        };
      return [
        {
          ...match,
          id: entry.id,
          rideId: entry.rideId,
          pass: match.pass || pass,
          manual: entry.kind === "effort",
          kind: entry.kind,
        },
      ];
    });
  }
  function suggestions() {
    const points = roadPoints(),
      c = active();
    if (!points || !c?.entries.length) return [];
    return state.selected.flatMap((id) => {
      const ride = loaded.get(id);
      return ride
        ? findMatches(ride, points, state.settings.matchRadius).filter(
            (m) =>
              !c.entries.some(
                (e) =>
                  e.rideId === id &&
                  coversSuggestedPass(
                    e,
                    m,
                    ride.points,
                    state.settings.suggestionOverlap,
                  ),
              ),
          )
        : [];
    });
  }
  function rangeLabel(entry) {
    const ride = loaded.get(entry.rideId);
    if (!ride) return "Source unavailable";
    const points = stretchPoints(ride.points, entry.start, entry.end);
    const time = (p) => {
      const seconds = Math.round((p.t - ride.points[0].t) / 1000);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    };
    const imperial = state.settings.units === "imperial";
    return `${new Date(ride.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${time(points[0])}–${time(points.at(-1))} into ride · ${((points.at(-1).d - points[0].d) / (imperial ? 1609.344 : 1000)).toFixed(2)} ${imperial ? "mi" : "km"}`;
  }
  function sourceStretches() {
    return (active()?.entries || []).flatMap((entry, index) => {
      const ride = loaded.get(entry.rideId);
      return ride && entry.rideId === state.referenceId
        ? [
            {
              ...entry,
              number: index + 1,
              points: stretchPoints(ride.points, entry.start, entry.end),
              editing: editing?.id === entry.id,
            },
          ]
        : [];
    });
  }
  function renderWorkspace() {
    const c = active();
    if (!c) return;
    $("comparison-name").textContent = c.name || "Untitled comparison";
    $("comparison-switch").innerHTML = collection.items
      .map(
        (x) =>
          `<option value="${esc(x.id)}">${esc(x.name || "Untitled comparison")}</option>`,
      )
      .join("");
    $("comparison-switch").value = c.id;
    $("new-comparison").disabled = !c.entries.length;
    $("delete-comparison").disabled =
      collection.items.length === 1 && !c.entries.length && !c.name;
    $("comparison-count").textContent =
      `${c.entries.length} stretch${c.entries.length === 1 ? "" : "es"} · ${new Set(c.entries.map((e) => e.rideId)).size} rides`;
    if (
      editing &&
      state.referenceId !== c.entries.find((e) => e.id === editing.id)?.rideId
    )
      editing = null;
    const dirty =
      editing && (state.start !== editing.start || state.end !== editing.end);
    const saved = sourceStretches();
    $("source-stretches").innerHTML = state.referenceId
      ? `<p>${saved.length ? `${saved.length} saved stretch${saved.length === 1 ? "" : "es"} from this ride in this comparison. Select one to inspect or edit.` : "No stretches from this ride in this comparison yet."}</p><div>${saved.map((entry) => `<button class="button small" data-source-entry="${esc(entry.id)}" aria-pressed="${entry.editing}"><strong>Stretch ${entry.number}</strong><small>${esc(rangeLabel(entry))}</small></button>`).join("")}${saved.length ? '<button class="button small" id="another-stretch">Select another stretch</button>' : ""}</div>`
      : "";
    const duplicate = c.entries.some(
      (e) =>
        e.rideId === state.referenceId &&
        Math.abs(e.start - state.start) < 0.02 &&
        Math.abs(e.end - state.end) < 0.02,
    );
    $("add-stretch").disabled =
      !state.referenceId || (editing ? !dirty : duplicate);
    $("add-stretch").textContent = editing
      ? "Update stretch"
      : duplicate
        ? "Already in comparison"
        : "Add to comparison";
    $("cancel-stretch-edit").hidden = !editing;
    $("cancel-stretch-edit").textContent = dirty ? "Cancel changes" : "Done";
    $("reset-selection").disabled = !state.referenceId;
    $("selection-summary").textContent = state.referenceId
      ? rangeLabel({
          rideId: state.referenceId,
          start: state.start,
          end: state.end,
        })
      : "Choose a source ride to select a stretch.";
    $("selection-context").textContent = editing
      ? `Editing stretch ${c.entries.findIndex((e) => e.id === editing.id) + 1} in “${c.name || "Untitled comparison"}”. Changes apply only when you update.`
      : duplicate
        ? `Already saved in “${c.name || "Untitled comparison"}”. Use Edit in the stretch list to change it.`
        : `Preview only. Add this stretch to “${c.name || "Untitled comparison"}” to include it.`;
    $("comparison-entries").innerHTML = c.entries.length
      ? c.entries
          .map(
            (e, index) =>
              `<li class="${editing?.id === e.id ? "editing-stretch" : ""}"><div><strong>${index + 1}. ${esc(rideName(e.rideId))}</strong><small>${esc(rangeLabel(e))} · ${e.kind === "matched" ? "GPS matched" : e.kind === "source" ? "Selected road" : "Manually paired effort"}${state.matches.some((m) => m.id === e.id) ? "" : " · unavailable under current matching settings"}</small></div><button class="text-button" data-entry-edit="${esc(e.id)}">Edit</button><button class="text-button danger" data-entry-remove="${esc(e.id)}">Remove</button></li>`,
          )
          .join("")
      : '<li class="comparison-empty">Choose a ride tab, select a stretch, then add it here. Suggestions appear after the first stretch.</li>';
    const suggested = suggestions();
    $("suggestions").innerHTML = suggested.length
      ? `<h3>Suggested matching stretches</h3><p>Review the endpoints before adding. Suggestions are not part of the comparison yet.</p>${suggested.map((m, i) => `<div class="suggestion"><span>${esc(rideName(m.rideId))} · pass ${m.pass}<small>GPS offsets ${m.startMiss.toFixed(0)} / ${m.endMiss.toFixed(0)} m · route offset ${m.routeError.toFixed(0)} m${m.gpsBridgeSeconds ? ` · GPS bridge ${m.gpsBridgeSeconds}s` : ""}</small></span><button class="text-button" data-suggestion-view="${i}">Preview</button><button class="button small" data-suggestion-add="${i}">Add match</button></div>`).join("")}`
      : c.entries.length
        ? '<p class="subtle">No further verified matches among the loaded rides. Select another stretch on any ride tab to add an effort manually.</p>'
        : "";
    $("comparison-method").textContent = c.entries.some(
      (e) => e.kind === "effort",
    )
      ? "Manually paired efforts: these may be different roads. Distance-progress overlays do not establish equal effort or geographic correspondence. Same-road terrain attribution is disabled."
      : "Selected stretches and accepted GPS matches. Interior alignment uses approximate distance progress.";
  }
  function editName(action = null) {
    pendingAction = action;
    $("comparison-name-editor").hidden = false;
    $("comparison-name-input").value = active().name;
    $("comparison-name-error").textContent = action
      ? "Name this comparison before leaving it."
      : "";
    $("comparison-name-input").focus();
  }
  async function navigate(target) {
    if (editing) await cancelEdit();
    snapshot();
    if (active().entries.length && !active().name) {
      editName(target);
      renderWorkspace();
      return;
    }
    await save();
    if (target === "new") {
      let c = collection.items.find((c) => !c.entries.length);
      if (!c) {
        if (collection.items.length >= 100)
          throw new Error("This workspace already has 100 comparisons.");
        c = fresh();
        collection.items.push(c);
      }
      await activate(c.id);
    } else await activate(target);
    $("comparison-status").textContent = "";
  }
  function add(entry) {
    const c = active();
    if (c.entries.length >= 200)
      throw new Error("This comparison already has 200 stretches.");
    if (
      c.entries.some(
        (e) =>
          e.rideId === entry.rideId &&
          Math.abs(e.start - entry.start) < 0.02 &&
          Math.abs(e.end - entry.end) < 0.02,
      )
    )
      throw new Error("That stretch is already in this comparison.");
    if (!c.road) {
      c.road = { rideId: entry.rideId, start: entry.start, end: entry.end };
      entry.kind = "source";
    }
    c.entries.push({ ...entry, id: newId() });
    $("comparison-status").textContent = "Stretch added. Saving locally…";
  }
  async function showRange(entry) {
    if (!entry) return;
    await getRide(entry.rideId);
    if (!state.selected.includes(entry.rideId))
      state.selected.push(entry.rideId);
    state.referenceId = entry.rideId;
    state.start = Math.floor(entry.start);
    state.end = Math.ceil(entry.end);
    persistSelection();
    render();
  }
  function selectionChanged() {
    $("stretch-status").textContent = "";
    $("stretch-status").classList.remove("error");
  }
  async function browseRide(id) {
    if (editing) await cancelEdit();
    rememberDraft();
    const ride = await getRide(id);
    const draft = (active().drafts || []).find((d) => d.rideId === id);
    selectionChanged();
    await showRange(
      draft || { rideId: id, start: 0, end: ride.points.length - 1 },
    );
    $("ride-tabs").querySelector('[aria-selected="true"]')?.focus();
  }
  async function editEntry(id, { scroll = true } = {}) {
    if (editing) await cancelEdit();
    const entry = active().entries.find((e) => e.id === id);
    if (!entry) return;
    rememberDraft();
    editing = {
      id,
      start: Math.floor(entry.start),
      end: Math.ceil(entry.end),
      returnTo: editorRange(),
    };
    selectionChanged();
    await showRange(entry);
    if (scroll) $("source-editor").scrollIntoView({ block: "start" });
  }
  async function cancelEdit() {
    const previous = editing?.returnTo;
    editing = null;
    selectionChanged();
    if (previous) await showRange(previous);
    else render();
  }
  $("source-stretches").onclick = (event) => {
    const entry = event.target.closest("[data-source-entry]");
    if (entry)
      task("Opening saved stretch…", () =>
        editEntry(entry.dataset.sourceEntry, { scroll: false }),
      );
    if (event.target.closest("#another-stretch"))
      task("Selecting another stretch…", async () => {
        const rideId = state.referenceId;
        if (editing) await cancelEdit();
        selectionChanged();
        const ride = loaded.get(rideId);
        await showRange({ rideId, start: 0, end: ride.points.length - 1 });
      });
  };
  $("cancel-stretch-edit").onclick = () =>
    task("Closing stretch editor…", cancelEdit);
  $("reset-selection").onclick = () =>
    task("Selecting full ride…", async () => {
      const ride = loaded.get(state.referenceId);
      if (!ride) return;
      state.start = 0;
      state.end = ride.points.length - 1;
      selectionChanged();
      render();
    });
  $("comparison-name").onclick = () => editName();
  $("delete-comparison").onclick = () => {
    if ($("delete-comparison").disabled) return;
    deletionTarget = active().id;
    $("comparison-delete-message").textContent =
      `Delete “${active().name || "Untitled comparison"}” and its stretches? Imported rides will remain.`;
    $("comparison-delete-confirm").hidden = false;
    $("comparison-delete-cancel").focus({ preventScroll: true });
  };
  $("comparison-delete-cancel").onclick = () => {
    deletionTarget = null;
    $("comparison-delete-confirm").hidden = true;
    $("delete-comparison").focus({ preventScroll: true });
  };
  $("comparison-delete-yes").onclick = () =>
    task("Deleting comparison…", async () => {
      if (
        !deletionTarget ||
        deletionTarget !== active().id ||
        $("delete-comparison").disabled
      )
        return;
      clearTimeout(timer);
      snapshot();
      const previous = structuredClone(collection);
      const index = collection.items.findIndex((c) => c.id === deletionTarget);
      collection.items.splice(index, 1);
      if (!collection.items.length) collection.items.push(fresh());
      try {
        await activate(
          collection.items[Math.min(index, collection.items.length - 1)].id,
        );
        await save();
      } catch (error) {
        collection = previous;
        await activate(previous.activeId);
        throw error;
      }
      $("comparison-name").focus({ preventScroll: true });
    });
  $("comparison-name-cancel").onclick = () => {
    pendingAction = null;
    $("comparison-name-editor").hidden = true;
    renderWorkspace();
  };
  $("comparison-name-editor").onsubmit = (event) => {
    event.preventDefault();
    const name = $("comparison-name-input").value.trim().replace(/\s+/g, " ");
    if (!name) {
      $("comparison-name-error").textContent = "Enter a comparison name.";
      return;
    }
    if (
      collection.items.some(
        (c) =>
          c.id !== active().id &&
          comparisonNameKey(c.name) === comparisonNameKey(name),
      )
    ) {
      $("comparison-name-error").textContent =
        "A comparison with that name already exists. Choose another name.";
      return;
    }
    task("Saving comparison name…", async () => {
      const previous = active().name;
      active().name = name;
      try {
        await save();
      } catch (e) {
        active().name = previous;
        $("comparison-name-error").textContent = e.message;
        throw e;
      }
      $("comparison-name-editor").hidden = true;
      const action = pendingAction;
      pendingAction = null;
      if (action) await navigate(action);
      else render();
    });
  };
  $("new-comparison").onclick = () =>
    task("Opening new comparison…", () => navigate("new"));
  $("comparison-switch").onchange = (e) => {
    const id = e.target.value;
    task("Opening comparison…", () => navigate(id));
  };
  $("add-stretch").onclick = () =>
    task(
      editing ? "Updating stretch…" : "Adding selected stretch…",
      async () => {
        try {
          const ride = loaded.get(state.referenceId);
          if (
            !ride ||
            ride.points[state.end].d - ride.points[state.start].d < 20
          )
            throw new Error(
              "Select at least 20 meters before adding a stretch.",
            );
          if (editing) {
            const entry = active().entries.find((e) => e.id === editing.id);
            if (
              active().entries.some(
                (e) =>
                  e.id !== entry.id &&
                  e.rideId === ride.id &&
                  Math.abs(e.start - state.start) < 0.02 &&
                  Math.abs(e.end - state.end) < 0.02,
              )
            )
              throw new Error("That stretch is already in this comparison.");
            Object.assign(entry, {
              start: state.start,
              end: state.end,
              kind: "effort",
            });
            editing = null;
            entryFeedback = "Stretch updated in this comparison.";
          } else {
            add({
              rideId: ride.id,
              start: state.start,
              end: state.end,
              kind: "effort",
            });
            entryFeedback = "Stretch added to this comparison.";
          }
          render();
        } catch (e) {
          $("stretch-status").textContent = e.message;
          $("stretch-status").classList.add("error");
          throw e;
        }
      },
    );
  $("comparison-entries").onclick = (e) => {
    const viewButton = e.target.closest("[data-entry-edit]"),
      removeButton = e.target.closest("[data-entry-remove]");
    if (viewButton)
      task("Editing stretch…", () => editEntry(viewButton.dataset.entryEdit));
    if (removeButton)
      task("Removing stretch…", async () => {
        const c = active();
        if (editing?.id === removeButton.dataset.entryRemove)
          await cancelEdit();
        c.entries = c.entries.filter(
          (x) => x.id !== removeButton.dataset.entryRemove,
        );
        if (!c.entries.length) c.road = null;
        render();
      });
  };
  $("suggestions").onclick = (e) => {
    const button = e.target.closest(
      "[data-suggestion-add], [data-suggestion-view]",
    );
    if (!button) return;
    const m =
      suggestions()[
        Number(button.dataset.suggestionAdd ?? button.dataset.suggestionView)
      ];
    if (!m) return;
    task("Selecting suggested stretch…", async () => {
      if (button.hasAttribute("data-suggestion-view")) {
        if (editing) await cancelEdit();
        rememberDraft();
        selectionChanged();
        await showRange({
          rideId: m.rideId,
          start: m.startIndex,
          end: m.endIndex,
        });
      } else {
        add({
          rideId: m.rideId,
          start: m.startIndex,
          end: m.endIndex,
          kind: "matched",
        });
        entryFeedback = "Matching stretch added to this comparison.";
        render();
      }
    });
  };
  return {
    load,
    save,
    soon,
    active,
    matches,
    roadPoints,
    render: renderWorkspace,
    browseRide,
    editEntry,
    selectionChanged,
    sourceStretches,
    hasEfforts: () => active()?.entries.some((e) => e.kind === "effort"),
  };
}
