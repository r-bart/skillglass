import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["packages/**/*.test.ts", "apps/desktop/src/main/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["apps/desktop/src/renderer/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
})
