import { defineConfig } from "vite"

export default defineConfig({
  build: {
    // Production source is public, but distributables still omit maps to avoid
    // shipping absolute build paths and a second unaudited code artifact.
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "main.cjs",
      },
    },
  },
})
