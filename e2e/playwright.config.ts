import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "4343";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // terminal sessions are stateful; serialize for sanity
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "bun e2e/helpers/dev-server.ts",
    cwd: "..", // run from repo root so bin/relay.ts resolves correctly
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_PORT: PORT },
  },
});
