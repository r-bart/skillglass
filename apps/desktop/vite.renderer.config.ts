import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { DEVELOPMENT_STYLE_NONCE } from "./src/main/security.js"

export default defineConfig({
  base: "./",
  html: {
    cspNonce: DEVELOPMENT_STYLE_NONCE,
  },
  plugins: [react()],
  build: {
    sourcemap: false,
  },
})
