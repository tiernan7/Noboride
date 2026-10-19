import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function databasePath(root, env = process.env) {
  const dir =
    env.NOBORIDE_DATA_DIR || env.RIDESCOPE_DATA_DIR || resolve(root, "data");
  const current = resolve(dir, "noboride.sqlite");
  const legacy = resolve(dir, "ridescope.sqlite");
  // Reuse the old database in place, including any live WAL sidecars.
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}
