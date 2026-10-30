import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.PREVIEW_URL,
    browserName: "chromium",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
    ignoreHTTPSErrors: false,
  },
});
