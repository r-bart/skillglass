# Forge — Handoff

Gestor de escritorio (macOS) para ver, organizar y editar las skills instaladas
globalmente y por proyecto. Prototipo de alta fidelidad, no código de producción.

Archivos del proyecto:

- `App.dc.html` — el prototipo. Única fuente de verdad. ~132 KB, un solo Design Component.
- `Breadboard.dc.html` — breadboarding original (lugares, affordances, conexiones).
- `Design System.dc.html` — muestrario de tokens y componentes.
- `support.js` — runtime, generado. No tocar.

---

## 1. Qué es y para quién

Un desarrollador acumula skills: propias, instaladas de un registro público
(`skills.sh`), heredadas de paquetes, repartidas entre una carpeta global y varios
proyectos. El problema real no es instalarlas, es **saber qué tiene, qué está activo,
qué se disparó y qué sobra**. La app responde a eso.

Modelo mental: **ámbito → skill → versión**. Global se hereda; el proyecto puede
sombrear. Todo lo demás (paquete, autor, capacidad) son ejes de agrupación, no
jerarquía.

## 2. Decisiones de producto (con su racional)

**Solo skills.** El prototipo tuvo MCPs y plugins como entidades de primera clase.
Se eliminaron: mezclaban dos modelos de permisos y dos ciclos de vida en la misma
lista, y la mitad de la interfaz existía para explicar la diferencia. Si vuelven los
MCPs, deben ser una sección aparte, no filas de la misma tabla.

**Bifurcación al editar.** Editar una skill que gestiona un paquete crea una copia
local que la sombrea. El paquete sigue actualizándose pero ya no la sobrescribe: se
ofrece rebasar. Alternativa descartada: bloquear la edición (obliga a copiar a mano)
o dejar que el paquete gane (pierde el trabajo del usuario sin avisar).

**Activar / desactivar antes que eliminar.** Es la acción más frecuente del día. Un
interruptor por fila y en el inspector; el diálogo de borrado ofrece "Desactivar en su
lugar". Eliminar borra del disco y avisa de las skills que quedan con dependencia
rota.

**El grafo escala solo, sin control de usuario.** ≤12 skills: radial con todas las
etiquetas. Más: racimos por capacidad, colapsables, con el resto en órbita atenuada.
El selector "8 / 20 / 60 skills" que existía era andamiaje de demo filtrado a la
interfaz; se eliminó.

**Dos vistas, no tres.** Lista y Grafo. La rejilla decía lo mismo que la lista con
menos información por píxel.

**Un solo punto de creación.** Un botón "Nueva skill ▾" en la topbar con cuatro
salidas (blanco / describir y generar / instalar desde URL / buscar en skills.sh).
Antes había dos entradas duplicadas con nombres distintos.

**Autor y paquete son ejes distintos.** El autor es quién la escribió; el paquete es
la unidad que instalas, actualizas y desinstalas en bloque. Agrupar por paquete
muestra "se instala y actualiza en bloque" en la cabecera; las sueltas caen en "sin
paquete" y se actualizan una a una. No se han apilado como tarjeta-contenedor: eso
convertiría el paquete en objeto navegable, y esa es una decisión de producto abierta
(ver §9).

**Un solo lenguaje de selección: cristal.** Fondo translúcido, borde claro, sombra
interior. Nada de azul de acento para seleccionar; el azul quedó solo donde marca
foco de edición (bordes de campo activo).

**Cada acción destructiva o masiva deja un toast con Deshacer** que restaura el estado
anterior de verdad, no un mensaje decorativo.

## 3. Sistema visual (valores exactos, cópialos)

```
Fondo app       #0b0b0d      Topbar #101013     Sidebar #0e0e11
Superficie      #131317 / #111115 (hojas) / #0d0d10 (campos hundidos)
Texto           #f4f4f6  ·  secundario rgba(244,244,246,.5)  ·  terciario .34
Bordes          .5px solid rgba(255,255,255,.06 → .16)
Radios          fila 11px · tarjeta 12px · hoja 14px · pill 999px
Salud           ok oklch(.72 .15 152) · stale oklch(.78 .15 82)
                broken oklch(.62 .19 26) · idle #3a3a42
Botón metálico  linear-gradient(180deg,#fefefe,#f0f0f2 44%,#d5d5d9 53%,#c4c4c9)
                + inset 0 1px 0 rgba(255,255,255,.95), texto #141417
Botón oscuro    linear-gradient(180deg,#43434c,#2e2e35 45%,#1f1f25 54%,#28282f)
Cristal (sel.)  linear-gradient(180deg,rgba(255,255,255,.115),rgba(255,255,255,.05))
                + backdrop-filter blur(16px) saturate(1.6) + borde .17
Easing          cubic-bezier(.32,.72,0,1) · 140ms hover, 180–260ms estado, 420ms grafo
Tipografía      -apple-system / SF Pro Text; monospace ui-monospace, Menlo
                etiquetas de campo: 9.5px, 600, letter-spacing .11em, uppercase
```

Constantes en la lógica: `HEALTH`, `TILE`, `GLYPH`, `BTN_METAL`, `BTN_DARK`,
`BTN_DANGER`, `PILL_OFF`.

## 4. Arquitectura del archivo

`App.dc.html` es un Design Component: plantilla + una clase de lógica.

- **Plantilla** (entre `<x-dc>` y `</x-dc>`): solo estilos inline. Sin clases CSS, sin
  hojas de estilo. `<helmet>` arriba con reset del body y el keyframe `halo`.
- **Lógica** (`<script type="text/x-dc" data-dc-script>`): `class Component extends
  DCLogic`, con `renderVals()` devolviendo todo lo que la plantilla consume.
- Los huecos `{{ x }}` son **rutas, no expresiones**. Cualquier ternario, `.map` o
  comparación va en `renderVals()` y se expone con nombre.
- `sc-for` / `sc-if` para repetición y condicionales; llevan `hint-placeholder-count` /
  `hint-placeholder-val` para pintar mientras el archivo se transmite.

Editar con `dc_html_str_replace` (plantilla) y `dc_js_str_replace` (lógica). Para
tandas mecánicas, `run_script` + `replaceText`. **No** reescribir con `write_file`.

Ventana fija de 1420×892 dentro de un marco con semáforos macOS.

## 5. Estado

```js
{
  view: 'list' | 'graph',
  scope: 'global' | 'acme-web' | 'ledger' | 'infra' | 'docs' | 'sandbox',
  nav: 'inventory' | 'pending' | 'discover',
  sheet: null | 'palette' | 'diff' | 'install' | 'generate' | 'edit' | 'history'
       | 'move' | 'delete' | 'engines' | 'log' | 'dupe',
  selId, many[],            // selección simple / múltiple (⌘ o shift + clic)
  query, health, author, pkg,  // filtros; se muestran como chips retirables
  groupBy: 'none' | 'author' | 'pkg',  collapsed[],
  off[],                    // ids desactivados
  extra[], gone[],          // duplicados creados / eliminados
  toast: { text, prev },    // prev = fragmento de estado que restaura Deshacer
  forked[], checked[], moveMode, moveTarget, wizStep, expanded, dry, menuOpen, newOpen, pq
}
```

Funciones clave de la clase:

- `pool()` — POOL + duplicados − eliminados.
- `inScope(item, scopeId)` — Global lo ve todo; un proyecto ve lo propio más lo
  global marcado `shared`. Un ámbito con `inherits: false` (sandbox) no hereda nada:
  así existe un proyecto vacío de verdad y el estado vacío es alcanzable.
- `visible()` — ámbito + query + salud + autor + paquete.
- `toggleOff(id)`, `duplicate()`, `note(text, prev)`.
- `graph()` — decide radial o racimos y devuelve `{nodes, edges, hint}`.
- `nodeVals(o)` / `edge(...)` — geometría y estilos de nodo/arista.
- `rowStyle`, `badgeStyle`, `navStyle`, `switchStyle`, `knobStyle`.
- `mkRow(item)` dentro de `renderVals()`; `rowList` mezcla cabeceras de grupo
  (`isHeader`) y filas (`isItem`) en una sola lista.

Teclado (en `componentDidMount`): `⌘K` paleta · `⌘F` foco en el filtro · `⌘E` o `↵`
editar · `⌘D` duplicar · `⌫` eliminar · `esc` cierra hoja / limpia búsqueda / deselecciona.

## 6. Forma del dato

```js
{
  id, name, desc, version: 'v2.4',
  health: 'ok' | 'stale' | 'broken' | 'idle',
  badge: '6 proy.' | 'v2.4 → v3.0' | 'Dependencia ausente' | 'sin usar 74 d',
  scope: 'global' | '<proyecto>',
  shared: bool,          // si un proyecto la hereda de Global
  origin: 'local' | 'skills.sh · mit',
  author: '@acme' | 'tú',
  pkg: 'acme-toolkit' | null,
  cap: 'código'|'datos'|'diseño'|'infra'|'docs'|'release',   // agrupa el grafo
  tile: 'blue'|'green'|'amber'|'plum'|'steel',  glyph: 'ring'|'block'|'bar'|'dot'|'dash',
  meta: [ [clave, valor, tipoDeEnlace?] ]   // tipo: 'scopes' | 'deps' | 'log' | 'author' | 'pkg'
}
```

`POOL = buildSet(20)`: 9 escritas a mano + 11 generadas por `genItem(i)` de forma
determinista. Las filas de `meta` con tercer elemento son navegables desde el
inspector.

Otros datos: `PENDING` (4 grupos por causa), `REGISTRY` (9 del registro),
`ENGINES`, `CHECKLIST`, `DIFF_BEFORE/AFTER`, `PALETTE_LOCAL/REMOTE`, `HISTORY`,
`TRIGGER_LOG`, `DUPE`.

## 7. Breadboarding — lugares, affordances, conexiones

**Inventario** (lugar principal)
: filtro real · píldoras de salud clicables · chips de filtro activo · Lista/Grafo ·
  Agrupar (ninguno/autor/paquete) · fila: interruptor, insignia, versión · ⌘+clic
  selección múltiple → barra de acciones en lote · toast con Deshacer
→ Inspector, Editor, Grafo, Mover, Eliminar, Registro

**Inspector** (persistente, 326px, se colapsa sin selección)
: interruptor y estado · descripción · metadatos con filas navegables (autor,
  paquete, activa en, depende de, permisos, último uso, precedencia) · acción
  primaria según salud · Editar · menú "…"
→ Editor, Historial, Registro, Mover, Eliminar, Duplicar, Grafo

**Grafo**
: radial ≤12 · racimos por capacidad, colapsables · nodo seleccionado en cristal ·
  desactivadas con borde discontinuo · pie con lectura del layout y huérfanas/rotas
→ Inspector

**Pendientes** (agrupado por causa, no por tipo)
: Desactualizadas → Ver diff · Rotas → Reparar · Duplicadas → Resolver ·
  Sin usar → Desactivar · casillas + "Actualizar N seleccionadas"
→ Diff, Instalar, Duplicados

**Descubrir** (skills.sh, cruzado con lo que ya tienes)
: Instalar / Abrir / Ver diff / Bifurcar
→ Instalar, Diff, Editor

**Hojas**: Paleta (⌘K, busca por lo que hace) · Diff (antes/después, proyectos
afectados, reversible 90 días) · Instalar (URL o ruta, ámbito, qué declara) ·
Nueva skill (asistente de 3 pasos) · Editor (campos, cuerpo, prueba en seco,
linaje, buenas prácticas) · Historial (versiones locales con etiqueta tú/IA/rebase/fork) ·
Mover o copiar · Eliminar (con "Desactivar en su lugar") · Registro de disparos ·
Duplicados (precedencia y fusión) · Motores y claves.

## 8. Hecho en esta revisión

Eliminado: Auditoría, sección Plugins del sidebar, vista Rejilla, selector de
densidad, tres chips muertos, botón "…" inerte, doble entrada de creación, todo
MCP en los datos.

Añadido: interruptor por fila y en inspector · filtro real en la topbar · píldoras
de salud como filtro (ocultas si su cuenta es 0) · chips de filtro activo ·
selección múltiple y barra de acciones en lote · toast con Deshacer real · tres
estados vacíos · registro de disparos con motivo de omisión · resolución de
duplicados con precedencia · salida real de "Probar en seco" · teclado completo ·
agrupación por autor y por paquete con cabeceras colapsables y "ver solo".

Corregido: Duplicar duplica · retención coherente (90 días) · asistente 4→3 pasos
sin selector de modelo · selección siempre en cristal · metadatos del inspector
navegables · `sandbox` no hereda, así el estado vacío es alcanzable.

## 9. Pendiente, en orden de valor

1. **¿El paquete es un objeto navegable?** Si se instala, actualiza y desinstala en
   bloque, merece pila o pantalla propia y el sidebar vuelve como agrupación (no como
   navegación). Decisión de producto, no de vista. Hoy es solo un eje de agrupación.
2. **Solapamiento de disparadores.** El registro ya dice "omitida · disparador
   solapado", pero no hay pantalla para verlos ni resolverlos.
3. **Rebase real.** El editor promete "se te ofrecerá rebasar"; no existe el flujo.
4. **Sombreado explícito.** El inspector informa de la precedencia; falta la acción
   "sombrear aquí" que crea la copia en el proyecto.
5. **Onboarding / primer arranque.** Falta el estado de app recién instalada
   (detectar carpetas, importar lo existente).
6. **Acciones en lote incompletas.** Activar, desactivar, mover y eliminar están;
   actualizar en lote no.
7. **Ordenación de la lista** (por uso, por nombre, por versión). Se quitó el chip
   falso; no se ha repuesto el real.
8. **Detalles del registro**: hoy son 6 filas fijas y no dependen de la skill
   seleccionada.

## 10. Cómo seguir sin romper nada

- La plantilla no lleva CSS en clases. Estilos inline, siempre.
- Nada de expresiones en `{{ }}`. Si necesitas lógica, va a `renderVals()`.
- No metas layout en `React.createElement`: el editor no puede entrar ahí.
- Todo `sc-for` y `sc-if` con su `hint-*`.
- Copia en español de España, matter-of-fact, sin signos de exclamación ni emoji.
  Nombres de skill en kebab-case y en monospace.
- Cualquier acción que destruya o cambie muchas cosas deja `toast: {text, prev}` con
  el fragmento de estado que la deshace.
- Antes de añadir una pantalla, comprueba que no exista ya como hoja: hay once.
