# Forge — Auditoría de fidelidad visual al handoff

**Fecha**: 2026-08-26  
**Estado**: Finalizada  
**Fuente visual**: `thoughts/handoff/App.dc.html`  
**Implementación revisada**: rama `codex/forge-mvp`

## Veredicto

La implementación actual conserva algunas ideas del handoff —tema oscuro, selección de cristal, pills y un inspector lateral en ventanas anchas—, pero no es una traducción 1:1 de sus estilos. La diferencia principal no está en detalles aislados: cambian la escala tipográfica, la densidad, los colores, el chrome, la jerarquía, la distribución de filtros, el tratamiento de filas, los botones y el comportamiento de la ventana.

La corrección no debería copiar el prototipo completo. `thoughts/PRODUCT.md` y las pruebas del MVP descartaron correctamente varias capacidades simuladas por el handoff. La meta adecuada es:

> Fidelidad visual 1:1 para las superficies y primitives que sí existen en el producto, conservando los contratos de comportamiento, evidencia, seguridad, accesibilidad y multiplataforma del MVP.

## Jerarquía de fuentes de verdad

1. `thoughts/PRODUCT.md`, `DOMAIN.md`, `ADAPTERS.md` y `OPERATIONS.md` mandan en comportamiento y contenido.
2. `thoughts/handoff/App.dc.html` manda en estilo, materiales, densidad y geometría de las superficies compartidas.
3. `thoughts/handoff/HANDOFF.md` documenta los valores visuales exactos y el racional del prototipo.
4. `Design System.dc.html` sirve como muestrario histórico, pero no puede reintroducir capacidades que contradigan el producto actual.
5. Accesibilidad, controles semánticos, resizing y convenciones nativas prevalecen sobre las técnicas del prototipo, que usa `div onClick`, layout fijo y controles macOS dibujados.

## Evidencia revisada

- Los 1.823 renglones de `App.dc.html` y sus estados de inventario, inspector, pendientes y hojas.
- Los valores exactos de `HANDOFF.md` y el muestrario `Design System.dc.html`.
- Los contratos de producto y la exclusión explícita de activación, borrado, grafo inferido, marketplace remoto, generación con IA y telemetría sintética.
- La implementación React de `App.ts`, `Inventory.ts`, `Inspector.ts`, `Pending.ts`, diálogos, diff y editor.
- Los 1.551 renglones de `styles.css` y su historial desde `5d765ed`.
- La configuración real de `BrowserWindow` y los breakpoints.
- Capturas ejecutadas del prototipo y de Forge con el fixture Electron aislado.
- Medidas DOM y estilos computados en 1180×728 y 1420×892.
- Cobertura actual de tests unitarios y E2E.

## Comparación cuantificada

| Aspecto | Handoff | Implementación actual | Impacto |
|---|---:|---:|---|
| Lienzo de referencia | 1420×892 | ventana 1180×760; contenido observado 1180×728 | La app abre en un modo que ya no conserva las tres columnas |
| Topbar | 46 px | 98,39 px a 1180; 79,39 px a 1420 | Las acciones se envuelven y duplican casi la altura |
| Sidebar | 226 px | 200 px a 1180; 216 px a 1420 | Cercana a 1420, distinta en la apertura real |
| Inspector | 326 px, lateral | debajo del contenido a 1180; 336 px a 1420 | La selección queda fuera del viewport inicial |
| Área central a 1420 | 868 px | 868 px | La base geométrica central ya coincide |
| Título de superficie | 22 px | 53,6 px | Cambia por completo la densidad y jerarquía |
| Fondo app | `#0b0b0d` | `oklch(.145 .012 275)` | El actual es más claro y violáceo |
| Acento | contextual por estado | amarillo global | El actual tiñe navegación, títulos y CTA sin estar en el handoff |
| Filas | 52 px, sin caja exterior | tabla en tarjeta, celdas de ~60 px | Menos escaneable y más genérica |
| Scroll | paneles internos; marco fijo | documento completo de 1361 px a la apertura | El chrome se desplaza y el inspector cae debajo |

Después del onboarding, la navegación al inventario conserva `scrollY = 51.5`; por eso la cabecera aparece cortada. No hay restablecimiento de scroll en `navigate` ni después de `approve`.

## Hallazgos

### Bloqueadores

1. **El chrome no coincide.** El handoff usa topbar compacta con búsqueda central, estado de pendientes y una acción principal; la app actual usa marca amarilla, contexto central y cuatro acciones grandes. A la anchura inicial, las acciones se envuelven.

2. **La ventana inicial activa el breakpoint equivocado.** `BrowserWindow` abre a 1180 px y el CSS apila el inspector en `max-width: 73.75rem`, exactamente 1180 px. El layout de referencia de tres paneles no existe en la primera impresión.

3. **El documento entero hace scroll.** En la ejecución medida, el body llega a 1361 px de alto en una ventana interior de 728 px. El handoff fija el marco y delega el overflow a lista, inspector y hojas.

4. **La escala tipográfica es incompatible.** El título actual de 53,6 px y la descripción de 16 px construyen una landing page; el handoff usa títulos de 22 px, cuerpo de 12–13,5 px y etiquetas mono de 9,5 px para una herramienta densa.

5. **Inventario y filtros tienen otra arquitectura visual.** Ocho selects visibles consumen la mayor parte del viewport. El handoff pone búsqueda en la topbar, filtros frecuentes como pills, filtros activos como chips y agrupación en un control compacto.

6. **Las filas perdieron la identidad del handoff.** Faltan el punto de estado, tile/glyph, jerarquía nombre–ámbito–descripción, badges contextuales, versión y selección de cristal con borde y sombra interior.

7. **El inspector no es persistente en la ventana de apertura.** Además de caer debajo del contenido, su composición actual usa tarjetas de estado y bloques largos en lugar de cabecera compacta, metadatos en filas y footer de acciones.

8. **Pendientes no conserva densidad ni jerarquía.** La implementación usa hero, tarjetas y botones rectangulares; el handoff agrupa por causa con encabezados mono, filas compactas, badges y acciones pill.

9. **Los diálogos tienen tokens sin definir.** `styles.css` usa `--radius`, `--shadow-large` y el fallback `--danger`, pero solo están definidos los radios `small/medium/large`; el radio y la sombra de `.operation-dialog` se invalidan en CSS.

10. **No existe una barrera de regresión visual.** No hay `toHaveScreenshot`, snapshots ni asserts geométricos. Los tests actuales validan semántica y negocio, no fidelidad visual.

### Advertencias

1. Los semáforos dibujados del prototipo no deben copiarse como HTML. El producto exige controles nativos o específicos del sistema operativo. Electron permite integrar el contenido con controles nativos mediante `titleBarStyle`, `titleBarOverlay` y `trafficLightPosition`.

2. El handoff es fijo a 1420×892; el producto debe seguir siendo redimensionable, usable a 760×520, con scaling, high contrast y reduced motion. El 1:1 debe tener un viewport canónico y variantes responsivas deliberadas.

3. No se deben restaurar grafo, Discover, interruptores de activación, eliminar/mover, URL remota, IA, telemetría de uso ni versiones inventadas. Son ejemplos visuales o capacidades expresamente fuera del MVP.

4. Los contenidos reales son más verbosos que los simulados: rutas, evidencia y planes necesitan truncado, wrapping y scroll internos sin romper la geometría.

5. Las capturas dependen de SO, fuentes, DPR y versión de Electron. Los goldens deben fijarse por plataforma y generarse en un entorno estable.

### Elementos que ya pasan

- Existe un sistema de variables CSS centralizado, aunque sus valores no coinciden.
- El centro mide 868 px a 1420, igual que el handoff con inspector abierto.
- La selección actual ya usa una superficie translúcida sin azul.
- El inspector está a la derecha en ventanas suficientemente anchas.
- Los controles son semánticos y las rutas principales funcionan con teclado.
- Hay soporte explícito para `prefers-reduced-motion` y `forced-colors`.
- Los componentes de diálogo gestionan foco, Escape y restauración de foco.
- Los contratos de evidencia y operaciones son más rigurosos que el prototipo y deben conservarse.

## Decisión recomendada

Reconstruir la capa de presentación alrededor de un contrato visual explícito, usando React semántico y los datos reales. No hacer un parche de colores sobre el DOM actual: la densidad y la jerarquía requieren cambios de composición en shell, toolbar, filtros, filas, inspector, pendientes y hojas.

El viewport de aceptación visual será 1420×892. A esa medida deben coincidir tokens, columnas, topbar, radios, bordes, tipografía, materiales y densidad. En medidas menores se aplicarán variantes responsivas que conserven el lenguaje, sin exigir igualdad geométrica con el prototipo fijo.

## Referencias técnicas externas

- [Electron: opciones de ventana, titlebar y traffic lights](https://www.electronjs.org/docs/latest/api/structures/base-window-options)
- [Electron: guía oficial de custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [Playwright: comparaciones visuales y snapshots por plataforma](https://playwright.dev/docs/test-snapshots)

## Revisión post-implementación (Task 6.2)

La revisión inicial de este documento describe el punto de partida. Tras ejecutar el plan de fidelidad, se repitió la comparación manual sobre el viewport canónico de **1420×892**. La implementación ya reproduce la geometría, densidad, jerarquía, materiales y lenguaje de controles del handoff en las superficies que comparten contrato de producto. Las diferencias restantes que se ven en estas composiciones son deliberadas y se enumeran abajo.

### Método

- El handoff se renderizó directamente desde `thoughts/handoff/App.dc.html` con Chrome, viewport exterior suficiente y un recorte exacto del marco de la aplicación en `x=28`, `y=28`, `1420×892`, DPR 1. No se reescaló su contenido.
- La implementación se tomó de los goldens macOS de `tests/e2e/visual-fidelity.e2e.spec.ts-snapshots`, ya fijados a `1420×892`.
- Cada *side-by-side* coloca el handoff a la izquierda y Forge a la derecha; mide `2840×892`.
- Cada overlay conserva el handoff como base y aplica Forge al 50% de opacidad; mide `1420×892`.
- Las áreas rectangulares neutras de Forge son máscaras de Playwright para rutas temporales, hashes, snapshots y timestamps volátiles. No representan controles ni contenido ausente.

### Evidencia versionada

| Superficie | Side-by-side | Overlay 50% |
|---|---|---|
| Inventario + inspector | [comparación](assets/forge-handoff-style-fidelity/inventory-inspector-side-by-side.png) | [overlay](assets/forge-handoff-style-fidelity/inventory-inspector-overlay-50.png) |
| Pendientes | [comparación](assets/forge-handoff-style-fidelity/pending-side-by-side.png) | [overlay](assets/forge-handoff-style-fidelity/pending-overlay-50.png) |
| Editor | [comparación](assets/forge-handoff-style-fidelity/editor-side-by-side.png) | [overlay](assets/forge-handoff-style-fidelity/editor-overlay-50.png) |
| Historial | [comparación](assets/forge-handoff-style-fidelity/history-side-by-side.png) | [overlay](assets/forge-handoff-style-fidelity/history-overlay-50.png) |

También se conservan en el mismo directorio las cuatro capturas del handoff normalizadas por recorte, con sufijo `-1420x892`, para que las composiciones puedan auditarse y regenerarse sin depender de una captura externa.

### Desviaciones intencionales por contrato de producto

1. **Chrome nativo y acciones reales.** Forge no dibuja semáforos HTML. La barra reserva el área nativa de la plataforma y muestra las acciones implementadas —pendientes, instalar e historial— en lugar de “Nueva skill”, Discover y otras entradas simuladas.
2. **Inventario observado, no catálogo ficticio.** Los nombres, ámbitos y cantidades provienen del fixture de filesystem real. Forge conserva búsqueda, orden, agrupación, filtros progresivos y selección, pero omite activación, selección masiva, telemetría de uso, grafo y versiones inventadas.
3. **Estados independientes y verificables.** Las filas separan validez, relación con el origen y actualización. Cuando no existe evidencia muestran “Sin datos”; no fabrican versión, popularidad, último uso ni alcance heredado para llenar la maqueta.
4. **Inspector orientado a evidencia.** El panel mantiene los 326 px y la composición compacta del handoff, pero presenta runtime, ámbito, ubicación canónica, archivo de entrada, snapshot, hash y versión declarada. Se omiten autor, paquete, disparadores, permisos y dependencias cuando Forge no los puede acreditar.
5. **Pendientes limitados a causas reales.** Solo aparecen actualización disponible, conflicto con origen y validación pendiente, con revisión individual. No se reintroducen duplicados inferidos, “sin usar”, reparación automática, desactivación ni una actualización heterogénea en lote. El toast visible confirma la operación real del fixture.
6. **Edición segura de `SKILL.md`.** El editor conserva hoja, backdrop, densidad y footer, pero trabaja sobre el documento real y exige revisar el diff antes de escribir. Se excluyen reescritura con IA, edición de triggers, linaje de paquetes, archivos inventados y bifurcación de contenido gestionado.
7. **Historial de operaciones, no versiones sintéticas.** Forge muestra el ledger local persistente y solo ofrece deshacer cuando el backend acredita reversibilidad. Por eso su historial es más corto y semánticamente distinto de la cronología de versiones de demostración del handoff.
8. **Accesibilidad y contenido dinámico.** Los controles son botones, inputs, tablas/grid y diálogos semánticos con foco visible, teclado, reduced motion y forced colors. Rutas y evidencia reales pueden envolver o truncarse dentro de sus paneles; la geometría del marco permanece bloqueada.

### Cierre visual

La superposición confirma la coincidencia de las anclas estructurales compartidas: topbar de 46 px, sidebar de 226 px, inspector de 326 px, área central, filas de 52 px, hojas centradas, radios, bordes de medio píxel, backdrop y escala tipográfica compacta. Las diferencias de texto, población de filas y affordances corresponden a los ocho contratos anteriores, no a deriva estilística.
