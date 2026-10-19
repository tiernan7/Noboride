export function makeDemo() {
  const n = 600,
    length = 5800,
    vertices = [
      [45.51, -122.71],
      [45.518, -122.714],
      [45.529, -122.711],
      [45.533, -122.695],
      [45.521, -122.691],
      [45.512, -122.699],
      [45.51, -122.71],
    ];
  const alt = (f) =>
    f < 0.32
      ? 250 - (140 * f) / 0.32
      : f < 0.46
        ? 110 + (40 * (f - 0.32)) / 0.14
        : f < 0.69
          ? 150 - (65 * (f - 0.46)) / 0.23
          : f < 0.91
            ? 85 + (145 * (f - 0.69)) / 0.22
            : 230 + (20 * (f - 0.91)) / 0.09;
  const rides = [0, 1, 2].map((run) => {
    let seconds = 0;
    const points = [],
      t0 = Date.UTC(2026, 9, 9 + run * 2, 13);
    for (let i = 0; i <= n; i++) {
      const f = i / n,
        g = (alt(f) - alt(Math.max(0, f - 1 / n))) / (length / n),
        base = g > 0.01 ? 2.6 : g < -0.01 ? 8.8 : 5.2,
        factor =
          run === 0
            ? 1
            : run === 1
              ? g < 0
                ? 1.13
                : 1.04
              : g < 0
                ? 1.15
                : 1.16,
        speed = base * factor * (1 + 0.06 * Math.sin(i / 8));
      if (i) seconds += length / n / speed;
      const vf = f * 6,
        idx = Math.min(5, Math.floor(vf)),
        r = vf - idx,
        a = vertices[idx],
        b = vertices[idx + 1];
      points.push({
        t: t0 + seconds * 1000,
        d: f * length,
        lat: a[0] + (b[0] - a[0]) * r + run * 0.000012,
        lon: a[1] + (b[1] - a[1]) * r,
        ele: alt(f) + run * 3 + 0.4 * Math.sin(i / 9),
        hr: 132 + (g > 0.01 ? 46 : g < -0.01 ? 10 : 25) + 5 * Math.sin(i / 20),
        speed,
        cad: g > 0.01 ? 60 + run * 3 : 82,
        power: g > 0.01 ? 225 + run * 7 : 90,
        temp: 18,
        timer: true,
      });
    }
    return {
      id: `demo-${run}`,
      name: ["First loop", "New bike", "Steadier climb"][run],
      source: "Synthetic demo",
      date: new Date(t0).toISOString(),
      sport: "cycling",
      points,
      deviceElapsed: seconds,
      deviceTimer: seconds,
      deviceMoving: null,
      demo: true,
      warnings: ["Synthetic demonstration; not an actual ride."],
      notes: {
        bike: run ? "Road bike (demo)" : "Older bike (demo)",
        gearing: run ? "34 × 28" : "28 × 28",
        conditions: "Fictional conditions",
        notes: "All coordinates and sensor values are synthetic.",
      },
    };
  });
  return {
    rides,
    segments: [
      {
        id: "demo-hill",
        name: "Main climb · demo",
        referenceId: "demo-0",
        start: 414,
        end: 550,
        path: rides[0].points.slice(414, 551),
        overrides: {},
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
