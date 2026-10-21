import {
  comparisonNameKey,
  stretchPoints,
  coversSuggestedPass,
  sectionCandidates,
} from "/comparisons.mjs";
import { findMatches } from "/analysis.mjs";
import { detectClimbs } from "/ride-story.mjs";
import { createMatchReview } from "/match-review.js";

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
  onOpenRange,
  getSection,
  onSavedSection,
}) {
  const $ = (id) => document.getElementById(id);
  let collection = { activeId: "", items: [] },
    pendingAction = null,
    deletionTarget = null,
    writes = Promise.resolve(),
    timer,
    editing = null,
    entryFeedback = "";
  const resolutionCache = new Map();
  const active = () =>
    collection.items.find((c) => c.id === collection.activeId);
  const hasWork = (c) =>
    c.entries.length || c.sections?.some((section) => !section.deleted);
  const fresh = () => ({
    id: newId(),
    name: "",
    entries: [],
    sections: [],
    road: null,
    selected: [...state.selected],
    browse: null,
    drafts: [],
    matchDecisions: [],
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
    // Review actions may adjust an included range; keep its section in the same transaction.
    for (const c of collection.items)
      for (const entry of c.entries) {
        const section = c.sections?.find(
          (item) => item.rideId === entry.rideId && item.id === entry.sectionId,
        );
        if (section) {
          section.start = entry.start;
          section.end = entry.end;
        }
      }
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
  async function activate(id, { restoreSelection = false } = {}) {
    onOpenRange?.();
    deletionTarget = null;
    pendingAction = null;
    $("comparison-delete-confirm").hidden = true;
    $("comparison-name-editor").hidden = true;
    editing = null;
    entryFeedback = "";
    collection.activeId = id;
    const c = active();
    c.matchDecisions ||= [];
    if (c.sections === undefined) {
      // One-time copies for pre-section workspaces; subsequent edits stay inside each comparison.
      const used = new Set([
        ...c.selected,
        ...c.entries.map((entry) => entry.rideId),
      ]);
      c.sections = state.rides
        .filter((ride) => used.has(ride.id))
        .flatMap((ride) =>
          (ride.climbEdits || []).map((section) => ({
            ...section,
            rideId: ride.id,
          })),
        );
    }
    const available = new Set(state.rides.map((r) => r.id));
    state.selected = (restoreSelection ? c.selected : state.selected).filter(
      (id) => available.has(id),
    );
    await Promise.all(
      [...new Set([...state.selected, ...(c.road ? [c.road.rideId] : [])])]
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
      await activate(collection.activeId, { restoreSelection: true });
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
      if (!state.selected.includes(entry.rideId)) return [];
      if (entry.review === "rejected") return [];
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
          relation:
            entry.relation ||
            (entry.kind === "effort" ? "similar-terrain" : "same-road"),
          review: entry.review || "",
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
              !(c.matchDecisions || []).some(
                (decision) =>
                  decision.rideId === id &&
                  coversSuggestedPass(decision, m, ride.points, 95),
              ) &&
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
  function sectionDefinitions(ride) {
    const definitions = (active()?.sections || []).filter(
      (item) => item.rideId === ride.id,
    );
    const available = detectClimbs(ride.points, definitions).map((item) => ({
      ...item,
      rideId: ride.id,
    }));
    const extra = [];
    for (const entry of (active()?.entries || []).filter(
      (item) => item.rideId === ride.id,
    )) {
      if (
        entry.sectionId &&
        definitions.some((item) => item.id === entry.sectionId)
      )
        continue;
      const related =
        !entry.sectionId &&
        sectionCandidates(entry, [...available, ...extra], ride.points, 60);
      if (related?.length) continue;
      const id = entry.sectionId || `entry-${entry.id}`;
      if (!extra.some((item) => item.id === id))
        extra.push({
          id,
          rideId: ride.id,
          start: entry.start,
          end: entry.end,
          kind: "section",
          name: `Stretch ${active().entries.indexOf(entry) + 1}`,
          manual: true,
        });
    }
    return [...definitions, ...extra];
  }
  function entrySectionId(entry) {
    if (entry.sectionId) return entry.sectionId;
    const cacheKey = `${active().id}:${entry.id}:${entry.start}:${entry.end}`;
    if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey);
    const ride = loaded.get(entry.rideId);
    if (!ride) return "";
    const nodes = detectClimbs(ride.points, sectionDefinitions(ride)).map(
      (node) => ({ ...node, rideId: ride.id }),
    );
    const id =
      sectionCandidates(entry, nodes, ride.points, 60)[0]?.candidate.id || "";
    resolutionCache.set(cacheKey, id);
    return id;
  }
  function sectionMembers(section) {
    return (active()?.entries || []).filter(
      (entry) =>
        entry.rideId === section.rideId && entrySectionId(entry) === section.id,
    );
  }
  function sectionForRange(range) {
    const ride = loaded.get(range.rideId);
    const nodes = detectClimbs(ride.points, sectionDefinitions(ride)).map(
      (node) => ({ ...node, rideId: ride.id }),
    );
    return (
      sectionCandidates(range, nodes, ride.points, 90)[0]?.candidate || {
        id: `manual-${newId()}`,
        rideId: ride.id,
        start: range.start,
        end: range.end,
        kind: "section",
        name: `Stretch ${active().entries.length + 1}`,
        manual: true,
      }
    );
  }
  function putDefinition(section) {
    resolutionCache.clear();
    const c = active();
    c.sections = (c.sections || []).filter(
      (item) => item.rideId !== section.rideId || item.id !== section.id,
    );
    c.sections.push({
      id: section.id,
      rideId: section.rideId,
      start: section.start,
      end: section.end,
      kind: section.kind,
      name: section.name.trim(),
      ...(section.manual ? { manual: true } : {}),
      ...(section.deleted ? { deleted: true } : {}),
    });
  }
  async function saveSection(section, { include = false } = {}) {
    const previous = structuredClone(collection),
      previousEditing = structuredClone(editing);
    try {
      const ride = loaded.get(section.rideId),
        c = active();
      if (!section.name.trim())
        throw new Error("Give the section a name before saving.");
      if (section.isNew) {
        const equivalent = sectionCandidates(
          section,
          detectClimbs(ride.points, sectionDefinitions(ride))
            .filter(
              (node) =>
                node.kind === section.kind ||
                (Math.abs(node.start - section.start) < 0.02 &&
                  Math.abs(node.end - section.end) < 0.02),
            )
            .map((node) => ({ ...node, rideId: ride.id })),
          ride.points,
          90,
        )[0]?.candidate;
        if (equivalent)
          section = {
            ...section,
            id: equivalent.id,
            manual: equivalent.manual,
          };
      }
      const members = sectionMembers(section);
      let entry = editing && c.entries.find((item) => item.id === editing.id);
      entry ||= members.length === 1 ? members[0] : null;
      if (!entry && members.length > 1)
        throw new Error(
          "This section has multiple existing versions. Select a comparison version before saving; remove unwanted versions from the comparison list.",
        );
      if (
        (include || entry) &&
        c.entries.some(
          (other) =>
            other.id !== entry?.id &&
            other.rideId === section.rideId &&
            Math.abs(other.start - section.start) < 0.02 &&
            Math.abs(other.end - section.end) < 0.02,
        )
      )
        throw new Error(
          "That stretch is already included. Select its existing section to edit it.",
        );
      putDefinition(section);
      if (entry) {
        const changed =
          entry.start !== section.start || entry.end !== section.end;
        Object.assign(entry, {
          sectionId: section.id,
          start: section.start,
          end: section.end,
        });
        if (changed) {
          entry.kind = "effort";
          entry.relation = "similar-terrain";
          delete entry.review;
        }
      } else if (include) {
        add({
          rideId: ride.id,
          start: section.start,
          end: section.end,
          sectionId: section.id,
          kind: "effort",
        });
        entry = c.entries.at(-1);
      }
      if (entry)
        editing = {
          id: entry.id,
          start: Math.floor(entry.start),
          end: Math.ceil(entry.end),
          returnTo: editorRange(),
        };
      await save();
      onSavedSection?.(section, entry);
      entryFeedback = entry
        ? "Section saved in this comparison."
        : "Section saved. Add it to the comparison when ready.";
      render();
      return section;
    } catch (error) {
      collection = previous;
      editing = previousEditing;
      resolutionCache.clear();
      throw error;
    }
  }
  async function deleteSection(section) {
    const previous = structuredClone(collection),
      previousEditing = structuredClone(editing);
    try {
      const c = active(),
        members = sectionMembers(section);
      const original =
        c.sections.find(
          (item) => item.rideId === section.rideId && item.id === section.id,
        ) ||
        detectClimbs(
          loaded.get(section.rideId).points,
          sectionDefinitions(loaded.get(section.rideId)),
        ).find((item) => item.id === section.id) ||
        section;
      c.entries = c.entries.filter(
        (entry) => !members.some((member) => member.id === entry.id),
      );
      putDefinition({ ...original, rideId: section.rideId, deleted: true });
      if (!c.entries.length) {
        c.road = null;
        c.matchDecisions = [];
      }
      editing = null;
      await save();
      onOpenRange?.();
      render();
    } catch (error) {
      collection = previous;
      editing = previousEditing;
      resolutionCache.clear();
      throw error;
    }
  }
  function renderWorkspace() {
    resolutionCache.clear();
    const c = active();
    if (!c) return;
    $("comparison-name").textContent = c.name || "Untitled comparison";
    $("comparison-switch").innerHTML = collection.items
      .map(
        (x) =>
          `<option value="${esc(x.id)}">${esc(x.name || "Untitled comparison")} · ${availability(x).label}</option>`,
      )
      .join("");
    $("comparison-switch").value = c.id;
    $("new-comparison").disabled = !hasWork(c);
    $("delete-comparison").disabled =
      collection.items.length === 1 && !hasWork(c) && !c.name;
    $("comparison-count").textContent =
      `${state.matches.length} of ${c.entries.length} stretches available · ${new Set(state.matches.map((e) => e.rideId)).size} selected ride${new Set(state.matches.map((e) => e.rideId)).size === 1 ? "" : "s"}`;
    const coverage = availability(c);
    $("comparison-availability").hidden = !c.entries.length;
    $("comparison-availability-text").textContent = !coverage.selected.length
      ? "No selected rides supply stretches for this comparison. Include its rides or switch to another comparison. Saved stretches are kept."
      : coverage.missing.length
        ? `Partial comparison: ${state.matches.length} of ${c.entries.length} stretches available. ${coverage.missing.length} saved stretches belong to unselected rides.`
        : state.matches.length < c.entries.length
          ? `${state.matches.length} of ${c.entries.length} stretches available. Some pairings are rejected or could not be verified under the current settings.`
          : `Ready: all ${c.entries.length} saved stretches are available from selected rides.`;
    $("include-missing-rides").hidden = !coverage.missing.length;
    $("excluded-stretches").hidden = !coverage.missing.length;
    $("excluded-stretches-summary").textContent =
      `${coverage.missing.length} saved stretches from unselected rides`;
    if (
      editing &&
      state.referenceId !== c.entries.find((e) => e.id === editing.id)?.rideId
    )
      editing = null;
    const selectedSection = getSection?.();
    const storedSection =
      selectedSection &&
      c.sections?.find(
        (section) =>
          section.rideId === selectedSection.rideId &&
          section.id === selectedSection.id,
      );
    const dirty =
      editing &&
      (state.start !== editing.start ||
        state.end !== editing.end ||
        (selectedSection &&
          (!storedSection ||
            selectedSection.name !== storedSection.name ||
            selectedSection.kind !== storedSection.kind)));
    const saved = sourceStretches();
    $("source-stretches").innerHTML = state.referenceId
      ? `<p>${saved.length ? `${saved.length} included section${saved.length === 1 ? "" : "s"} from this ride. Find them in Comparison sections below.` : "Select a suggested section or define your own range."}</p>${saved.length ? '<button class="button small" id="another-stretch">Select another stretch</button>' : ""}`
      : "";
    const duplicate = c.entries.some(
      (e) =>
        e.rideId === state.referenceId &&
        Math.abs(e.start - state.start) < 0.02 &&
        Math.abs(e.end - state.end) < 0.02,
    );
    const ambiguous = selectedSection
      ? sectionMembers(selectedSection).length > 1 && !editing
      : !editing &&
        loaded.has(state.referenceId) &&
        sectionCandidates(
          { rideId: state.referenceId, start: state.start, end: state.end },
          c.entries,
          loaded.get(state.referenceId).points,
          90,
        ).length > 1;
    $("add-stretch").disabled =
      !state.referenceId ||
      ambiguous ||
      (editing ? !dirty : duplicate && !selectedSection?.isNew);
    $("add-stretch").textContent = editing
      ? selectedSection
        ? "Save changes"
        : "Update stretch"
      : ambiguous
        ? "Choose existing version"
        : duplicate && selectedSection?.isNew
          ? "Save existing section"
          : duplicate
            ? "Already in comparison"
            : "Add to comparison";
    $("cancel-stretch-edit").hidden = !editing;
    $("cancel-stretch-edit").textContent = dirty ? "Cancel changes" : "Done";
    $("reset-selection").disabled = !state.referenceId;
    const currentSource = c.entries.find(
      (entry) =>
        entry.kind === "source" &&
        entry.rideId === state.referenceId &&
        entry.start === state.start &&
        entry.end === state.end,
    );
    $("inspect-pairing").hidden =
      !c.road || !state.referenceId || !!currentSource;
    $("selection-summary").textContent = state.referenceId
      ? rangeLabel({
          rideId: state.referenceId,
          start: state.start,
          end: state.end,
        })
      : "Choose a source ride to select a stretch.";
    $("selection-context").textContent = ambiguous
      ? "Several existing versions overlap this section. Select one in Comparison sections to edit it, or remove unwanted versions from the comparison list."
      : editing
        ? `Editing section ${c.entries.findIndex((e) => e.id === editing.id) + 1} in “${c.name || "Untitled comparison"}”. Save changes updates this section and its included range together.`
        : duplicate && selectedSection?.isNew
          ? "This range is already included. Save existing section updates it instead of adding a copy."
          : duplicate
            ? `Already saved in “${c.name || "Untitled comparison"}”. Use Edit in the stretch list to change it.`
            : `Preview only. Add this stretch to “${c.name || "Untitled comparison"}” to include it.`;
    const renderEntries = (entries, excluded = false) =>
      entries
        .map(
          (e) =>
            `<li class="${editing?.id === e.id ? "editing-stretch" : ""}"><div><strong>${c.entries.findIndex((x) => x.id === e.id) + 1}. ${esc(rideName(e.rideId))}${e.sectionId ? ` · ${esc(c.sections?.find((section) => section.rideId === e.rideId && section.id === e.sectionId)?.name || "Section")}` : ""}</strong><small>${excluded ? "Ride not selected" : esc(rangeLabel(e))} · ${e.kind === "matched" ? "GPS matched" : e.kind === "source" ? "Selected road" : e.relation === "same-road" ? "Manually confirmed same road" : "Similar terrain · manually paired effort"}${e.review === "rejected" ? " · rejected: not analysed" : e.review === "confirmed" ? " · confirmed" : ""}${excluded || e.review === "rejected" || state.matches.some((m) => m.id === e.id) ? "" : " · unavailable under current matching settings"}</small></div>${excluded ? `<button class="text-button" data-include-saved-ride="${esc(e.rideId)}">Include ride</button>` : `<button class="text-button" data-entry-edit="${esc(e.id)}">Edit</button>${e.kind !== "source" ? `<button class="text-button" data-entry-review="${esc(e.id)}">Review road</button>` : ""}`}<button class="text-button danger" data-entry-remove="${esc(e.id)}">Remove</button></li>`,
        )
        .join("");
    $("comparison-entries").innerHTML = c.entries.length
      ? renderEntries(coverage.selected)
      : '<li class="comparison-empty">Choose a ride tab, select a stretch, then add it here. Suggestions appear after the first stretch.</li>';
    $("excluded-entries").innerHTML = renderEntries(coverage.missing, true);
    const suggested = suggestions();
    $("suggestions").innerHTML = suggested.length
      ? `<h3>Suggested matching stretches</h3><p>GPS proposals need your judgement, especially on nearby parallel roads. Inspect original tracks and direction before confirming the same road. Suggestions are not part of the comparison yet.</p>${suggested.map((m, i) => `<div class="suggestion"><span>${esc(rideName(m.rideId))} · pass ${m.pass}<small>GPS offsets ${m.startMiss.toFixed(0)} / ${m.endMiss.toFixed(0)} m · route offset ${m.routeError.toFixed(0)} m${m.gpsBridgeSeconds ? ` · GPS bridge ${m.gpsBridgeSeconds}s` : ""}</small></span><button class="text-button" data-suggestion-view="${i}">Preview</button><button class="text-button" data-suggestion-review="${i}">Inspect roads</button><button class="button small" data-suggestion-add="${i}">Add match</button></div>`).join("")}`
      : c.entries.length
        ? '<p class="subtle">No further verified matches among the loaded rides. Select another stretch on any ride tab to add an effort manually.</p>'
        : "";
    const rejected = c.matchDecisions || [];
    if (rejected.length)
      $("suggestions").insertAdjacentHTML(
        "beforeend",
        `<details id="rejected-matches"><summary>${rejected.length} rejected road pairings</summary>${rejected.map((decision, i) => `<p>${esc(rideName(decision.rideId))} · ${esc(decision.reason || "Rejected by you")} <button class="text-button" data-rejected-review="${i}">Review again</button></p>`).join("")}</details>`,
      );
    $("comparison-method").textContent = state.matches.some((e) => e.manual)
      ? state.matches.some((e) => e.relation === "similar-terrain")
        ? "Similar-terrain efforts: these may be different roads. Distance-progress overlays do not establish equal effort or geographic correspondence. Same-road terrain attribution is disabled."
        : "Manually confirmed same road: original source boundaries remain independent and automatic road checks are overridden. Progress alignment is approximate; same-road terrain attribution is disabled for manual corrections."
      : "Selected stretches and accepted GPS matches. Interior alignment uses approximate distance progress.";
  }
  function availability(c) {
    const selected = c.entries.filter((e) => state.selected.includes(e.rideId));
    const missing = c.entries.filter((e) => !state.selected.includes(e.rideId));
    return {
      selected,
      missing,
      label: !c.entries.length
        ? hasWork(c)
          ? "Sections only"
          : "Empty"
        : !selected.length
          ? "No selected rides"
          : missing.length
            ? `Partial (${selected.length}/${c.entries.length})`
            : c.id === collection.activeId &&
                state.matches.length < c.entries.length
              ? `Review matches (${state.matches.length}/${c.entries.length})`
              : "Ready",
    };
  }
  async function includeRides(ids) {
    const missing = [...new Set(ids)].filter(
      (id) => !state.selected.includes(id),
    );
    await Promise.all(missing.map(getRide));
    state.selected = [...new Set([...state.selected, ...missing])];
    persistSelection();
    render();
  }
  $("include-missing-rides").onclick = () =>
    task("Including missing rides…", () =>
      includeRides(availability(active()).missing.map((e) => e.rideId)),
    );
  $("include-baseline-ride").onclick = () =>
    task("Including baseline ride…", () => {
      const entry = active().entries.find((e) => e.id === state.baseline);
      return includeRides(entry ? [entry.rideId] : []);
    });
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
    if (hasWork(active()) && !active().name) {
      editName(target);
      renderWorkspace();
      return;
    }
    await save();
    if (target === "new") {
      let c = collection.items.find((c) => !hasWork(c));
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
    let definition;
    if (!entry.sectionId) {
      definition = sectionForRange(entry);
      entry.sectionId = definition.id;
    }
    if (c.entries.length >= 200)
      throw new Error("This comparison already has 200 stretches.");
    if (
      c.entries.some(
        (e) =>
          e.rideId === entry.rideId &&
          ((e.sectionId && e.sectionId === entry.sectionId) ||
            (Math.abs(e.start - entry.start) < 0.02 &&
              Math.abs(e.end - entry.end) < 0.02)),
      )
    )
      throw new Error("That stretch is already in this comparison.");
    if (definition)
      putDefinition({ ...definition, start: entry.start, end: entry.end });
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
    onOpenRange?.(entry.id ? entry : undefined);
    persistSelection();
    render();
  }
  function selectionChanged({ adopt = false } = {}) {
    $("stretch-status").textContent = "";
    $("stretch-status").classList.remove("error");
    if (adopt && !editing && !getSection?.() && loaded.has(state.referenceId)) {
      const candidates = sectionCandidates(
        { rideId: state.referenceId, start: state.start, end: state.end },
        active().entries,
        loaded.get(state.referenceId).points,
        90,
      );
      if (candidates.length === 1) {
        const entry = candidates[0].candidate;
        editing = {
          id: entry.id,
          start: Math.floor(entry.start),
          end: Math.ceil(entry.end),
          returnTo: editorRange(),
        };
        onOpenRange?.(entry);
      }
    }
  }
  function beginSelection(section) {
    const members = section ? sectionMembers(section) : [];
    const entry = members.length === 1 ? members[0] : null;
    editing = entry
      ? {
          id: entry.id,
          start: Math.floor(entry.start),
          end: Math.ceil(entry.end),
          returnTo: editorRange(),
        }
      : null;
    $("stretch-status").textContent = "";
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
    if (previous && state.selected.includes(previous.rideId))
      await showRange(previous);
    else render();
  }
  $("ride-browser").addEventListener("click", (event) => {
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
  });
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
          const section = getSection?.() || {
            ...sectionForRange({
              rideId: ride.id,
              start: state.start,
              end: state.end,
            }),
            start: state.start,
            end: state.end,
          };
          await saveSection(section, { include: true });
          return;
        } catch (e) {
          $("stretch-status").textContent = e.message;
          $("stretch-status").classList.add("error");
          throw e;
        }
      },
    );
  const entryAction = (e) => {
    const viewButton = e.target.closest("[data-entry-edit]"),
      removeButton = e.target.closest("[data-entry-remove]");
    if (viewButton)
      task("Editing stretch…", () => editEntry(viewButton.dataset.entryEdit));
    const reviewButton = e.target.closest("[data-entry-review]");
    if (reviewButton)
      task("Inspecting road pairing…", () =>
        reviewEntry(reviewButton.dataset.entryReview),
      );
    if (removeButton)
      task("Removing stretch…", async () => {
        const c = active();
        const entry = c.entries.find(
          (item) => item.id === removeButton.dataset.entryRemove,
        );
        const id = entry && entrySectionId(entry);
        if (editing?.id === removeButton.dataset.entryRemove)
          await cancelEdit();
        c.entries = c.entries.filter(
          (x) => x.id !== removeButton.dataset.entryRemove,
        );
        if (
          entry &&
          !c.entries.some(
            (item) =>
              item.rideId === entry.rideId && entrySectionId(item) === id,
          )
        ) {
          const original = c.sections.find(
            (section) => section.rideId === entry.rideId && section.id === id,
          );
          if (original) original.deleted = true;
        }
        if (!c.entries.length) {
          c.road = null;
          c.matchDecisions = [];
        }
        render();
      });
    const include = e.target.closest("[data-include-saved-ride]");
    if (include)
      task("Including saved ride…", () =>
        includeRides([include.dataset.includeSavedRide]),
      );
  };
  $("comparison-entries").onclick = entryAction;
  $("excluded-entries").onclick = entryAction;
  $("suggestions").onclick = (e) => {
    const rejected = e.target.closest("[data-rejected-review]");
    if (rejected) {
      const decision = (active().matchDecisions || [])[
        +rejected.dataset.rejectedReview
      ];
      if (decision)
        task("Inspecting rejected pairing…", () =>
          reviewRange(decision, { reason: decision.reason }),
        );
      return;
    }
    const button = e.target.closest(
      "[data-suggestion-add], [data-suggestion-view], [data-suggestion-review]",
    );
    if (!button) return;
    const m =
      suggestions()[
        Number(
          button.dataset.suggestionAdd ??
            button.dataset.suggestionView ??
            button.dataset.suggestionReview,
        )
      ];
    if (!m) return;
    task("Selecting suggested stretch…", async () => {
      if (button.hasAttribute("data-suggestion-review")) {
        await reviewRange(
          { rideId: m.rideId, start: m.startIndex, end: m.endIndex },
          { automatic: true },
        );
      } else if (button.hasAttribute("data-suggestion-view")) {
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
          relation: "same-road",
          review: "confirmed",
        });
        entryFeedback = "Matching stretch added to this comparison.";
        render();
      }
    });
  };
  async function reviewRange(range, extra = {}) {
    if (!active().road) return;
    const ride = await getRide(range.rideId);
    const entry = active().entries.find(
      (entry) =>
        entry.rideId === range.rideId &&
        Math.abs(entry.start - range.start) < 0.02 &&
        Math.abs(entry.end - range.end) < 0.02,
    );
    if (entry?.kind === "source") return;
    const verified = findMatches(
      ride,
      roadPoints(),
      state.settings.matchRadius,
    ).some(
      (match) =>
        Math.abs(match.startIndex - range.start) < 0.02 &&
        Math.abs(match.endIndex - range.end) < 0.02,
    );
    reviewer.open({
      reference: { ...active().road, points: roadPoints() },
      candidate: {
        ...range,
        points: stretchPoints(ride.points, range.start, range.end),
      },
      name: rideName(range.rideId),
      entryId: entry?.id || "",
      reason: entry?.reviewReason || "",
      ...extra,
      automatic: verified,
    });
  }
  async function reviewEntry(id) {
    const entry = active().entries.find((entry) => entry.id === id);
    if (entry) await reviewRange(entry);
  }
  const reviewer = createMatchReview({
    esc,
    task,
    onDecision: async (review, action, reason) => {
      const c = active(),
        previous = structuredClone(c),
        candidate = review.candidate;
      const sameRange = (entry) =>
        entry.rideId === candidate.rideId &&
        coversSuggestedPass(
          entry,
          { startIndex: candidate.start, endIndex: candidate.end },
          loaded.get(candidate.rideId).points,
          95,
        );
      try {
        c.matchDecisions = (c.matchDecisions || []).filter(
          (decision) => !sameRange(decision),
        );
        const entry = c.entries.find((entry) => entry.id === review.entryId);
        if (action === "rejected") {
          if (c.matchDecisions.length >= 500)
            throw new Error("This comparison already has 500 road decisions.");
          c.matchDecisions.push({
            rideId: candidate.rideId,
            start: candidate.start,
            end: candidate.end,
            decision: "rejected",
            reason,
          });
          if (entry) {
            entry.review = "rejected";
            entry.reviewReason = reason;
          }
        } else {
          const fields = {
            kind:
              action === "same-road" && review.automatic ? "matched" : "effort",
            relation: action,
            review: "confirmed",
            reviewReason: reason,
          };
          if (entry) Object.assign(entry, fields);
          else
            add({
              rideId: candidate.rideId,
              start: candidate.start,
              end: candidate.end,
              ...fields,
            });
        }
        render();
        await save();
      } catch (error) {
        Object.assign(c, previous);
        render();
        throw error;
      }
    },
  });
  $("inspect-pairing").onclick = () =>
    task("Inspecting selected pairing…", () =>
      reviewRange({
        rideId: state.referenceId,
        start: state.start,
        end: state.end,
      }),
    );
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
    beginSelection,
    selectionChanged,
    sourceStretches,
    sectionDefinitions,
    sectionMembers,
    entrySectionId,
    saveSection,
    deleteSection,
    reviewEntry,
    hasEfforts: () => state.matches.some((e) => e.manual),
  };
}
