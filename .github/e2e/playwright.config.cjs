const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "auth0.spec.cjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 90000,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    headless: true,
    actionTimeout: 15000,
    navigationTimeout: 60000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
