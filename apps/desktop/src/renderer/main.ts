import { createElement, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.js"
import "./styles/tokens.css"
import "./styles/foundation.css"
import "./styles.css"
import "./styles/components.css"
import "./styles/shell.css"
import "./styles/onboarding.css"
import "./styles/responsive.css"

const platform = navigator.platform.toLowerCase()
document.documentElement.dataset.platform = platform.includes("mac")
  ? "macos"
  : platform.includes("win")
    ? "windows"
    : "linux"

const root = document.getElementById("root")

if (root === null) {
  throw new Error("Skillglass renderer root is missing")
}

createRoot(root).render(createElement(StrictMode, null, createElement(App, {})))
