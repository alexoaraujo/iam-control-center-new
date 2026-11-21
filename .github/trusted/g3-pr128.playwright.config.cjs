"use strict";
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: ["g3-pr128.spec.cjs"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 120000,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    headless: true,
    serviceWorkers: "block",
    actionTimeout: 15000,
    navigationTimeout: 60000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
