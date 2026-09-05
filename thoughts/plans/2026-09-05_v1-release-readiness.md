# Plan de implementación: cerrar y publicar Skillglass v1

**Date**: 2026-09-05
**Status**: In Progress
**Objetivo**: una aplicación pequeña, útil para Roberto y suficientemente cuidada para presentarla públicamente.
**Origen**: [Revisión completa](../reviews/2026-09-05-v1-readiness.md).

## Resultado esperado

Una persona llega a la web, entiende qué hace Skillglass, descarga un archivo que funciona, autoriza sus carpetas y puede leer, crear y editar skills sin perder cambios accidentalmente. La experiencia es legible, coherente en español e inglés y muestra claramente quién ha construido el producto.

Este plan cubre todos los hallazgos de la revisión, incluidos los ajustes menores de animación y estilo. El alcance termina en la publicación y su comprobación. No incorpora cuentas, marketplace, sincronización, IA, telemetría, actualizador automático ni una reorganización del monorepo.

La versión objetivo propuesta es **1.0.0**, con tag `v1.0.0`. No es necesario versionar todos los paquetes internos a 1.0.0. Se mantiene la identidad oscura y metálica existente y la matriz de empaquetado actual. Se promocionan únicamente las combinaciones de sistema y arquitectura cuyos artefactos se hayan probado.

## Base y restricciones

- Trabajar sobre el checkout revisado, que ya contiene cambios del usuario en CI, empaquetado, landing y documentación. Registrar el estado al empezar; no restaurarlos ni sustituirlos por versiones de HEAD.
- Respetar `CLAUDE.md`, las fronteras de escritura, las operaciones con vista previa, la detección de divergencia y el undo persistente. Mantener el endurecimiento de Electron, IPC validado y la firma ad-hoc final del paquete de macOS.
- Mantener la distribución oficial en GitHub Releases del repositorio. No añadir descargas oficiales desde otros proveedores ni recomendaciones para desactivar globalmente protecciones del sistema.
- La revisión obtuvo 371 pruebas unitarias correctas y 30 E2E activos correctos entre dos rondas. **No equivale a una ejecución completa limpia ni a validación de nuevos binarios Windows/Linux.** Las 13 comparaciones visuales condicionadas no se ejecutaron.
- Integrar los manifiestos existentes: [Forge MVP](../tests/2026-08-26_forge-mvp.md) y [Onboarding](../tests/2026-08-27_onboarding-experience.md).
- No modificar `tests/spec/forge-mvp.e2e.spec.ts`. SHA-256 esperado: `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`.
- Conservar los ocho comportamientos ONB existentes. La simplificación propuesta mantiene el tour opcional, la selección explícita de seguimiento, sus filtros y la reanudación. No se debilitan aserciones para ocultar regresiones.

## Requisitos y trazabilidad

| ID | Hallazgo que se cierra | Tareas | Evidencia de aceptación |
| --- | --- | --- | --- |
| V1-01 | Pérdida de borradores al cerrar; creación y operaciones en curso | 1.1–1.3 | Cierre y salida protegidos en Electron; cancelar conserva contenido |
| V1-02 | `.codex/skills` no propuesta y cobertura exagerada | 2.1, 5.1 | Carpeta existente propuesta con permiso explícito; promesas ajustadas |
| V1-03 | Symlinks externos omitidos sin explicación | 2.2 | Aviso visible y localizado; destino externo no escaneado sin aprobación |
| V1-04 | Ganadora/precedencia de duplicados sin evidencia | 2.3, 5.1 | Duplicados visibles sin inventar activación ni precedencia |
| V1-05 | Texto pequeño, contraste insuficiente y foco indefinido | 4.1 | Contraste medido, teclado y zoom comprobados |
| V1-06 | Inglés incompleto, idioma inicial y plurales | 3.1, 5.2 | Flujos completos ES/EN, ejemplos y capturas por idioma |
| V1-07 | Copy técnico, defensivo y actualización ambigua | 3.2, 5.1, 5.3 | Utilidad clara; actualización descrita como local |
| V1-08 | Inventario saturado e instrucciones relegadas | 3.2 | Estados accionables destacan; detalle técnico sigue accesible |
| V1-09 | Markdown incompleto | 3.3 | Formato habitual correcto y contenido inseguro inerte |
| V1-10 | Onboarding largo | 4.2 | Ruta principal corta, tour y selección avanzada opcionales |
| V1-11 | Hero móvil largo y demostración poco legible | 5.2 | Demostración accesible pronto y legible a 390 × 844 |
| V1-12 | Dirección de carrusel, brillo con retraso, hover táctil | 4.3 | Movimiento coherente, brillo estático y hover condicionado |
| V1-13 | Autoría, motivo personal, demo, README y feedback | 5.2, 5.3 | Firma de Roberto, demostración real y documentación de entrada |
| V1-14 | Descarga sin binarios y repositorio privado | 5.4, 6.1–6.3, 7.2 | Descarga anónima e instalación del artefacto publicado |
| V1-15 | Requisitos, firma y soporte de plataformas sin cierre | 6.1–6.3 | Matriz con evidencia del commit final y límites explícitos |
| V1-16 | Validación final incompleta y baselines antiguos | 7.1–7.3 | Suite completa, comparación visual revisada y comprobación pública |

## Alternativas consideradas

### A. Cierre incremental del producto actual — recomendada

Corregir los fallos, mejorar descubrimiento y lectura, simplificar presentación y copy, completar idiomas y preparar los artefactos actuales. Reutilizar contratos, registro de operaciones, onboarding, adaptadores y estilos.

**Ventajas:** cada cambio resuelve un problema observado, mantiene el comportamiento probado y permite revisar entregas pequeñas. **Costes:** quedan las limitaciones deliberadas de una herramienta local y parte del sistema de traducción existente. **Complejidad:** media; la coordinación de cierre y la publicación nativa son los puntos más delicados.

### B. Rehacer la experiencia y ampliar la plataforma

Nuevo onboarding, nuevo sistema completo de traducciones, recuperación automática de borradores, rediseño, adaptadores de plugins/agentes y distribución avanzada.

**Ventajas:** mayor flexibilidad futura. **Costes:** más estados, migraciones, dependencias y pruebas; retrasa una v1 sin resolver un objetivo adicional del usuario. **Complejidad:** alta.

Se elige A. La cobertura incompleta se cierra con propuestas útiles y límites visibles; la pérdida de borradores se cierra con protección de salida. No se añade un subsistema de autosave para resolver este fallo.

## Decisiones de implementación

1. **Cierre centralizado.** El proceso principal coordina cierre nativo y salida; consulta el estado del workspace por IPC validado y usa un diálogo de permanecer/descartar. No se usa un booleano global de renderer como autorización permanente para cerrar. La protección cubre cambios en los campos iniciales de creación, texto, confirmaciones y operaciones ya iniciadas.
2. **Descubrimiento explícito.** Proponer `~/.codex/skills` cuando exista como carpeta compatible, sin afirmar que Codex la está utilizando. Las raíces existentes `.agents/skills` mantienen su semántica. No recorrer automáticamente cachés de plugins. Explicar cómo añadir una carpeta; tratar ubicaciones reconocidas como gestionadas por el proveedor como solo lectura.
3. **Diagnósticos estructurados.** Los adaptadores comunican omisiones relevantes mediante un contexto opcional de escaneo; el coordinador sigue emitiendo eventos `finding`. Evitar acoplar el adaptador al renderer o añadir un canal global mutable.
4. **Evidencia intacta.** Ajustar el texto y la maqueta de precedencia. No cambiar `resolveEffectiveSkill` para fabricar una ganadora. Desconocido, observado y conflicto conservan significados distintos.
5. **Markdown seguro.** Sustituir el reconocimiento parcial por un parser a AST de CommonMark con extensión GFM y una lista explícita de nodos React permitidos. Preferencia de implementación: familia `mdast-util-from-markdown`/extensiones GFM, declaradas como dependencias directas del paquete que las use y verificadas contra su documentación al instalarlas. No usar HTML generado ni `dangerouslySetInnerHTML`.
6. **Idioma.** Preferencia guardada > primer idioma soportado del sistema/navegador > inglés. Español e inglés son los únicos idiomas de v1. No traducir contenido de skills, rutas ni identificadores del usuario. Formatear mensajes estructurados de evidencia en presentación; no modificar los hechos almacenados.
7. **Presentación.** Instrucciones y acciones primero; detalles técnicos en disclosure accesible. Conservar acceso a todos los estados, filtros y datos. Mantener la estética actual.
8. **Movimiento.** Carrusel opcional con aparición breve sin desplazamiento direccional; brillo del CTA estático; hover solo con puntero adecuado. Sin nueva dependencia de animación.
9. **Descargas.** Datos de release centralizados en la landing, con estado pendiente/publicado y enlaces a archivos reales por plataforma. No anunciar disponibilidad pública desde una release privada o en borrador.

## Archivos previstos

Las rutas siguientes son relativas a la raíz del proyecto. Los nombres nuevos son parte del plan, no archivos ya implementados.

| Archivo o grupo | Acción | Finalidad |
| --- | --- | --- |
| `apps/desktop/src/main/{index,window}.ts` | Modificar | Coordinar salida y cierre |
| `apps/desktop/src/main/window-close-guard.ts` | Crear | Máquina de estados de cierre y diálogo |
| `apps/desktop/src/main/operations/service.ts` y composición de servicios | Modificar | Exponer el estado real de operaciones en curso al guard de cierre |
| `packages/contracts/src/ipc/{bridge,channels,contracts,events}.ts`, `apps/desktop/src/preload/bridge.ts` | Modificar | Contratos de ciclo de vida y diagnósticos |
| `packages/contracts/src/ipc/lifecycle.ts` | Crear | Schemas de solicitud/respuesta de cierre |
| `packages/contracts/src/{index,ipc/index}.ts` y dobles de `ForgeBridge` en tests | Modificar | Exportar contratos y adaptar el soporte a la API extendida |
| `apps/desktop/src/renderer/{App,SkillWorkspace,CreateSkillWorkspace}.ts` | Modificar | Estado pendiente, copy y jerarquía |
| `apps/desktop/src/renderer/useWorkspaceCloseGuard.ts` | Crear | Conectar los borradores con el cierre |
| `apps/desktop/src/main/onboarding/{composition,root-service,scan-service}.ts` | Modificar | Propuestas y diagnósticos |
| `packages/adapter-codex/src/codex-adapter.ts`, `packages/adapter-folder/src/{folder-adapter,types}.ts` | Modificar | Descubrimiento, límites y solo lectura |
| `packages/scanner/src/coordinator/{types,scan-coordinator}.ts` | Modificar | Propagación de omisiones |
| `packages/adapter-api/src/types.ts` y exports relacionados | Modificar | Contexto de diagnóstico compatible en el contrato del adaptador |
| `apps/desktop/src/renderer/{i18n,SafeMarkdown,AppChrome,OperationPlanDetails,Pending}.ts` | Modificar | Idioma, formato y textos |
| `apps/desktop/src/renderer/inventory/{Inventory,Inspector}.ts` | Modificar | Inventario e inspector más claros |
| `apps/desktop/src/renderer/onboarding/{WelcomeCarousel,OnboardingFlow,SourceApprovalStep,SkillSelectionList,MonitoringManagerDialog}.ts` | Modificar | Entrada corta y copy coherente |
| `apps/desktop/src/renderer/styles/{tokens,foundation,components,shell,responsive,onboarding}.css` | Modificar | Legibilidad, foco, jerarquía y movimiento |
| `apps/landing/src/pages/{index.astro,es/index.astro}`, `apps/landing/src/styles/global.css` | Modificar | Promesa, traducción, autoría y móvil |
| `apps/landing/src/data/release.ts` | Crear | Estado y enlaces de la release |
| `apps/landing/src/assets/`, `apps/landing/public/` | Añadir/actualizar recursos | Capturas ES/EN y demostración real |
| `apps/landing/public/{llms.txt,pricing.md}`, recursos sociales | Revisar/actualizar | Coherencia con funciones y disponibilidad |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | Modificar | Entrada, feedback y documentación técnica |
| `CHANGELOG.md`, `docs/installation.md` | Crear si no existen | Notas e instalación por plataforma |
| `apps/desktop/package.json`, `pnpm-lock.yaml` | Modificar | Versión pública y dependencias directas del parser |
| `.github/workflows/{ci,release}.yml`, `.github/scripts/release-assets.mjs` | Ajustar sobre cambios existentes | Evidencia y archivos del commit final |
| `packaging/arch/OMARCHY-VALIDATION.md`, `thoughts/research/signing-and-notarization.md` | Actualizar con evidencia | Estado real de soporte y firma |
| Tests unitarios e integración adyacentes; `tests/e2e/workspace-close.e2e.spec.ts` nuevo | Ampliar/crear | Regresiones funcionales de este plan |
| `tests/e2e/onboarding-monitoring.e2e.spec.ts` | Make pass | Mantener ONB-1 a ONB-8; no debilitar comportamientos |
| `tests/spec/forge-mvp.e2e.spec.ts` | **Make pass; no modificar** | Contrato inmutable del MVP |
| `tests/e2e/visual-fidelity.e2e.spec.ts` y sus snapshots | Verificar/actualizar referencias revisadas | Apariencia final, zoom y tamaños estrechos |
| `thoughts/reviews/2026-09-05-v1-release-verification.md` | Crear durante ejecución | Evidencia final, hashes, artefactos y límites |

## Fases de implementación

### Fase 1 — Evitar pérdidas de trabajo

#### Task 1.1: Contrato y coordinación del cierre

**Archivos:** `main/index.ts`, `main/window.ts`, nuevo `main/window-close-guard.ts`, `main/operations/service.ts`, composición, contratos IPC y preload indicados arriba.

- Unificar botón nativo de cerrar y salida de la aplicación, incluido el atajo del sistema.
- Estados explícitos: abierto → consultando → confirmando → cierre autorizado una vez. Cancelar devuelve a abierto; múltiples solicitudes no acumulan diálogos.
- Consultar al renderer mediante identificador de solicitud y recibir estado `clean`, `dirty` o `busy`, con revisión del borrador. Validar schemas y emisor de ventana principal; rechazar respuestas obsoletas.
- El proceso principal conoce las operaciones confirmadas en curso y no las interrumpe: mantener abierta la ventana y permitir volver a solicitar salida cuando finalicen. No basar esa protección únicamente en mensajes del renderer.
- Si falla la consulta, conservar la ventana y explicar que no se ha podido comprobar el estado. No descartar silenciosamente por timeout.
- Si hay cambios, diálogo localizado: «Tienes cambios sin guardar», «Seguir editando» por defecto y «Descartar cambios». No añadir un botón Guardar que salte la vista previa existente.
- Revisar la limpieza actual de `before-quit`: disponer servicios solo cuando la salida esté autorizada, y eliminar listeners al destruir la ventana.

**Aceptación:** una respuesta duplicada no autoriza otra salida; cancelar no dispone servicios; una operación confirmada completa antes de cerrar.

#### Task 1.2: Estado pendiente de edición y creación

**Archivos:** `SkillWorkspace.ts`, `CreateSkillWorkspace.ts`, `App.ts`, nuevo hook de cierre.

- Una única definición de cambios pendientes sirve a la navegación interna y al cierre nativo.
- Comparar edición con la versión cargada/guardada; reconocer también cambios de nombre, descripción, destino y texto durante la creación antes de entrar al editor.
- Mantener el estado pendiente tras errores, cancelación del diff y divergencia externa. Limpiarlo solo tras guardado/creación confirmado o descarte explícito.
- Proteger la salida de la ruta al abrir otras superficies. Limpiar registros al desmontar sin dejar una autorización de cierre reutilizable.

**Aceptación:** cancelar conserva literalmente todos los campos; revertir un borrador a su estado inicial elimina el aviso; completar el guardado permite cerrar normalmente.

#### Task 1.3: Regresión real de cierre y salida

**Archivos:** tests adyacentes de main/workspaces/preload; nuevo `tests/e2e/workspace-close.e2e.spec.ts`.

- Probar edición sucia y creación inicial con cierre nativo, salida de aplicación, permanecer y descartar.
- Cubrir doble solicitud, respuesta tardía, fallo de guardado y operación en curso.
- Ejecutar con carpetas y perfil temporales. Usar el botón nativo en comprobación manual y la ruta real de cierre en E2E, sin sustituirla por el botón «Volver».

**Aceptación:** reproducir la pérdida descrita en la revisión ya no es posible mediante cierre normal; el archivo en disco no cambia al cancelar o descartar un borrador.

### Fase 2 — Descubrimiento útil y promesas verificables

#### Task 2.1: Proponer ubicaciones útiles sin ampliar permisos implícitos

**Archivos:** `root-service.ts`, `composition.ts`, adaptador de carpetas, tests de raíces/adaptador.

- Proponer `~/.codex/skills` solo si existe y es una carpeta accesible; deduplicar por ruta canónica con raíces ya propuestas o añadidas.
- Mostrarla como carpeta compatible con `SKILL.md`, sin asignarle hechos de activación de Codex.
- No escanear la propuesta hasta aprobarla. Respetar selecciones persistidas; no añadir automáticamente nuevas propuestas al conjunto aprobado de una instalación existente.
- Ofrecer ayuda breve para añadir otra carpeta, incluidas ubicaciones de plugins elegidas por el usuario. Mantener solo lectura en raíces gestionadas; aplicar la política también tras resolver enlaces y planificar operaciones.
- No explorar árboles completos de cachés ni detectar automáticamente otros agentes en esta v1.

**Aceptación:** fixture con `.agents/skills` y `.codex/skills` muestra ambas propuestas, solo escanea las aprobadas y no permite escribir en contenido gestionado.

#### Task 2.2: Explicar enlaces y carpetas omitidos

**Archivos:** adaptador Codex y de carpetas, `packages/adapter-api/src/types.ts`, tipos/coordinador del escáner, servicio de escaneo, schemas de eventos, `App.ts`, `i18n.ts`.

- Añadir un contexto opcional a `scanRoot` con emisor de diagnósticos; mantener compatible el iterador de observaciones y situar el contrato compartido en una capa que no introduzca ciclos de dependencias.
- Emitir códigos específicos para enlace fuera de la raíz y destino no accesible. Propagar mediante los eventos de findings existentes; evitar una excepción que detenga todo el inventario.
- Mostrar un resumen legible y detalles desplegables con la ubicación omitida y la indicación de añadir su carpeta destino si se desea incluirla.
- Mantener contención, deduplicación, límite de mensajes y defensa ante bucles. Reconciliar el aviso cuando el problema desaparezca.

**Aceptación:** la fixture de symlink externo produce un aviso; el destino no se lee sin autorización; las skills válidas siguen apareciendo. Un enlace interno permitido no genera un falso aviso.

#### Task 2.3: Presentar duplicados y estados desconocidos con precisión

**Archivos:** `Inspector.ts`, `Inventory.ts`, `i18n.ts`, pruebas de presentación; consultar `packages/domain/src/resolution.ts` sin cambiar su semántica.

- Mostrar «Hay varias copias con este nombre» y sus ubicaciones cuando no existe ganadora acreditada.
- Explicar desconocidos cuando aportan una decisión: «No se puede confirmar si Codex la utiliza». No convertir unknown en disabled.
- Preparar una fixture visual realista que sustituya la maqueta con precedencia inventada.

**Aceptación:** dos skills homónimas mantienen hechos y conflicto originales; ninguna etiqueta afirma que la global tapa a la del proyecto sin evidencia.

### Fase 3 — Lectura, idiomas y textos de producto

#### Task 3.1: Completar español e inglés

**Archivos:** `i18n.ts`, `main.ts`, `App.ts`, componentes de evidencia/onboarding y pruebas asociadas.

- Aplicar la prioridad de idioma decidida y actualizar `lang` del documento. Los tests usan locale explícito para no depender del equipo que los ejecuta.
- Corregir singular/plural para instalaciones, skills, resultados y selecciones con una función de formato.
- Localizar razones de resolución, etiquetas como `owned`, estados sin observación, avisos del escáner y cierre nativo mediante códigos/datos; no traducir cadenas arbitrarias del usuario.
- Recorrer estados vacíos, loading, error, solo lectura, diff, guardado, undo e historial en ambos idiomas.

**Aceptación:** «1 instalación» y «1 skill» correctos; inspector español sin mensajes internos en inglés; selección guardada persiste al reiniciar.

#### Task 3.2: Simplificar copy y jerarquía de la aplicación

**Archivos:** inventario, inspector, workspaces, `AppChrome.ts`, `Pending.ts`, `OperationPlanDetails.ts`, estilos asociados.

- Inventario: dejar visibles principalmente estructura inválida, cambios, actualización local disponible y solo lectura. Reducir repeticiones de «En seguimiento» y «Sin datos» sin eliminar información de filtros o detalle accesible.
- Inspector/workspace: instrucciones y acciones primero; ubicación y estado cerca del título; hashes, IDs, procedencia completa y detalles de recuperación bajo «Detalles técnicos».
- Sustituir términos internos en mensajes generales: «carpetas que has autorizado», «historial», «copia de recuperación», «revisar cambios». Mantener la condición exacta de undo junto a la acción cuando sea relevante.
- Acción de actualizaciones: «Comprobar cambios» con ayuda «Compara con las carpetas locales de origen». Explicar qué instalaciones no tienen un origen local comprobable.
- No introducir capacidades nuevas para justificar los textos.

**Aceptación:** se puede entender una skill y su siguiente acción sin leer identificadores técnicos; todas las dimensiones y restricciones siguen consultables por teclado.

#### Task 3.3: Vista previa de Markdown completa y segura

**Archivos:** `SafeMarkdown.ts`, `SafeMarkdown.test.ts`, estilos, `apps/desktop/package.json`, lockfile.

- Renderizar párrafos, títulos, énfasis, negrita, código inline/bloques, listas ordenadas y no ordenadas, citas, separadores y tablas GFM. Conservar el texto original para edición y diff.
- Ignorar HTML crudo como estructura ejecutable; representar contenido no soportado como texto cuando proceda.
- Imágenes locales/remotas inertes con texto alternativo; sin descargas automáticas ni exposición de rutas mediante peticiones externas.
- Enlaces solo interactivos si pasan la política externa existente; el resto se muestran como texto/destino. No ampliar silenciosamente la allowlist de navegación.
- Mantener nombres de lenguaje de código como texto seguro; sin resaltador ni ejecución de ejemplos para esta v1.

**Aceptación:** fixture con tablas, listas y énfasis legible; HTML, URLs `javascript:`, eventos incrustados e imágenes remotas no ejecutan código ni producen solicitudes. Documentos largos siguen siendo utilizables.

### Fase 4 — Legibilidad, entrada y movimiento

#### Task 4.1: Contraste, tipografía, foco y tamaños estrechos

**Archivos:** tokens y hojas CSS de desktop; componentes con excepciones locales.

- Elevar el contraste del texto terciario. Medir colores compuestos sobre cada superficie real: objetivo mínimo 4.5:1 para texto normal y 3:1 para indicadores de controles/foco aplicables.
- Revisar etiquetas de 9.5 px y ayudas de 11 px: llevar texto informativo a tamaños legibles, usando 11–12 px como mínimo práctico para etiquetas compactas, sin agrandar uniformemente toda la interfaz.
- Reemplazar `var(--focus-ring)` inexistente por el token de foco definido o una definición compartida coherente.
- Comprobar inspector, modales, tabla y workspaces a 760 × 520 y zoom 200 %, sin ocultar acciones ni producir scroll horizontal de la página. Código/tablas pueden tener scroll contenido propio.

**Aceptación:** mediciones documentadas, foco visible en enlace GitHub y botones, lectura viable con zoom y restauración de foco al cerrar modales.

#### Task 4.2: Dar una ruta corta al inventario

**Archivos:** `WelcomeCarousel.ts`, `OnboardingFlow.ts`, componentes de fuentes/seguimiento y tests ONB.

- Primera bienvenida breve con acción principal para elegir carpetas y acceso secundario al tour de tres pantallas. Mantener navegación, retroceso, indicadores y salto del tour por teclado.
- Tras aprobar carpetas y escanear, presentar un resumen compacto con «Seguir todas y abrir inventario» y «Elegir cuáles seguir». No persistir seguimiento por el mero paso del tiempo ni antes de pulsar la acción.
- Mantener selección detallada por IDs opacos, filtros sin pérdida de selecciones ocultas y edición posterior en el diálogo existente.
- Cero skills permite completar el paso con selección vacía y abrir un inventario con una acción útil para añadir carpeta o crear skill.
- Si se cierra antes de guardar, reanudar el paso de seguimiento; conservar migración de instalaciones existentes y preferencias ya guardadas.

**Aceptación:** ruta principal sin recorrer el tour ni manejar listas; ONB-1 a ONB-8 siguen pasando con sus comportamientos intactos.

#### Task 4.3: Corregir los tres detalles de movimiento

**Archivos:** `onboarding.css`, `components.css`, `apps/landing/src/styles/global.css`, script del CTA en `index.astro`.

- Quitar el desplazamiento dependiente del índice del slide; usar aparición breve que no sugiera dirección equivocada al retroceder.
- Hacer estático el brillo del CTA y retirar el seguimiento del puntero y su transición de transform de 100 ms.
- Condicionar efectos hover a `(hover: hover) and (pointer: fine)`. Conservar foco de teclado y feedback activo en táctil.
- Con movimiento reducido, eliminar desplazamientos y pulsos decorativos conservando texto/indicador claro de escaneo en curso.

**Aceptación:** retroceder no comunica avance espacial, no hay hover pegajoso en emulación táctil y los estados siguen siendo claros con movimiento reducido.

### Fase 5 — Web, autoría y documentación

#### Task 5.1: Reescribir la promesa y los textos principales

**Archivos:** páginas ES/EN y recursos públicos de texto.

Copy de partida en español:

> **Encuentra y edita tus skills en un solo lugar.**
> Explora las carpetas que elijas, lee las instrucciones de cada skill y revisa los cambios antes de guardarlos. Una app local para Codex y carpetas compatibles con SKILL.md.

Copy de partida en inglés:

> **Find and edit your skills in one place.**
> Browse the folders you choose, read each skill’s instructions, and review changes before saving. A local app for Codex and folders containing SKILL.md files.

- Sustituir «qué copia gana» por detección de nombres repetidos y ubicación; ajustar la maqueta a la fixture de 2.3.
- Eliminar absolutos como «todas» o «cualquier skill» y descubrimiento automático de cachés que no existen en la implementación.
- FAQ de cuatro asuntos: compatibilidad/carpetas, privacidad, guardado/undo y límites de versión. Mover permisos POSIX y retención a documentación técnica.
- «Gratis y de código abierto. Sin cuenta ni telemetría» solo aparece en la publicación que ya permite verificar el repositorio abierto.
- Mantener metadatos, `llms.txt`, `pricing.md` y textos sociales coherentes con estas funciones. No iniciar un proyecto SEO adicional.

**Aceptación:** cada afirmación principal se corresponde con un flujo o límite observable del producto; EN/ES cuentan lo mismo.

#### Task 5.2: Recursos reales, idiomas visuales y móvil

**Archivos:** assets/public de landing, HTML del ejemplo, CSS y fixtures de demostración.

- Capturar app final en ES y EN con carpetas temporales y nombres de ejemplo; no exponer rutas personales, claves ni contenido privado.
- Traducir también el ejemplo HTML, alt text y controles, no solo el texto que rodea la captura.
- Grabar demostración real de 20–40 segundos: encontrar → abrir → editar → revisar diff → guardar → deshacer. Usar vídeo local con controles y poster; sin autoplay ni reproductor externo. Si se produce primero una toma larga, editarla manteniendo reconocibles las acciones.
- En móvil, acortar el bloque inicial y usar un encuadre de producto legible, sin comprimir una ventana de escritorio entera. Mantener descarga y acceso a demo próximos al hero.
- Ajustar recursos sociales si ya no representan la interfaz final.

**Aceptación:** ambas rutas muestran su idioma; 390 × 844 sin desbordamiento y con demostración visible cerca del inicio; vídeo reproducible, con alternativa textual de los pasos.

#### Task 5.3: Hacer visible la autoría y preparar documentación de entrada

**Archivos:** landing, README, CHANGELOG, documentación de instalación, CONTRIBUTING y SECURITY.

- Añadir «Hecho por Roberto» / «Made by Roberto» con enlace conocido `https://github.com/r-bart`.
- Párrafo personal prudente, basado en el objetivo declarado: «He creado Skillglass para consultar y editar mis skills desde una app local. Es una herramienta pequeña que uso y comparto». No inventar trayectoria, métricas, testimonios o historias de uso.
- README en este orden: qué resuelve, captura, descarga/compatibilidad, uso inicial, límites; después desarrollo y contribución.
- Notas de 1.0.0: funciones reales, límites de descubrimiento/actualizaciones locales, estado de firma, plataformas verificadas y enlace de feedback.
- Canal de feedback mediante Issues del repositorio, comprobando que esté habilitado. No hace falta un formulario o backend.
- Conservar en SECURITY los detalles útiles de permisos, recuperación y reporte de vulnerabilidades, fuera del discurso principal del producto.

**Aceptación:** desde la landing se identifica al autor, se llega a instrucciones de instalación y se encuentra dónde comunicar un problema.

#### Task 5.4: Preparar una descarga que refleje disponibilidad real

**Archivos:** nuevo `apps/landing/src/data/release.ts`, páginas y sección de descarga.

- Fuente única de versión, estado, plataforma, arquitectura, nombre de archivo, URL, requisitos verificados, estado de firma y enlace a checksums.
- Estado pendiente sin enlaces ficticios ni apariencia de descarga disponible. Estado publicado con acciones específicas, p. ej. «Descargar para macOS · Apple Silicon» cuando ese archivo exista.
- Ofrecer selección manual de otras plataformas, independientemente de cualquier sugerencia basada en navegador.
- Mantener los URLs candidatos preparados para `v1.0.0`; activar disponibilidad solo en 7.2, tras la release pública.

**Aceptación:** es imposible generar un botón activo con un asset sin URL válida; versión y arquitectura son visibles antes de descargar.

### Fase 6 — Artefactos y preparación de release

#### Task 6.1: Versión, matriz y documentación de instalación

**Archivos:** package de desktop, lockfile, workflows/scripts de release, documentación de instalación y firma.

- Cambiar versión de desktop a 1.0.0 y eliminar referencias públicas obsoletas; mantener coherencia entre metadatos, tag, about y notas.
- Documentar cada combinación realmente generada por la matriz actual. No inferir arquitectura de nombres de runners ni inventar versión mínima de OS: extraer configuración y registrar el entorno de instalación probado, distinguiendo compatibilidad declarada de comprobación práctica.
- Conservar cambios existentes para macOS, Windows, DEB, RPM y Pacman. Linux exige un DEB, un RPM y un Pacman x64 del mismo bundle probado, según las reglas del repositorio.
- Mantener fuses, firma ad-hoc final y comprobaciones del helper Linux. No anunciar notarización o firma de editor verificada si no existen.
- Redactar pasos de instalación claros para los artefactos resultantes y advertencias de firma junto a la descarga. No contratar certificados ni configurar servicios de pago como parte del plan.

**Aceptación:** tag previsto y versión coinciden; cada archivo tiene arquitectura, procedencia, instrucciones y estado de validación identificables.

#### Task 6.2: Generar candidato reproducible y release en borrador

**Archivos:** workflows/scripts existentes, verificadores de make y tests de packaging/release-assets.

- Tras 7.1, fijar un commit candidato revisado; no ejecutar workflows sobre otro commit ni mover silenciosamente un tag existente.
- Ejecutar la matriz nativa y generar la release en borrador mediante el workflow existente. Registrar commit, tag, resultados y hashes de los archivos exactos.
- Verificar metadatos y `SHA256SUMS.txt`, ausencia de duplicados inesperados y correspondencia de cada asset con el mismo candidato.
- No publicar la release ni cambiar visibilidad en esta tarea. Resolver fallos de build o smoke antes de presentar el candidato.

**Aceptación:** borrador completo, CI del candidato correcta y hashes comprobables. Una CI verde de agosto no cuenta como evidencia del candidato de septiembre.

#### Task 6.3: Probar instalación de los archivos finales

**Archivos:** documento de verificación final; `packaging/arch/OMARCHY-VALIDATION.md` cuando haya prueba nativa.

- En cada plataforma que vaya a anunciarse como verificada: descargar el asset candidato, instalar, abrir, autorizar carpeta temporal, leer/editar, cerrar/reabrir y deshacer.
- Probar macOS arm64 disponible; obtener evidencia nativa Windows/Linux mediante la matriz y comprobación de instalación correspondiente. No confundir empaquetar con instalar manualmente.
- Omarchy requiere evidencia nativa de su sesión/entorno y del Pacman exacto. Si no existe, mantenerlo como no verificado/experimental y documentar esa limitación; no bloquea la publicación de plataformas ya verificadas.
- Si no hay acceso a una plataforma, registrar la falta de prueba y ajustar su etiqueta pública. No eliminar makers para hacer que el checklist parezca completo.

**Aceptación:** al menos una plataforma plenamente probada y anunciada; todas las demás con estado preciso. Si se reconstruye un asset después, repetir su comprobación.

### Fase 7 — Validación, publicación y comprobación pública

#### Task 7.1: Cerrar la validación local y visual del candidato

**Archivos:** tests existentes/nuevos y nuevo informe de verificación.

- Ejecutar la estrategia de pruebas inferior en una ronda completa sobre el candidato de código, resolver fallos y conservar logs.
- Revisar snapshots existentes antes de actualizarlos; aceptar únicamente cambios intencionados de este plan. Activar la suite visual condicionada en un entorno consistente y documentar cualquier comparación no portable.
- Revisar teclado, foco, zoom, movimiento reducido, estados vacíos/error y ES/EN de app y landing.
- Ejecutar la skill `devtronic:post-review` al cerrar la implementación, antes de preparar el candidato publicable. Corregir hallazgos dentro del alcance y repetir solo comprobaciones afectadas, además de la validación final necesaria.

**Aceptación:** suite completa limpia, contrato MVP inmutable, diferencias visuales revisadas y ningún fallo de pérdida de datos o bloqueo de uso abierto.

#### Task 7.2: Publicar el resultado concreto

**Archivos/servicios:** repositorio GitHub, release en borrador, datos de descarga y deployment de landing.

- Preparar primero un resumen revisable con commit, diff final, tag, archivos/hashes, plataformas verificadas, capturas, URLs y cambios de visibilidad previstos.
- Antes de hacer público el repositorio, revisar el contenido e historial que se va a exponer para no incluir accidentalmente material privado. No reescribir historial ni borrar archivos de usuario de forma automática.
- Solicitar autorización de publicación únicamente cuando el candidato esté listo, salvo que el usuario ya la haya dado explícitamente durante la ejecución. La petición actual de crear un plan no publica el proyecto.
- Tras autorización: hacer público el repositorio, publicar el borrador probado y activar/desplegar la landing con los enlaces reales. Respetar ese orden para no anunciar descargas privadas.
- Si falla la web, mantener la release accesible y corregir el enlace/deployment. No sustituir los archivos publicados por otros sin versión y trazabilidad.

**Aceptación:** repositorio y release accesibles sin sesión; botones de descarga apuntan a assets del tag correcto.

#### Task 7.3: Verificación anónima y cierre

**Archivos:** informe de verificación y `thoughts/STATE.md`.

- Desde una sesión sin autenticación: abrir `/` y `/es/`, descargar un archivo, comparar hash y comprobar README, licencia, Issues, instalación y notas de release.
- Comprobar canonical/hreflang y recursos sociales existentes después del despliegue; no ampliar el alcance SEO.
- Registrar fecha, commit, tag, artefactos, pruebas, límites conocidos y pendientes opcionales reales. Marcar el plan Complete solo cuando el alcance acordado esté cerrado; si queda publicación por autorizar, indicar ese estado con precisión.

**Aceptación:** un visitante puede completar «entender → descargar → instalar → usar» en la plataforma verificada sin ayuda privada del autor.

## Task Dependencies

Los IDs son cadenas. Las dependencias incluyen la secuencia necesaria para archivos compartidos; no autorizan por sí mismas trabajo de agentes en paralelo. Ejecutar las mutaciones de un mismo archivo de forma ordenada.

```yaml
dependencies:
  "1.1": []
  "1.2": ["1.1"]
  "1.3": ["1.2"]
  "2.1": ["1.3"]
  "2.2": ["2.1"]
  "2.3": ["2.2"]
  "3.1": ["2.3"]
  "3.2": ["3.1"]
  "3.3": ["3.2"]
  "4.1": ["3.3"]
  "4.2": ["4.1"]
  "4.3": ["4.2"]
  "5.1": ["4.3"]
  "5.2": ["5.1"]
  "5.3": ["5.2"]
  "5.4": ["5.3"]
  "6.1": ["5.4"]
  "6.2": ["7.1"]
  "6.3": ["6.2"]
  "7.1": ["6.1"]
  "7.2": ["6.3"]
  "7.3": ["7.2"]
```

El orden efectivo del cierre es **6.1 → 7.1 → 6.2 → 6.3 → 7.2 → 7.3**: primero validar el código, después fijar/generar/probar los binarios, y finalmente publicar. Si aparece un fallo en un artefacto, corregir el código, volver a validar y generar un candidato nuevo antes de continuar.

## Riesgos y casos límite

| Riesgo | Tratamiento |
| --- | --- |
| Cierre/quit reentrante o respuesta IPC tardía | ID de solicitud, autorización de un solo uso, comprobación de revisión y pruebas de cancelación |
| Caída del proceso, corte eléctrico o cierre forzado del OS | Fuera de la garantía de protección de salida normal; no prometer recuperación de borradores que no se persisten |
| Operación confirmada mientras se solicita cierre | Estado de operación en main; mantener proceso/servicios hasta su finalización |
| Nuevas raíces o symlinks amplían acceso | Aprobación explícita, canonicalización, contención, deduplicación y solo lectura gestionada |
| Directorios ausentes, vacíos, ilegibles o eliminados durante scan | Avisos parciales, inventario utilizable y reintento; no fallar todo el arranque |
| Cambiar la presentación borra distinciones del dominio | Conservar dimensiones, hechos, filtros y tests BV-3/BV-4/BV-5 |
| Simplificar onboarding rompe reanudación/selección | Mantener ONB-1 a ONB-8 y comprobar cierre en estados intermedios |
| Parser Markdown aumenta superficie o peso | AST permitido, sin HTML/red/código, dependencia directa y prueba con documento largo |
| Cambio de idioma traduce texto del usuario | Separar etiquetas/códigos de nombres, rutas y cuerpo de skills |
| Subir tipografía rompe layout | Ajustar grid, truncado y scroll contenido; comprobar tamaños estrechos y zoom |
| Actualizar snapshots oculta una regresión | Revisar cada diferencia antes de aceptar referencias |
| E2E de arranque intermitente | Capturar logs del proceso y corregir sincronización; no añadir retries para ocultar pérdida de estado |
| Plataforma o firma sin acceso para comprobar | Etiquetar estado real, preservar makers y publicar solo promesas respaldadas |
| Un enlace existe pero requiere sesión | Comprobación anónima posterior, más descarga y hash del archivo real |
| Material privado en assets o historia | Capturas con fixtures y revisión concreta de lo que se publica antes del cambio de visibilidad |

## Estrategia de pruebas

Añadir pruebas de comportamiento para cierre, fronteras de raíces, diagnósticos, Markdown y persistencia. No añadir pruebas que comparen literalmente cada frase o reproduzcan cada regla CSS. Para copy y estilo, usar revisión bilingüe, mediciones y las pruebas visuales existentes.

### Comprobaciones dirigidas durante cada fase

- Unitarios de cierre y schemas; workspaces con permanecer/descartar/error; integración de servicios con operaciones en curso.
- Adaptadores/raíces: propuesta existente/ausente, aprobación, duplicados canónicos, solo lectura y enlaces externos/internos/bucles.
- Markdown: estructura habitual, HTML/URLs maliciosas inertes, imágenes sin red y texto del usuario intacto.
- i18n: prioridad guardada/sistema/fallback, singular/plural y mensajes estructurados en ES/EN.
- Onboarding: los ocho escenarios existentes, cero skills y entrada corta sin alterar consentimiento.
- Electron: cierre real, edición con diff, undo tras reiniciar, watcher y reapertura del paquete.

### Comandos de cierre

Usar Node 24.19.x y pnpm 11.5.x conforme al proyecto. Ejecutar comandos por separado y conservar el resultado de cada uno:

```bash
pnpm run typecheck
pnpm exec tsc --noEmit -p tests/e2e/tsconfig.json
pnpm run lint
pnpm test
pnpm run check:landing
pnpm run build:landing
pnpm audit --prod
pnpm package
pnpm make
pnpm exec playwright test tests/spec/forge-mvp.e2e.spec.ts
pnpm exec playwright test tests/e2e/onboarding-monitoring.e2e.spec.ts
pnpm test:e2e
FORGE_VISUAL_BASELINES=1 pnpm exec playwright test tests/e2e/visual-fidelity.e2e.spec.ts
shasum -a 256 tests/spec/forge-mvp.e2e.spec.ts
```

La suite completa debe pasar en una ejecución final coherente; una repetición dirigida sirve para investigar, no sustituye ese cierre. Los smoke nativos y verificadores de assets se ejecutan además en la matriz existente. Si el ejecutable local de Forge vuelve a carecer de permiso, diagnosticar/restaurar la instalación local; no alterar scripts del producto para ocultarlo.

### Comprobación manual final

1. Perfil limpio: bienvenida corta, carpetas autorizadas, scan y entrada al inventario; perfil existente: conserva preferencias.
2. Skill válida, inválida, solo lectura y homónima; instrucciones visibles y detalles accesibles.
3. Crear y editar, revisar diff, cancelar cierre nativo, guardar, salir, reabrir y deshacer.
4. Copia externa modificada durante edición: aviso de divergencia; ningún sobreescrito silencioso.
5. Navegación de teclado y foco, 200 % de zoom, 760 × 520 en desktop; ES/EN y movimiento reducido.
6. Landing ES/EN en escritorio y 390 × 844, demo reproducible, selector de plataforma y enlace de autor.
7. Instalar el asset exacto; tras publicar, repetir descarga sin sesión y hash.

## Done Criteria

- [x] **Fase 1:** pruebas y comprobación nativa confirman que permanecer conserva borradores de edición/creación y que salir no interrumpe operaciones confirmadas.
- [x] **Fase 2:** `.codex/skills` propuesta con consentimiento; symlink externo explicado; no se inventa precedencia ni se amplían permisos de escritura.
- [x] **Fase 3:** Markdown habitual legible y seguro; flujos completos localizados; inventario/inspector priorizan información útil sin perder datos.
- [x] **Fase 4:** contraste medido, foco corregido, zoom usable, entrada corta y tres ajustes de movimiento comprobados.
- [x] **Fase 5:** web y capturas bilingües, demo real, autor visible, documentación de entrada y descargas preparadas sin falsa disponibilidad.
- [ ] **Fase 6:** versión/tag coherentes, candidato y hashes trazables, CI nativa del commit final, al menos una instalación verificada y estados honestos del resto.
- [ ] **Fase 7:** revisión final completada, publicación autorizada y comprobación anónima correcta.
- [x] Todos los tests del contrato pasan: `pnpm exec playwright test tests/spec/forge-mvp.e2e.spec.ts`.
- [x] No se ha modificado el archivo de tests inmutable; SHA-256 coincide con el manifiesto.
- [x] ONB-1 a ONB-8 siguen pasando; ninguna aserción de negocio debilitada.
- [x] Typecheck, lint, unitarios, Astro, empaquetado y E2E completos correctos; comparaciones visuales revisadas.
- [x] Sin TODO/FIXME/HACK nuevos que sustituyan trabajo necesario; sin violaciones de capas ni nuevas capacidades fuera del alcance.
- [x] Informe final registra resultados reales y limitaciones; no confunde build local con soporte probado ni preparación con publicación.

## Aprobación y ejecución

Este documento está listo para revisión. La skill invocada pide **“Confirm plan before implementation”**: la siguiente acción es aprobar este plan y ejecutar las fases en el orden indicado. La aprobación del plan permite implementar y preparar un candidato revisable. La publicación externa se realiza al final con la autorización correspondiente, sin volver a pedir permiso para lecturas, correcciones, pruebas o preparación ya cubiertas por esa aprobación.
