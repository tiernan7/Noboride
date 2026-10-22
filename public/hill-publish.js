import { hillMembership } from "/hills.mjs";
import { createHillAlignment } from "/hill-align.js";
export function createHillPublisher({
  host,
  state,
  getComparison,
  getCatalog,
  saveLibrary,
  esc,
  rideName,
  getRide,
}) {
  host.innerHTML = `<details id="comparison-hill-editor"><summary>Save stretches to the hill library</summary><form id="hill-publish-form"><p class="subtle">Define or extend a named hill using this comparison’s saved sections. Your comparison keeps its own names and boundaries.</p><div class="hill-actions"><button id="hill-publish-all" class="text-button" type="button">Select whole comparison</button><button id="hill-publish-none" class="text-button" type="button">Clear selection</button></div><div id="hill-publish-entries"></div><div id="hill-publish-alignment" class="hill-alignment" hidden></div><div class="hill-publish-controls"><label>Hill group<select id="hill-publish-target"><option value="">Create a new hill</option></select></label><label id="hill-publish-name-label">Hill name<input id="hill-publish-name" maxlength="120" placeholder="Name this physical hill"></label></div><p id="hill-publish-review-count" class="subtle"></p><button id="hill-publish-save" class="button primary" type="submit">Save to hill library</button><p id="hill-publish-status" role="status"></p></form><details id="hill-group-management"><summary>Manage named hills</summary><div id="hill-group-members"></div></details></details>`;
  const $ = (id) => host.querySelector(`#${id}`);
  let key = "",
    selection = new Set(),
    busy = false,
    previousIds = new Set(),
    drafts = new Map(),
    reviewed = new Set(),
    targetChosen = false;
  const note = (text) => {
    $("hill-publish-status").textContent = text;
  };
  const sameSource = (o, e) =>
    o.rideId === e.rideId &&
    (o.id === e.hillObservationId ||
      o.id === `saved-${e.id}` ||
      (o.start === e.start && o.end === e.end) ||
      (o.alignment?.sourceStart === e.start &&
        o.alignment?.sourceEnd === e.end));
  const alignment = createHillAlignment({
    host: $("hill-publish-alignment"),
    state,
    getRide,
    esc,
    onChange(id, start, end) {
      const entryId = id.slice(6);
      if (start < end) {
        drafts.get(entryId).start = start;
        drafts.get(entryId).end = end;
      }
      reviewed.delete(entryId);
      render();
    },
    onConfirm(id, start, end) {
      const entryId = id.slice(6);
      drafts.get(entryId).start = start;
      drafts.get(entryId).end = end;
      reviewed.add(entryId);
      render();
    },
  });
  document.getElementById("open-hill-publish").onclick = () => {
    $("comparison-hill-editor").open = true;
    host.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  $("hill-publish-all").onclick = () => {
    reviewed.clear();
    selection = new Set(
      getComparison()
        .entries.filter((e) => e.review !== "rejected")
        .map((e) => e.id),
    );
    alignment.close();
    render();
  };
  $("hill-publish-none").onclick = () => {
    reviewed.clear();
    selection.clear();
    alignment.close();
    render();
  };
  $("hill-publish-entries").onclick = async (event) => {
    const button = event.target.closest("[data-hill-align]");
    if (!button) return;
    const entry = getComparison().entries.find(
        (e) => e.id === button.dataset.hillAlign,
      ),
      draft = drafts.get(entry.id),
      catalog = getCatalog(),
      target = $("hill-publish-target").value,
      existing = catalog.library.groups.find((g) => g.id === target),
      others = catalog.observations.filter(
        (o) =>
          existing?.observationIds.includes(o.id) &&
          !getComparison().entries.some(
            (e) => selection.has(e.id) && sameSource(o, e),
          ),
      );
    others.push(
      ...getComparison()
        .entries.filter((e) => selection.has(e.id) && e.id !== entry.id)
        .map((e) => ({
          id: `draft-${e.id}`,
          rideId: e.rideId,
          ...drafts.get(e.id),
        })),
    );
    try {
      await alignment.open({
        id: `draft-${entry.id}`,
        rideId: entry.rideId,
        ...draft,
        name: rideName(entry.rideId),
        hillName:
          existing?.name || $("hill-publish-name").value.trim() || "New hill",
        others,
        onBounds(start, end) {
          draft.start = start;
          draft.end = end;
        },
      });
    } catch (error) {
      note(`Alignment review: ${error.message}`);
    }
  };
  $("hill-publish-target").onchange = () => {
    targetChosen = true;
    reviewed.clear();
    alignment.close();
    render();
    $("hill-publish-name-label").hidden = !!$("hill-publish-target").value;
  };
  $("hill-publish-entries").onchange = (event) => {
    const input = event.target.closest("[data-publish-entry]");
    if (input)
      input.checked
        ? selection.add(input.dataset.publishEntry)
        : selection.delete(input.dataset.publishEntry);
    reviewed.clear();
    alignment.close();
    render();
  };
  $("hill-publish-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const c = getComparison(),
      catalog = getCatalog(),
      entries =
        c?.entries.filter(
          (e) => selection.has(e.id) && e.review !== "rejected",
        ) || [];
    if (!entries.length) return note("Choose at least one saved stretch.");
    if (entries.some((e) => !reviewed.has(e.id)))
      return note("Review alignment for every selected pass before saving.");
    const target = $("hill-publish-target").value,
      name = $("hill-publish-name").value.trim();
    if (!target && !name) return note("Give the hill a name.");
    const library = structuredClone(catalog.library),
      records = library.observations || [],
      replacements = new Map();
    const ids = entries.map((entry) => {
      const section = c.sections?.find(
        (s) => s.id === entry.sectionId && s.rideId === entry.rideId,
      );
      const same = catalog.observations.find(
        (r) =>
          r.rideId === entry.rideId &&
          Math.abs(r.start - drafts.get(entry.id).start) < 0.02 &&
          Math.abs(r.end - drafts.get(entry.id).end) < 0.02,
      );
      const linked = hillMembership(
        entry,
        catalog.library,
        catalog.observations,
      )?.observation;
      const id = linked?.id.startsWith("saved-")
        ? linked.id
        : same?.id.startsWith("saved-")
          ? same.id
          : `saved-${entry.id}`;
      if (same && same.id !== id) replacements.set(same.id, id);
      for (const o of catalog.observations)
        if (sameSource(o, entry) && o.id !== id) replacements.set(o.id, id);
      const record = {
        id,
        rideId: entry.rideId,
        start: drafts.get(entry.id).start,
        end: drafts.get(entry.id).end,
        alignment: {
          version: 1,
          reviewed: true,
          sourceStart:
            linked?.alignment?.sourceStart ?? linked?.start ?? entry.start,
          sourceEnd: linked?.alignment?.sourceEnd ?? linked?.end ?? entry.end,
        },
        name: section?.name || "Hill pass",
      };
      const index = records.findIndex((r) => r.id === id);
      if (index < 0) records.push(record);
      else records[index] = record;
      return id;
    });
    const id =
      target || `hill-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
    library.groups = library.groups
      .map((g) => ({
        ...g,
        observationIds: [
          ...new Set(g.observationIds.map((id) => replacements.get(id) || id)),
        ],
      }))
      .map((g) => ({
        ...g,
        observationIds:
          g.id === id
            ? [...new Set([...g.observationIds, ...ids])]
            : g.observationIds.filter((value) => !ids.includes(value)),
      }))
      .filter((g) => g.observationIds.length);
    if (!target)
      library.groups.push({ id, name, observationIds: [...new Set(ids)] });
    library.observations = records;
    busy = true;
    $("hill-publish-save").disabled = true;
    note("Saving hill…");
    try {
      await saveLibrary(library);
      $("hill-publish-target").value = id;
      targetChosen = true;
      note("Hill saved. Open Hills to explore its summary.");
    } catch (error) {
      note(`Not saved: ${error.message}`);
    } finally {
      busy = false;
      render();
    }
  };
  $("hill-group-members").onclick = async (event) => {
    const button = event.target.closest("[data-hill-group-action]");
    if (!button || busy) return;
    const library = structuredClone(getCatalog().library),
      id = button.dataset.group,
      group = library.groups.find((g) => g.id === id);
    if (!group) return;
    if (button.dataset.hillGroupAction === "rename")
      group.name = button
        .closest("article")
        .querySelector("input")
        .value.trim();
    if (button.dataset.hillGroupAction === "remove")
      group.observationIds = group.observationIds.filter(
        (o) => o !== button.dataset.observation,
      );
    if (button.dataset.hillGroupAction === "dissolve")
      library.groups = library.groups.filter((g) => g.id !== id);
    library.groups = library.groups.filter((g) => g.observationIds.length);
    busy = true;
    try {
      await saveLibrary(library);
      note("Hill library updated. Comparison sections are unchanged.");
    } catch (error) {
      note(`Not saved: ${error.message}`);
    } finally {
      busy = false;
      render();
    }
  };
  function render() {
    const c = getComparison(),
      catalog = getCatalog();
    if (!c || !catalog) return;
    const entries = c.entries.filter((e) => e.review !== "rejected"),
      next = c.id;
    if (key !== next) {
      key = next;
      selection = new Set(entries.map((e) => e.id));
      previousIds = new Set();
      drafts.clear();
      reviewed.clear();
      targetChosen = false;
      $("hill-publish-target").value = "";
      note("");
      alignment.close();
      $("hill-publish-name").value = "";
    }
    const associations = new Map(
      entries.map((e) => [
        e.id,
        hillMembership(e, catalog.library, catalog.observations),
      ]),
    );
    const inferredGroups = [
      ...new Set(
        entries
          .filter((e) => selection.has(e.id))
          .map((e) => associations.get(e.id)?.group.id)
          .filter(Boolean),
      ),
    ];
    let target = $("hill-publish-target").value;
    if (!targetChosen)
      target = inferredGroups.length === 1 ? inferredGroups[0] : "";
    if (target && !catalog.library.groups.some((g) => g.id === target)) {
      target = "";
      targetChosen = false;
      reviewed.clear();
      alignment.close();
    }
    for (const e of entries) {
      if (!previousIds.has(e.id)) selection.add(e.id);
      const draft = drafts.get(e.id),
        linked = associations.get(e.id),
        saved = linked?.observation;
      if (
        !draft ||
        draft.sourceStart !== e.start ||
        draft.sourceEnd !== e.end
      ) {
        drafts.set(e.id, {
          start: saved?.start ?? e.start,
          end: saved?.end ?? e.end,
          sourceStart: e.start,
          sourceEnd: e.end,
        });
        reviewed.delete(e.id);
        if (saved?.alignment?.reviewed && linked.group.id === target)
          reviewed.add(e.id);
      }
    }
    previousIds = new Set(entries.map((e) => e.id));
    document.getElementById("open-hill-publish").disabled =
      busy || !entries.length;
    const membershipLabel = (e) => {
      const linked = associations.get(e.id),
        draft = drafts.get(e.id);
      if (!linked) return "";
      const changed =
        draft.start !== linked.observation.start ||
        draft.end !== linked.observation.end;
      const status = changed
        ? reviewed.has(e.id)
          ? "reviewed changes · not saved yet"
          : "boundary changes need review"
        : linked.observation.alignment?.reviewed
          ? "saved alignment"
          : "alignment review needed";
      return `<small data-hill-membership="${esc(e.id)}">In ${esc(linked.group.name)} · ${status}</small>`;
    };
    $("hill-publish-entries").innerHTML =
      entries
        .map(
          (e) =>
            `<div class="hill-publish-row"><label class="check-label"><input type="checkbox" data-publish-entry="${esc(e.id)}" ${selection.has(e.id) ? "checked" : ""}><span>${esc(rideName(e.rideId))} · ${esc(c.sections?.find((s) => s.id === e.sectionId && s.rideId === e.rideId)?.name || "Stretch")}${membershipLabel(e)}</span></label><button type="button" class="button small" data-hill-align="${esc(e.id)}" ${!selection.has(e.id) ? "disabled" : ""}>${reviewed.has(e.id) ? "✓ Reviewed — adjust" : "Review alignment"}</button></div>`,
        )
        .join("") ||
      '<p class="subtle">Add a stretch to this comparison first.</p>';
    $("hill-publish-review-count").textContent =
      `${[...selection].filter((id) => reviewed.has(id) && previousIds.has(id)).length} of ${entries.filter((e) => selection.has(e.id)).length} selected passes reviewed. Hill-only boundaries and review decisions are saved in the hill library.`;
    $("hill-publish-target").innerHTML =
      '<option value="">Create a new hill</option>' +
      catalog.library.groups
        .map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`)
        .join("");
    if (catalog.library.groups.some((g) => g.id === target))
      $("hill-publish-target").value = target;
    $("hill-publish-save").disabled =
      busy ||
      !entries.some((e) => selection.has(e.id)) ||
      entries.some((e) => selection.has(e.id) && !reviewed.has(e.id));
    $("hill-publish-name-label").hidden = !!target;
    $("hill-publish-save").textContent = target
      ? "Save hill changes"
      : "Save to hill library";
    const linkedGroup = catalog.library.groups.find((g) => g.id === target);
    $("comparison-hill-editor").querySelector("summary").textContent =
      linkedGroup
        ? `Edit hill: ${linkedGroup.name}`
        : "Save stretches to the hill library";
    document.getElementById("open-hill-publish").textContent = linkedGroup
      ? "Edit saved hill"
      : "Add to hill library";
    $("hill-group-members").innerHTML =
      catalog.library.groups
        .map(
          (g) =>
            `<article class="hill-group"><div class="hill-actions"><label>Hill name<input value="${esc(g.name)}" maxlength="120"></label><button type="button" class="button small" data-hill-group-action="rename" data-group="${esc(g.id)}">Rename</button><button type="button" class="text-button danger" data-hill-group-action="dissolve" data-group="${esc(g.id)}">Dissolve group</button></div><ul>${g.observationIds
              .map((id) => {
                const o = catalog.observations.find((v) => v.id === id);
                return `<li>${esc(o ? rideName(o.rideId) : "Unavailable source")} · ${esc(o?.name || "Hill")} <button type="button" class="text-button" data-hill-group-action="remove" data-group="${esc(g.id)}" data-observation="${esc(id)}">Remove pass</button></li>`;
              })
              .join("")}</ul></article>`,
        )
        .join("") || '<p class="subtle">No named hills yet.</p>';
  }
  return { render };
}
