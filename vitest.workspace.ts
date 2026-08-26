import { defineWorkspace } from "vitest/config"

export default defineWorkspace([
  {
    test: {
      name: "node",
      environment: "node",
      passWithNoTests: true,
      include: ["packages/**/*.test.ts", "apps/desktop/src/main/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "renderer",
      environment: "jsdom",
      passWithNoTests: true,
      include: ["apps/desktop/src/renderer/**/*.test.{ts,tsx}"],
    },
  },
])
