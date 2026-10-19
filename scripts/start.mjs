import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error(
    "Noboride needs Node.js 24 or newer. Install Node 24 LTS from https://nodejs.org then rerun.",
  );
  process.exit(1);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
if (
  !existsSync(new URL("../node_modules/leaflet/package.json", import.meta.url))
) {
  console.log("Installing locked dependencies (first run only)…");
  const result = spawnSync(npm, ["ci", "--no-fund", "--no-audit"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code || 0));
