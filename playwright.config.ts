import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  // Each test launches its own Electron and they all prefer port 8787, so run one at a time.
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
});
