import { dashboardMarkup, setupDashboard } from "../dashboard.js";
import { initialSelection, skills, tourSlides } from "../data.js";

const projects = [...new Set(skills.filter((skill) => skill.scope !== "Global").map((skill) => skill.scope))];
const globalSkills = skills.filter((skill) => skill.scope === "Global");

function miniVisual(kind) {
  if (kind === "inventory") return `
    <div class="tour-visual tour-visual--inventory" role="img" aria-label="Varias skills de distintos proyectos reunidas en una lista">
      <div class="visual-source"><span>Global</span><i></i><i></i><i></i></div>
      <div class="visual-flow" aria-hidden="true">→</div>
      <div class="visual-inventory"><b>Inventario</b><span><i class="skill-tile skill-tile--blue">I</i> accessibility-audit</span><span><i class="skill-tile skill-tile--green">•</i> api-contract-review</span><span><i class="skill-tile skill-tile--plum">■</i> broken-frontmatter</span></div>
      <div class="visual-source"><span>Acme Web</span><i></i><i></i></div>
    </div>`;
  if (kind === "evidence") return `
    <div class="tour-visual tour-visual--evidence" role="img" aria-label="Ficha de una skill con origen, ámbito y validez observada">
      <span class="skill-tile skill-tile--blue tour-big-tile">I</span>
      <div><b>accessibility-audit</b><p>Revisa navegación por teclado, foco y contraste.</p><dl><dt>Validez</dt><dd><i class="status-pill status-pill--ok">• Válida</i></dd><dt>Ámbito</dt><dd>Global</dd><dt>Origen</dt><dd>Carpeta local</dd></dl></div>
    </div>`;
  return `
    <div class="tour-visual tour-visual--create" role="img" aria-label="Un flujo de trabajo repetido convertido en una nueva skill">
      <div class="create-brief"><span>Flujo que repites</span><b>“Antes de cada release, revisa cambios, riesgos y notas.”</b></div>
      <span class="create-arrow" aria-hidden="true">→</span>
      <div class="skill-draft"><header><span class="skill-tile skill-tile--green">■</span><div><b>release-checklist</b><small>Nueva skill · Acme Web</small></div></header><code>name: release-checklist</code><p>Comprueba cambios, riesgos y notas antes de publicar.</p><footer><span>SKILL.md</span><button class="metal-button" tabindex="-1">Crear skill</button></footer></div>
    </div>`;
}

function chrome(inner, step) {
  return `
    <div class="focus-shell">
      <header class="focus-topbar">
        <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="brand"><span class="brand-mark">S</span><span>Skill Forge</span></div>
        <span class="privacy-chip"><i aria-hidden="true"></i> Todo permanece en este equipo</span>
      </header>
      <section class="focus-stage" data-focus-stage>${inner}</section>
      <p class="focus-progress" aria-label="Progreso del onboarding">${step}</p>
    </div>`;
}

function tourMarkup(slideIndex) {
  const slide = tourSlides[slideIndex];
  return chrome(`
    <div class="focus-card focus-card--tour onboard-enter" data-tour-index="${slideIndex}">
      <div class="focus-copy">
        <span class="welcome-mark" aria-hidden="true"><i></i><b>S</b></span>
        <p class="section-kicker">${slideIndex === 0 ? "Bienvenido a Skill Forge" : slide.eyebrow}</p>
        <h1>${slide.title}</h1>
        <p>${slide.copy}</p>
        <div class="tour-dots" role="group" aria-label="Pasos de introducción">
          ${tourSlides.map((_, index) => `<button type="button" data-slide="${index}" aria-label="Ir a la explicación ${index + 1}" ${index === slideIndex ? 'aria-current="step"' : ""}><span></span></button>`).join("")}
        </div>
      </div>
      <div class="focus-visual">${miniVisual(slide.visual)}</div>
      <footer class="focus-footer">
        <button type="button" class="text-button" data-skip>Saltar explicación</button>
        <div>
          ${slideIndex === 0 ? "" : '<button type="button" class="quiet-button" data-previous>Anterior</button>'}
          <button type="button" class="metal-button" data-next>${slideIndex === tourSlides.length - 1 ? "Elegir mis skills" : "Continuar"}</button>
        </div>
      </footer>
    </div>`, `Explicación ${slideIndex + 1} de ${tourSlides.length}`);
}

function skillChoiceRow(skill, selected) {
  return `
    <label class="monitor-row" data-skill-option data-scope="${skill.scope}" data-search="${skill.name} ${skill.description} ${skill.scope}">
      <input type="checkbox" value="${skill.id}" ${selected ? "checked" : ""} />
      <span class="skill-tile skill-tile--${skill.tone}" aria-hidden="true">${skill.glyph}</span>
      <span class="monitor-copy"><strong>${skill.name}</strong><small>${skill.description}</small><code>${skill.scope} · ${skill.source}</code></span>
      <span class="monitor-check" aria-hidden="true">✓</span>
    </label>`;
}

function selectionMarkup(selected) {
  return chrome(`
    <form class="focus-card focus-card--selection onboard-enter" data-selection-form>
      <header class="selection-header">
        <div><p class="section-kicker">Personaliza tu inventario</p><h1>Elige las skills que quieres seguir de cerca.</h1><p>Forge destacará cambios en su contenido, validez y origen. Solo observa archivos locales: nunca ejecuciones ni conversaciones.</p></div>
        <span class="selection-count"><b data-selection-count>${selected.size}</b><small>bajo seguimiento</small></span>
      </header>
      <section class="selection-scope" aria-labelledby="selection-scope-label">
        <div class="selection-scope__copy"><span id="selection-scope-label">Mostrar skills de</span><small data-scope-caption>Todas las ubicaciones</small></div>
        <div class="scope-controls">
          <button type="button" class="scope-choice" data-scope-choice="all" aria-pressed="true">Todas <b>${skills.length}</b></button>
          <button type="button" class="scope-choice" data-scope-choice="global" aria-pressed="false">Global <b>${globalSkills.length}</b></button>
          <label class="scope-project" data-project-control>
            <span class="sr-only">Filtrar por proyecto</span>
            <select data-project-scope aria-label="Filtrar por proyecto">
              <option value="" selected disabled>Proyecto…</option>
              ${projects.map((project) => `<option value="${project}">${project} · ${skills.filter((skill) => skill.scope === project).length}</option>`).join("")}
            </select>
            <i aria-hidden="true">⌄</i>
          </label>
        </div>
      </section>
      <div class="selection-tools">
        <label class="selection-search"><span aria-hidden="true">⌕</span><span class="sr-only">Buscar skills</span><input data-skill-search type="search" placeholder="Buscar en todas las ubicaciones" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore /></label>
        <button type="button" class="text-button" data-toggle-visible>Seleccionar las visibles</button>
      </div>
      <div class="monitor-list"><p class="selection-empty" data-selection-empty hidden><strong>No hay skills aquí.</strong><span>Prueba otro ámbito o borra la búsqueda.</span></p>${skills.map((skill) => skillChoiceRow(skill, selected.has(skill.id))).join("")}</div>
      <footer class="focus-footer selection-footer">
        <button type="button" class="quiet-button" data-back-tour>Volver</button>
        <div><span>Podrás cambiar esta selección desde el inventario.</span><button class="metal-button" type="submit" data-finish ${selected.size === 0 ? "disabled" : ""}>Abrir mi inventario</button></div>
      </footer>
    </form>`, "Configura tu inventario");
}

export const focusVariant = {
  render() { return tourMarkup(0); },
  setup(root) {
    let slide = 0;
    let selected = initialSelection();
    let scope = "all";
    let query = "";

    const showTour = (index) => {
      slide = Math.max(0, Math.min(tourSlides.length - 1, index));
      root.innerHTML = tourMarkup(slide);
      bindTour();
    };

    const showSelection = () => {
      root.innerHTML = selectionMarkup(selected);
      bindSelection();
    };

    const bindTour = () => {
      root.querySelectorAll("[data-slide]").forEach((button) => button.addEventListener("click", () => showTour(Number(button.dataset.slide))));
      root.querySelector("[data-previous]")?.addEventListener("click", () => showTour(slide - 1));
      root.querySelector("[data-next]")?.addEventListener("click", () => slide === tourSlides.length - 1 ? showSelection() : showTour(slide + 1));
      root.querySelector("[data-skip]")?.addEventListener("click", showSelection);
    };

    const bindSelection = () => {
      const count = root.querySelector("[data-selection-count]");
      const finish = root.querySelector("[data-finish]");
      const rows = [...root.querySelectorAll("[data-skill-option]")];
      const empty = root.querySelector("[data-selection-empty]");
      const search = root.querySelector("[data-skill-search]");
      const toggleVisible = root.querySelector("[data-toggle-visible]");
      const projectSelect = root.querySelector("[data-project-scope]");
      const projectControl = root.querySelector("[data-project-control]");
      const scopeCaption = root.querySelector("[data-scope-caption]");

      const visibleRows = () => rows.filter((row) => !row.hidden);

      const scopeLabel = () => {
        if (scope === "global") return "Global · instaladas en este equipo";
        if (scope.startsWith("project:")) return scope.slice("project:".length);
        return "Todas las ubicaciones";
      };

      const searchScopeLabel = () => {
        if (scope === "global") return "Global";
        if (scope.startsWith("project:")) return scope.slice("project:".length);
        return "todas las ubicaciones";
      };

      const applyFilters = () => {
        let visible = 0;
        rows.forEach((row) => {
          const matchesScope = scope === "all"
            || (scope === "global" && row.dataset.scope === "Global")
            || (scope.startsWith("project:") && row.dataset.scope === scope.slice("project:".length));
          const matchesQuery = row.dataset.search.toLocaleLowerCase("es").includes(query);
          const matches = matchesScope && matchesQuery;
          row.hidden = !matches;
          if (matches) visible += 1;
        });
        empty.hidden = visible !== 0;
        scopeCaption.textContent = scopeLabel();
        search.placeholder = `Buscar en ${searchScopeLabel()}`;
        root.querySelectorAll("[data-scope-choice]").forEach((button) => {
          button.setAttribute("aria-pressed", String(button.dataset.scopeChoice === scope));
        });
        projectControl.toggleAttribute("data-active", scope.startsWith("project:"));
        const rowsInView = visibleRows();
        toggleVisible.disabled = rowsInView.length === 0;
        toggleVisible.textContent = rowsInView.length > 0 && rowsInView.every((row) => selected.has(row.querySelector("input").value))
          ? "Quitar las visibles"
          : "Seleccionar las visibles";
      };

      const update = () => {
        count.textContent = String(selected.size);
        finish.disabled = selected.size === 0;
        finish.textContent = "Abrir mi inventario";
        applyFilters();
      };
      rows.forEach((row) => row.querySelector("input").addEventListener("change", (event) => {
        if (event.currentTarget.checked) selected.add(event.currentTarget.value);
        else selected.delete(event.currentTarget.value);
        update();
      }));
      search.addEventListener("input", (event) => {
        query = event.currentTarget.value.trim().toLocaleLowerCase("es");
        applyFilters();
      });
      root.querySelectorAll("[data-scope-choice]").forEach((button) => button.addEventListener("click", () => {
        scope = button.dataset.scopeChoice;
        projectSelect.value = "";
        applyFilters();
      }));
      projectSelect.addEventListener("change", (event) => {
        scope = `project:${event.currentTarget.value}`;
        applyFilters();
      });
      toggleVisible.addEventListener("click", () => {
        const rowsInView = visibleRows();
        const remove = rowsInView.every((row) => selected.has(row.querySelector("input").value));
        rowsInView.forEach((row) => {
          const input = row.querySelector("input");
          if (remove) selected.delete(input.value);
          else selected.add(input.value);
          input.checked = !remove;
        });
        update();
      });
      root.querySelector("[data-back-tour]")?.addEventListener("click", () => {
        scope = "all";
        query = "";
        showTour(tourSlides.length - 1);
      });
      root.querySelector("[data-selection-form]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        root.innerHTML = dashboardMarkup(selected, "Tu inventario está listo");
        setupDashboard(root);
      });
      update();
    };

    bindTour();
  },
};
