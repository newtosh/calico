import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    exclude: ["test/e2e/**", "node_modules/**"],
    environment: "node",
  },
});
