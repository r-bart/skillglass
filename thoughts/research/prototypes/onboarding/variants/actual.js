/* global window */

import { dashboardMarkup, setupDashboard } from "../dashboard.js";
import { initialSelection } from "../data.js";

function rootRow({ id, name, path, checked = true, evidence = "observed" }) {
  return `
    <label class="root-option">
      <input type="checkbox" value="${id}" ${checked ? "checked" : ""} />
      <span class="root-copy">
        <strong>${name}</strong>
        <code>${path}</code>
        <span><i class="status-pill status-pill--ok"><span aria-hidden="true">•</span> Lectura y escritura</i><small>Evidencia ${evidence}</small></span>
      </span>
    </label>`;
}

function onboardingMarkup(extraRoots = []) {
  const roots = [
    { id: "global", name: "Codex · Global", path: "/Users/roberto/.agents/skills" },
    ...extraRoots,
  ];
  return `
    <div class="forge-shell forge-shell--baseline" data-baseline>
      <header class="topbar">
        <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="brand"><span class="brand-mark">S</span><span>Skill Forge</span><i></i><small>Carpetas</small></div>
        <p class="top-context">Carpetas</p>
        <div class="top-actions"><button class="quiet-button">↶ Historial</button></div>
      </header>
      <aside class="sidebar">
        <p class="side-label">Biblioteca</p>
        <button class="side-item" disabled><span aria-hidden="true">⌘</span> Todas las skills</button>
        <p class="side-label">Ubicaciones</p>
        <button class="side-item" disabled><span aria-hidden="true">◎</span> Global</button>
        <p class="side-label">Gestionar</p>
        <button class="side-item" disabled><span aria-hidden="true">☷</span> Por revisar</button>
        <button class="side-item side-item--active"><span aria-hidden="true">⌘</span> Carpetas</button>
        <div class="local-note"><span aria-hidden="true"></span><div>Solo en este equipo<small>Sin cuenta ni nube</small></div></div>
      </aside>
      <section class="baseline-main" aria-labelledby="baseline-title">
        <p class="section-kicker">Primer uso</p>
        <h1 id="baseline-title">Carpetas de skills</h1>
        <p class="surface-description">Revisa las ubicaciones propuestas. Skill Forge no iniciará el primer escaneo hasta guardar tu aprobación.</p>
        <form class="root-card" data-root-form>
          <fieldset>
            <legend>Ubicaciones que Skill Forge puede observar</legend>
            <div class="root-list">${roots.map(rootRow).join("")}</div>
          </fieldset>
          <footer>
            <div><button type="button" class="quiet-button" data-add-folder>Añadir carpeta…</button><button type="button" class="quiet-button" data-add-project>Añadir proyecto Codex…</button></div>
            <button class="metal-button" type="submit" data-scan>Escanear carpetas aprobadas</button>
          </footer>
        </form>
        <p class="safety-note"><span aria-hidden="true">✓</span> La carpeta se elige mediante el diálogo del sistema. Skill Forge nunca solicita privilegios de administrador.</p>
        <p class="locked-note" role="status">El inventario permanece bloqueado hasta guardar al menos una ubicación.</p>
      </section>
      <aside class="inspector">
        <strong>Ninguna skill seleccionada</strong>
        <p>Selecciona una skill del inventario para revisar su origen, ubicación y evidencia disponible.</p>
      </aside>
    </div>`;
}

export const actualVariant = {
  render: onboardingMarkup,
  setup(root) {
    let extraRoots = [];

    const bind = () => {
      const form = root.querySelector("[data-root-form]");
      const scan = root.querySelector("[data-scan]");
      const checkboxes = [...root.querySelectorAll('.root-option input[type="checkbox"]')];
      const updateSubmit = () => { scan.disabled = !checkboxes.some((checkbox) => checkbox.checked); };
      checkboxes.forEach((checkbox) => checkbox.addEventListener("change", updateSubmit));
      updateSubmit();

      root.querySelector("[data-add-folder]")?.addEventListener("click", () => {
        if (!extraRoots.some((item) => item.id === "folder")) {
          extraRoots = [...extraRoots, { id: "folder", name: "Carpeta personal", path: "/Users/roberto/Documents/agent-skills", evidence: "user-approved" }];
          root.innerHTML = onboardingMarkup(extraRoots);
          bind();
        }
      });
      root.querySelector("[data-add-project]")?.addEventListener("click", () => {
        if (!extraRoots.some((item) => item.id === "project")) {
          extraRoots = [...extraRoots, { id: "project", name: "Codex · Acme Web", path: "/Users/roberto/Projects/acme-web/.agents/skills" }];
          root.innerHTML = onboardingMarkup(extraRoots);
          bind();
        }
      });
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        scan.disabled = true;
        scan.textContent = "Escaneando…";
        window.setTimeout(() => {
          root.innerHTML = dashboardMarkup(initialSelection(), "Primer escaneo completado");
          setupDashboard(root);
        }, 450);
      });
    };

    bind();
  },
};
