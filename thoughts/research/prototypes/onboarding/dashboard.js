import { skills } from "./data.js";

function skillRow(skill, monitored) {
  return `
    <li class="inventory-row" data-skill-row data-search="${skill.name} ${skill.description} ${skill.scope}">
      <span class="row-dot" aria-hidden="true"></span>
      <span class="skill-tile skill-tile--${skill.tone}" aria-hidden="true">${skill.glyph}</span>
      <span class="inventory-copy">
        <span class="inventory-name">${skill.name}</span>
        <span class="inventory-scope">${skill.scope}</span>
        <span class="inventory-description">${skill.description}</span>
      </span>
      <span class="status-pill ${skill.status === "Inválida" ? "status-pill--danger" : skill.status === "Advertencia" ? "status-pill--warning" : "status-pill--ok"}">
        <span aria-hidden="true">•</span> ${skill.status}
      </span>
      ${monitored ? '<span class="watch-pill"><span aria-hidden="true">◉</span> En seguimiento</span>' : '<span class="status-pill status-pill--idle">Sin seguimiento</span>'}
    </li>`;
}

export function dashboardMarkup(selected, message = "Onboarding completado") {
  const count = selected.size;
  return `
    <div class="forge-shell forge-shell--dashboard" data-dashboard>
      <header class="topbar">
        <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="brand"><span class="brand-mark">S</span><span>Skill Forge</span><i></i><small>Inventario</small></div>
        <label class="search-shell">
          <span aria-hidden="true">⌕</span>
          <span class="sr-only">Filtrar skills</span>
          <input data-dashboard-search type="search" placeholder="Filtrar por nombre o descripción" autocomplete="off" spellcheck="false" />
          <kbd>⌘F</kbd>
        </label>
        <div class="top-actions"><button class="quiet-button">Por revisar</button><button class="metal-button">Instalar⌄</button></div>
      </header>
      <aside class="sidebar">
        <p class="side-label">Biblioteca</p>
        <button class="side-item side-item--active"><span aria-hidden="true">⌘</span> Todas las skills</button>
        <p class="side-label">Ubicaciones</p>
        <button class="side-item"><span aria-hidden="true">◎</span> Global</button>
        <button class="side-item"><span aria-hidden="true">□</span> Acme Web</button>
        <p class="side-label">Gestionar</p>
        <button class="side-item"><span aria-hidden="true">☷</span> Por revisar <b>1</b></button>
        <button class="side-item"><span aria-hidden="true">⌘</span> Carpetas</button>
        <div class="local-note"><span aria-hidden="true"></span><div>Solo en este equipo<small>Sin cuenta ni nube</small></div></div>
      </aside>
      <section class="dashboard-main" aria-labelledby="inventory-title">
        <div class="completion-toast" role="status"><span aria-hidden="true">✓</span><span><strong>${message}</strong>${count} ${count === 1 ? "skill bajo seguimiento" : "skills bajo seguimiento"}. El resto sigue visible en el inventario.</span></div>
        <p class="section-kicker">Skills observadas</p>
        <h1 id="inventory-title">Inventario</h1>
        <p class="surface-description">Instalaciones y evidencia observada en los ámbitos aprobados.</p>
        <div class="inventory-toolbar"><span><b data-visible-count>${skills.length}</b> instalaciones</span><button class="quiet-button">Nombre A–Z⌄</button><button class="quiet-button">Sin agrupar⌄</button><button class="quiet-button">☷ Filtros</button></div>
        <ul class="inventory-list">${skills.map((skill) => skillRow(skill, selected.has(skill.id))).join("")}</ul>
        <p class="dashboard-empty" data-dashboard-empty hidden>No hay skills que coincidan con ese filtro.</p>
      </section>
      <aside class="inspector">
        <strong>Ninguna skill seleccionada</strong>
        <p>Selecciona una skill del inventario para revisar su origen, ubicación y evidencia disponible.</p>
      </aside>
    </div>`;
}

export function setupDashboard(root) {
  const input = root.querySelector("[data-dashboard-search]");
  const rows = [...root.querySelectorAll("[data-skill-row]")];
  const count = root.querySelector("[data-visible-count]");
  const empty = root.querySelector("[data-dashboard-empty]");
  input?.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase("es");
    let visible = 0;
    rows.forEach((row) => {
      const matches = row.dataset.search.toLocaleLowerCase("es").includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    if (count) count.textContent = String(visible);
    if (empty) empty.hidden = visible !== 0;
  });
}
