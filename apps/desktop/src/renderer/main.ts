import { createElement, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.js"
import "./styles.css"

const root = document.getElementById("root")

if (root === null) {
  throw new Error("Forge renderer root is missing")
}

createRoot(root).render(createElement(StrictMode, null, createElement(App, {})))
