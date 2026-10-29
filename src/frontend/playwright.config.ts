import { defineConfig, devices } from "@playwright/test";

/**
 * Phone-sized checks of every page: `npm run test:ui`. The web server builds the frontend and
 * starts the API on a throwaway database (e2e/server.py), so it needs the backend's
 * requirements-dev.txt installed. Set PYTHON to that environment's python if it isn't `python3`.
 */
const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // Chromium only, with each device's screen size, touch and user agent.
  projects: [
    { name: "small-android", testIgnore: "tablet.spec.ts", use: { ...devices["Galaxy S8"], browserName: "chromium" } },
    { name: "iphone-se", testIgnore: "tablet.spec.ts", use: { ...devices["iPhone SE"], browserName: "chromium" } },
    { name: "ipad-upright", testMatch: "tablet.spec.ts", use: { ...devices["iPad Mini"], browserName: "chromium" } },
    { name: "ipad-sideways", testMatch: "tablet.spec.ts", use: { ...devices["iPad (gen 7) landscape"], browserName: "chromium" } },
  ],
  webServer: {
    command: `npm run build && ${process.env.PYTHON ?? "python3"} e2e/server.py`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
  },
});
