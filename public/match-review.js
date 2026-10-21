import { hasGPS } from "/analysis.mjs";
import { inspectRoute } from "/ride-story.mjs";

export function createMatchReview({ esc, task, onDecision }) {
  const $ = (id) => document.getElementById(id);
  let current = null,
    map = null,
    layers = null,
    inspection = null;
  const meters = (n) => (n == null ? "Unavailable" : `${n.toFixed(1)} m`);
  function open(value) {
    current = value;
    $("match-review-status").textContent = "";
    inspection = inspectRoute(value.reference.points, value.candidate.points);
    $("match-review-title").textContent = `Inspect pairing · ${value.name}`;
    $("match-review-summary").textContent =
      `${value.automatic ? "GPS proposal passes current automatic checks." : "This range has not passed the automatic same-road checks. A same-road confirmation will be a manual correction."} Original coordinates are shown without translation. Similar terrain does not establish the same road or equal effort.`;
    $("match-review-reason").value = value.reason || "";
    const heading = (value) =>
      value == null ? "unknown" : `${Math.round(value)}° from north`;
    const bearingDifference =
      inspection.referenceHeading == null || inspection.candidateHeading == null
        ? null
        : Math.abs(
            ((inspection.candidateHeading - inspection.referenceHeading + 540) %
              360) -
              180,
          );
    $("match-review-metrics").innerHTML =
      `<dl><dt>Start discrepancy</dt><dd>${meters(inspection.startMiss)}</dd><dt>End discrepancy</dt><dd>${meters(inspection.endMiss)}</dd><dt>Largest inspected offset</dt><dd>${meters(inspection.worst[0]?.offset)}</dd><dt>Reference initial direction</dt><dd>${heading(inspection.referenceHeading)}</dd><dt>Candidate initial direction</dt><dd>${heading(inspection.candidateHeading)}</dd></dl><p>Offsets sample 33 ordered positions at distance progress, not exact GPS projection. Missing GPS is not filled. Direction arrows indicate start → end; inspect switchbacks and parallel roads at close zoom.</p>`;
    if (bearingDifference != null)
      $("match-review-metrics").insertAdjacentHTML(
        "beforeend",
        `<p>Initial headings differ by ${Math.round(bearingDifference)}°${bearingDifference > 120 ? ": initially opposing directions" : ""}. This describes the first observed legs, not direction at every switchback.</p>`,
      );
    $("match-review-divergence").innerHTML =
      inspection.worst
        .slice(0, 5)
        .map(
          (probe) =>
            `<button class="button small" data-divergence="${inspection.probes.indexOf(probe)}">${Math.round(probe.progress * 100)}% through · ${meters(probe.offset)}</button>`,
        )
        .join("") ||
      "No comparable GPS probes. Inspect the raw tracks and recording gaps.";
    $("match-review").showModal();
    if (!map) {
      map = L.map("match-review-map", {
        zoomControl: true,
        maxZoom: 20,
      }).setView([0, 0], 2);
      layers = L.layerGroup().addTo(map);
    }
    layers.clearLayers();
    const bounds = L.latLngBounds([]);
    const draw = (points, color, label, bearing) => {
      let group = [];
      const flush = () => {
        if (group.length)
          L.polyline(group, { color, weight: 4, opacity: 0.85 }).addTo(layers);
        group = [];
      };
      points.forEach((point, i) => {
        if (
          !hasGPS(point) ||
          point.breakBefore ||
          (i && point.t - points[i - 1].t > 30000)
        )
          flush();
        if (hasGPS(point)) {
          group.push([point.lat, point.lon]);
          bounds.extend([point.lat, point.lon]);
        }
      });
      flush();
      for (const [point, endpoint] of [
        [points[0], "START"],
        [points.at(-1), "END"],
      ])
        if (hasGPS(point)) {
          const tip = document.createElement("span");
          tip.textContent = `${label} ${endpoint}`;
          L.circleMarker([point.lat, point.lon], {
            color,
            radius: 7,
            fillOpacity: 1,
          })
            .bindTooltip(tip)
            .addTo(layers);
        }
      const start = points.find(hasGPS);
      if (start && bearing != null)
        L.marker([start.lat, start.lon], {
          icon: L.divIcon({
            className: "route-direction",
            html: `<span style="color:${color};transform:rotate(${bearing - 90}deg)">➤</span>`,
            iconSize: [28, 28],
          }),
        }).addTo(layers);
    };
    draw(
      value.reference.points,
      "#287bd5",
      "Reference",
      inspection.referenceHeading,
    );
    draw(
      value.candidate.points,
      "#e2763d",
      "Candidate",
      inspection.candidateHeading,
    );
    for (const probe of inspection.probes)
      if (probe.offset != null)
        L.polyline(
          [
            [probe.expected.lat, probe.expected.lon],
            [probe.actual.lat, probe.actual.lon],
          ],
          {
            color: probe.offset > 10 ? "#c94448" : "#7b8b9a",
            weight: 1,
            dashArray: "3 4",
            opacity: 0.65,
          },
        ).addTo(layers);
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (bounds.isValid())
        map.fitBounds(bounds, { padding: [25, 25], maxZoom: 18 });
    });
  }
  $("match-review-divergence").onclick = (event) => {
    const button = event.target.closest("[data-divergence]");
    const point =
      button && inspection?.probes[+button.dataset.divergence]?.actual;
    if (hasGPS(point)) map.setView([point.lat, point.lon], 18);
  };
  for (const [id, action] of [
    ["match-confirm", "same-road"],
    ["match-similar", "similar-terrain"],
    ["match-reject", "rejected"],
  ])
    $(id).onclick = () =>
      task("Saving route decision…", async () => {
        if (!current) return;
        try {
          await onDecision(
            current,
            action,
            $("match-review-reason").value.trim(),
          );
        } catch (error) {
          $("match-review-status").textContent = `Not saved: ${error.message}`;
          throw error;
        }
        $("match-review").close();
      });
  return { open };
}
