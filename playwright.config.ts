import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./tests/e2e/support/global-setup.ts",
  outputDir: "./test-results/e2e",
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})
