import { createElement } from "react"

export function App() {
  return createElement(
    "main",
    { className: "shell" },
    createElement(
      "section",
      { className: "welcome", "aria-labelledby": "app-title" },
      createElement("div", { className: "mark", "aria-hidden": true }, "F"),
      createElement("p", { className: "eyebrow" }, "Skill workspace"),
      createElement("h1", { id: "app-title" }, "Forge"),
      createElement(
        "p",
        { className: "description" },
        "Discover, inspect, install, and update agent skills from one local desktop workspace.",
      ),
      createElement("p", { className: "status", role: "status" }, "Secure desktop shell ready"),
    ),
  )
}
