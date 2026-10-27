export const spreadOptions = `<option value="range">Range</option><option value="sd">Mean ± 1 SD</option><option value="box">Box plots</option>`;
export const densityOptions = `<option value="10">10 positions</option><option value="20" selected>20 positions</option><option value="40">40 positions</option><option value="80">80 positions</option>`;
export const gradeColor = (v) =>
  v == null
    ? "#bec8d0"
    : v >= 12
      ? "#a676b8"
      : v >= 9
        ? "#d86d64"
        : v >= 6
          ? "#e5a16c"
          : v >= 3
            ? "#d0c478"
            : "#a9c4b8";
export const hillGradeLegend = `<span><i style="background:#a9c4b8"></i>&lt;3% / descent</span><span><i style="background:#d0c478"></i>3–6%</span><span><i style="background:#e5a16c"></i>6–9%</span><span><i style="background:#d86d64"></i>9–12%</span><span><i style="background:#a676b8"></i>≥12%</span><span><i style="background:#bec8d0"></i>Grade unavailable</span>`;
export const hillLaneDefinitions = (imperial) => [
  {
    key: "ele",
    label: "Relative elevation",
    unit: imperial ? "ft" : "m",
    factor: imperial ? 3.28084 : 1,
  },
  { key: "grade", label: "Gradient", unit: "%", factor: 1 },
  {
    key: "speed",
    label: "Recorded speed",
    unit: imperial ? "mph" : "km/h",
    factor: imperial ? 2.236936 : 3.6,
  },
  { key: "hr", label: "Heart rate", unit: "bpm", factor: 1 },
  { key: "cad", label: "Cadence", unit: "rpm", factor: 1 },
  { key: "power", label: "Measured power", unit: "W", factor: 1 },
  {
    key: "minimumPower",
    label: "Estimated minimum power",
    unit: "W",
    factor: 1,
  },
];
export const hillRowControls = (rows, collapsed, prefix) =>
  rows
    .map(
      (row) =>
        `<button type="button" class="button small" data-${prefix}-toggle="${row.key}" aria-controls="${prefix}-row-${row.key}" aria-expanded="${!collapsed.has(row.key)}">${collapsed.has(row.key) ? "▸" : "▾"} ${row.label}</button>`,
    )
    .join("");
const dateColors = {
  blue: [
    [106, 164, 211],
    [10, 45, 100],
  ],
  gray: [
    [168, 168, 168],
    [30, 30, 30],
  ],
};
export function dateGradient(scheme = "blue") {
  return `linear-gradient(to right, ${dateColors[scheme].map((rgb) => `rgb(${rgb.join(" ")})`).join(", ")})`;
}
export function datePlotColor(fraction, scheme = "blue") {
  const [oldest, newest] = dateColors[scheme],
    f = Math.max(0, Math.min(1, fraction));
  return `rgb(${oldest.map((v, i) => Math.round(v + (newest[i] - v) * f)).join(" ")})`;
}

export function spreadDescription(mode, density = 20) {
  return mode === "sd"
    ? "Shading: mean ± one sample standard deviation of ride means. At least two rides are required. This is not a confidence interval."
    : mode === "box"
      ? `Boxes: median and middle 50% of ride means at ${density} positions. Whiskers show the minimum and maximum of all included ride means. No outliers are excluded. At least two rides are required.`
      : "Bands show the range of ride means, not confidence intervals.";
}

export function spreadInterval(value, mode) {
  if (value?.mean == null) return null;
  if (mode === "sd")
    return value.sd == null
      ? null
      : [value.mean - value.sd, value.mean + value.sd];
  return [value.min, value.max];
}

// Include every displayed ride mean/outlier and the entire chosen spread.
export function hillChartDomain(fields, metric, mode, factor = 1) {
  let low = Infinity,
    high = -Infinity;
  for (const value of fields) {
    if (value?.mean == null) continue;
    const spread = spreadInterval(value, mode);
    low = Math.min(
      low,
      value.min * factor,
      ...(spread || []).map((v) => v * factor),
    );
    high = Math.max(
      high,
      value.max * factor,
      ...(spread || []).map((v) => v * factor),
    );
  }
  if (!Number.isFinite(low)) return { low: 0, high: 1 };
  if (metric === "hr") {
    const padding = Math.max(5, (high - low) * 0.1),
      nonnegative = low >= 0;
    low = Math.floor(low - padding);
    if (nonnegative) low = Math.max(0, low);
    high = Math.ceil(high + padding);
  } else {
    low = Math.min(0, low);
    high = Math.max(low + 1, high);
  }
  return { low, high };
}

export function spreadMarkup(
  profile,
  key,
  { mode, x, y, color, boxWidth = 10, offset = 0, density = 20 },
) {
  const positions = new Set(
    Array.from({ length: density }, (_, i) =>
      Math.round(((i + 0.5) / density) * (profile.length - 1)),
    ),
  );
  if (mode === "box")
    return profile
      .filter((_, i) => positions.has(i))
      .map((p) => {
        const value = p[key];
        if (value.rides < 2) return "";
        const center = x(p) + offset,
          left = center - boxWidth / 2,
          right = center + boxWidth / 2;
        return `<g data-spread-box="${key}" fill="${color}" stroke="${color}"><path data-box-whisker d="M${center},${y(value.min)} V${y(value.max)} M${left},${y(value.min)} H${right} M${left},${y(value.max)} H${right}" fill="none"/><rect x="${left}" y="${y(value.q3)}" width="${boxWidth}" height="${Math.max(0.6, y(value.q1) - y(value.q3))}" fill-opacity=".2"/><path d="M${left},${y(value.median)} H${right}" fill="none" stroke-width="2"/></g>`;
      })
      .join("");
  return profile
    .map((p, i) => {
      if (!i) return "";
      const a = profile[i - 1],
        before = spreadInterval(a[key], mode),
        after = spreadInterval(p[key], mode);
      if (!before || !after) return "";
      return `<path data-spread-band="${key}" d="M${x(a)},${y(before[0])} L${x(p)},${y(after[0])} L${x(p)},${y(after[1])} L${x(a)},${y(before[1])} Z" fill="${color}" opacity=".15"/>`;
    })
    .join("");
}

export function describeSpread(value, mode, factor = 1, unit = "") {
  if (value?.mean == null) return "not recorded";
  const fmt = (v) => (v * factor).toFixed(1);
  if (mode === "sd")
    return `mean ${fmt(value.mean)} ${unit} · ${value.sd == null ? "SD unavailable (needs 2 rides)" : `SD ${fmt(value.sd)} ${unit}`}`;
  if (mode === "box")
    return `median ${fmt(value.median)} ${unit} · ${value.rides < 2 ? "box unavailable (needs 2 rides)" : `middle 50% ${fmt(value.q1)}–${fmt(value.q3)} ${unit} · min–max ${fmt(value.min)}–${fmt(value.max)} ${unit}`}`;
  return `mean ${fmt(value.mean)} ${unit} · range ${fmt(value.min)}–${fmt(value.max)} ${unit}`;
}
