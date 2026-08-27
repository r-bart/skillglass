import { dashboardMarkup, setupDashboard } from "../dashboard.js";
import { initialSelection, skills, tourSlides } from "../data.js";

function previewList(selected, compact = false) {
  const previewSkills = compact ? skills.slice(0, 5) : skills;
  return `
    <div class="context-inventory ${compact ? "context-inventory--compact" : ""}">
      <header><span>Inventario</span><small>${skills.length} instalaciones detectadas</small></header>
      <ul>${previewSkills.map((skill) => `
        <li>
          <span class="skill-tile skill-tile--${skill.tone}" aria-hidden="true">${skill.glyph}</span>
          <span><strong>${skill.name}</strong><small>${skill.description}</small></span>
          ${selected.has(skill.id) ? '<i class="watch-dot" aria-label="Monitorizada">◉</i>' : '<i class="idle-dot" aria-label="Sin seguimiento">•</i>'}
        </li>`).join("")}</ul>
      ${compact ? `<p class="preview-more">+ ${skills.length - previewSkills.length} más</p>` : ""}
    </div>`;
}

function visualForSlide(index) {
  if (index === 0) return `
    <div class="context-visual context-visual--scan" role="img" aria-label="Dos carpetas aprobadas alimentan un inventario local">
      <div class="folder-stack"><span><i aria-hidden="true">□</i><b>Global</b><small>~/.agents/skills</small></span><span><i aria-hidden="true">□</i><b>Acme Web</b><small>project/.agents/skills</small></span></div>
      <div class="scan-line"><i></i><b>Solo lectura</b><i></i></div>
      <div class="local-vault"><span class="brand-mark">S</span><div><b>Inventario local</b><small>8 skills detectadas</small></div></div>
    </div>`;
  if (index === 1) return `
    <div class="context-visual context-visual--evidence" role="img" aria-label="Comparación entre datos observados y datos desconocidos">
      <div><span class="status-pill status-pill--ok">• Observed</span><b>Ruta canónica</b><code>/Users/roberto/.agents/skills/security-review</code></div>
      <div><span class="status-pill status-pill--ok">• Derived</span><b>Ámbito efectivo</b><p>Global · disponible en 2 proyectos</p></div>
      <div><span class="status-pill status-pill--idle">• Sin datos</span><b>Último uso</b><p>Forge no inventa telemetría.</p></div>
    </div>`;
  return `
    <div class="context-visual context-visual--create" role="img" aria-label="Un flujo de trabajo convertido en una nueva skill">
      <div class="workflow-card"><span>Trabajo recurrente</span><b>Preparar cada release sin olvidar riesgos, pruebas ni notas.</b><small>Tu proceso, explicado una vez</small></div>
      <span class="create-arrow" aria-hidden="true">→</span>
      <div class="blueprint-card"><header><span class="skill-tile skill-tile--green">■</span><div><b>release-checklist</b><small>Nueva skill · Acme Web</small></div></header><code>SKILL.md</code><p>1. Revisa los cambios<br />2. Señala riesgos<br />3. Prepara las notas</p><footer><span class="status-pill status-pill--ok">✓ Lista para crear</span></footer></div>
    </div>`;
}

function tourContent(index) {
  const slide = tourSlides[index];
  return `
    <div class="context-tour onboard-enter" data-context-tour>
      <div class="context-copy">
        <p class="section-kicker">${index === 0 ? "Bienvenido a Skill Forge" : slide.eyebrow}</p>
        <h1>${slide.title}</h1>
        <p>${slide.copy}</p>
        <div class="context-slide-nav">
          <span><b>${String(index + 1).padStart(2, "0")}</b> / 03</span>
          <div>${tourSlides.map((item, slideIndex) => `<button type="button" data-context-slide="${slideIndex}" ${slideIndex === index ? 'aria-current="step"' : ""}><span>${item.eyebrow}</span><i></i></button>`).join("")}</div>
        </div>
      </div>
      ${visualForSlide(index)}
    </div>`;
}

function selectionContent(selected, query = "") {
  const normalized = query.toLocaleLowerCase("es");
  const visible = skills.filter((skill) => `${skill.name} ${skill.description} ${skill.scope}`.toLocaleLowerCase("es").includes(normalized));
  return `
    <form class="context-selection onboard-enter" data-context-form>
      <header><div><p class="section-kicker">Paso final</p><h1>Elige qué quieres seguir de cerca</h1><p>Estas skills quedarán destacadas para cambios de contenido, validez u origen. Las demás permanecen en el inventario.</p></div><span><b>${selected.size}</b> de ${skills.length}</span></header>
      <label class="selection-search context-search"><span aria-hidden="true">⌕</span><span class="sr-only">Buscar skills</span><input data-context-search type="search" value="${query}" placeholder="Buscar skills detectadas" autocomplete="off" spellcheck="false" /></label>
      <div class="context-skill-grid">
        ${visible.map((skill) => `
          <label class="context-skill-card">
            <input type="checkbox" value="${skill.id}" ${selected.has(skill.id) ? "checked" : ""} />
            <span class="skill-tile skill-tile--${skill.tone}" aria-hidden="true">${skill.glyph}</span>
            <span><strong>${skill.name}</strong><small>${skill.scope}</small></span>
            <i aria-hidden="true">✓</i>
          </label>`).join("")}
      </div>
      ${visible.length === 0 ? '<p class="selection-empty">No hay skills que coincidan con esa búsqueda.</p>' : ""}
    </form>`;
}

function contextShell({ phase, slide, selected, query = "" }) {
  const isTour = phase === "tour";
  return `
    <div class="forge-shell context-shell">
      <header class="topbar context-topbar">
        <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="brand"><span class="brand-mark">S</span><span>Skill Forge</span><i></i><small>Configurar</small></div>
        <div class="context-stepper" aria-label="Progreso"><span class="done">1</span><i></i><span class="${isTour ? "active" : "done"}">2</span><i></i><span class="${isTour ? "" : "active"}">3</span><small>${isTour ? "Cómo funciona" : "Qué monitorizar"}</small></div>
        <span class="privacy-chip"><i aria-hidden="true"></i> Local y privado</span>
      </header>
      <aside class="context-sidebar">
        <span class="context-orb" aria-hidden="true"><b>S</b><i></i></span>
        <div><p class="section-kicker">Tu espacio de skills</p><h2>Entiende lo que tienes. Crea lo que te falta.</h2><p>Forge reúne tus skills, te deja explorarlas en detalle y te ayuda a convertir procesos repetidos en nuevas herramientas.</p></div>
        <dl><div><dt>Ubicaciones aprobadas</dt><dd>2</dd></div><div><dt>Skills detectadas</dt><dd>${skills.length}</dd></div><div><dt>Escrituras realizadas</dt><dd>0</dd></div></dl>
        <p class="context-safety"><span aria-hidden="true">✓</span> Puedes cambiar estas preferencias después desde Carpetas.</p>
      </aside>
      <main class="context-main" aria-label="Configurar Skill Forge">
        ${isTour ? tourContent(slide) : selectionContent(selected, query)}
        <footer class="context-footer">
          <button type="button" class="text-button" data-context-back>${isTour ? (slide === 0 ? "Ahora no" : "Anterior") : "Volver a la explicación"}</button>
          <div>
            ${isTour ? '<button type="button" class="quiet-button" data-context-skip>Saltar</button>' : `<span>${selected.size} ${selected.size === 1 ? "skill monitorizada" : "skills monitorizadas"}</span>`}
            <button type="button" class="metal-button" data-context-next ${!isTour && selected.size === 0 ? "disabled" : ""}>${isTour ? (slide === tourSlides.length - 1 ? "Elegir skills" : "Siguiente") : "Abrir mi dashboard"}</button>
          </div>
        </footer>
      </main>
      <aside class="context-preview" aria-label="Vista previa del inventario">
        <div class="preview-heading"><span>Tu dashboard</span><i>Vista previa</i></div>
        ${previewList(selected, true)}
        <div class="preview-watch"><span><i aria-hidden="true">◉</i><b>${selected.size}</b></span><p>Skills bajo seguimiento<small>Cambios, validez y origen</small></p></div>
      </aside>
    </div>`;
}

export const contextVariant = {
  render() { return contextShell({ phase: "tour", slide: 0, selected: initialSelection() }); },
  setup(root) {
    let phase = "tour";
    let slide = 0;
    let selected = initialSelection();
    let query = "";

    const render = () => {
      root.innerHTML = contextShell({ phase, slide, selected, query });
      bind();
      if (phase === "select" && query) {
        const input = root.querySelector("[data-context-search]");
        input?.focus();
        input?.setSelectionRange(query.length, query.length);
      }
    };

    const bind = () => {
      root.querySelectorAll("[data-context-slide]").forEach((button) => button.addEventListener("click", () => {
        slide = Number(button.dataset.contextSlide);
        render();
      }));
      root.querySelector("[data-context-skip]")?.addEventListener("click", () => { phase = "select"; render(); });
      root.querySelector("[data-context-back]")?.addEventListener("click", () => {
        if (phase === "select") { phase = "tour"; slide = tourSlides.length - 1; render(); }
        else if (slide > 0) { slide -= 1; render(); }
      });
      root.querySelector("[data-context-next]")?.addEventListener("click", () => {
        if (phase === "tour" && slide < tourSlides.length - 1) { slide += 1; render(); }
        else if (phase === "tour") { phase = "select"; render(); }
        else {
          root.innerHTML = dashboardMarkup(selected, "Dashboard preparado");
          setupDashboard(root);
        }
      });
      root.querySelectorAll('.context-skill-card input[type="checkbox"]').forEach((input) => input.addEventListener("change", () => {
        if (input.checked) selected.add(input.value);
        else selected.delete(input.value);
        render();
      }));
      root.querySelector("[data-context-search]")?.addEventListener("input", (event) => {
        query = event.currentTarget.value;
        render();
      });
    };

    bind();
  },
};
