import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--no-zygote",
            "--single-process",
          ],
        }
      : {},
  },
  webServer: {
    command: "node server.mjs",
    url: "http://127.0.0.1:4318/api/workspace",
    reuseExistingServer: false,
    env: {
      PORT: "4318",
      NOBORIDE_DATA_DIR: mkdtempSync(join(tmpdir(), "noboride-ui-")),
    },
  },
});
