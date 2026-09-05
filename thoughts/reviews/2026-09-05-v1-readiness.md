# Revisión de Skillglass para una v1 pequeña

Fecha: 5 de septiembre de 2026. Revisión del checkout de trabajo, incluidos los cambios que ya estaban sin commit sobre `d9080bf`. Criterio: utilidad personal, producto cuidado y autoridad de su creador. No se han modificado funcionalidades ni publicado nada.

**Veredicto: necesita un cierre de publicación y de experiencia, no ampliar el alcance.** La arquitectura, el registro de operaciones, el diff y la recuperación ya aportan suficiente valor para una primera versión. Publicaría después de resolver la descarga, corregir las promesas que exceden el comportamiento real y cerrar los problemas concretos de uso descritos aquí.

## Lo que ya está bien

- Separación entre dominio, adaptadores, escaneo, almacenamiento, operaciones y aplicación. No reestructuraría el monorepo para esta v1.
- Los archivos son la fuente de verdad; el índice se reconstruye y el historial de operaciones persiste. Hay comprobaciones de cambios externos antes de escribir y restricciones para deshacer.
- Electron tiene aislamiento de contexto, sandbox, integración Node desactivada en el renderer, CSP, IPC validado y navegación externa restringida. La vista de Markdown no interpreta HTML ni ejecuta contenido importado. Esto es evidencia de decisiones sensatas, no una certificación de seguridad exhaustiva.
- Crear, inspeccionar, editar, importar desde carpeta/ZIP y deshacer cubren un caso de uso útil. No hace falta añadir IA para justificar la aplicación.
- La identidad visual es coherente: fondos oscuros, materiales metálicos, iconos de skills con color y editor de tres vistas. Hay un diseño reconocible que merece conservarse.
- La landing tiene español e inglés, canonical, hreflang, imagen social y recursos para indexación. No priorizaría más trabajo de SEO antes de que se pueda descargar.

## Antes de publicar

### Proteger los borradores al cerrar la ventana — fallo confirmado

Reproducido en Electron con carpetas temporales, sin tocar skills personales: abrir una skill, editar su contenido hasta ver «Cambios sin guardar» y pulsar el botón nativo de cierre de macOS. No aparece confirmación; al reactivarse la aplicación se crea una nueva ventana en el inventario. El borrador del editor no se conserva.

El diálogo de descarte solo está conectado a la navegación interna. Los borradores viven en estado React y no hay protección de `beforeunload`/cierre nativo. **Este es el fallo funcional que priorizaría para la v1.** Conectar el estado de cambios pendientes con el cierre de ventana y la salida de la aplicación; ofrecer permanecer o descartar, o recuperar el borrador al volver. Cubrir edición y creación. Una operación ya confirmada y su undo son distintos de un borrador que todavía no se ha guardado.

Referencias: `apps/desktop/src/renderer/SkillWorkspace.ts:361`, `:472`; `apps/desktop/src/renderer/CreateSkillWorkspace.ts:61`, `:167`; `apps/desktop/src/main/window.ts:121`; `apps/desktop/src/main/index.ts:49`.

### 1. Resolver el recorrido «Descargar → instalar → usar»

Comprobado con GitHub CLI: `r-bart/skillglass` sigue siendo **privado** y no hay releases. La landing pública responde, pero sus enlaces de código, compilación, contribución y seguridad no son accesibles para un visitante anónimo. El botón «Descargar» lleva a una sección que propone compilar y esperar a futuros binarios.

Esto es el principal bloqueo de publicación: un visitante no puede probar el producto y tampoco verificar su carácter abierto.

Para cerrar: publicar un artefacto probado de la plataforma que vayas a respaldar, enlazarlo con claridad, hacer público el repositorio al lanzar y comprobar todo sin sesión de GitHub. Indicar arquitectura, versión, requisitos mínimos comprobados y pasos breves de instalación. Mantener las advertencias de firma cerca de la descarga, con lenguaje sencillo.

No exigiría soportar tres plataformas perfectamente para lanzar una herramienta pequeña. Puedes limitar la primera versión a la que uses realmente y etiquetar el resto como experimental. Omarchy no necesita frenar toda la v1: sí necesita su comprobación nativa antes de anunciarlo como verificado. El documento `packaging/arch/OMARCHY-VALIDATION.md` sigue pendiente según el estado del proyecto.

Referencias: `apps/landing/src/pages/index.astro:21`, `:53`, `:282`; `README.md:10`; `thoughts/STATE.md`; `.github/workflows/release.yml`.

### 2. Corregir la promesa sobre duplicados y precedencia

La web promete señalar qué copia gana cuando dos skills comparten nombre. La maqueta incluso dice que una instalación global tapa a otra del proyecto. El código real no demuestra esa ganadora: `CodexAdapter.resolveScope` no aporta `provenWinner` y, con varias candidatas, el dominio devuelve `conflict`.

Además, la documentación oficial actual de Codex explica que dos skills con el mismo nombre pueden aparecer en los selectores. Por tanto, no conviene «arreglar» el código inventando una precedencia para ajustarlo a la web.

**Cambio recomendado de promesa:** «Encuentra copias con el mismo nombre y consulta dónde está cada una». Usar un ejemplo real, coherente con el adaptador, tanto en la captura como en la explicación.

Referencias: `apps/landing/src/pages/index.astro:25`, `:38`, `:88`, `:276`; `packages/adapter-codex/src/codex-adapter.ts:304`; `packages/domain/src/resolution.ts:107`. Fuente externa: [documentación oficial de skills](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).

### 3. Ajustar la cobertura que se anuncia al descubrimiento real

El descubrimiento automático añade `.agents/skills` de usuario y proyectos y `/etc/codex/skills`. No hay descubrimiento equivalente de `.codex/skills` ni de las cachés de plugins que menciona el hero. Añadir manualmente una carpeta existe, pero exige conocerla. El escáner Codex también omite enlaces simbólicos cuyo destino queda fuera de la raíz escaneada.

Para una herramienta que vas a usar tú, haría una comprobación con las ubicaciones de skills que realmente utilizas. Hay dos cierres razonables: ampliar las propuestas de carpetas, conservando aprobación y acceso de solo lectura cuando corresponda; o explicar que solo se mostrarán las carpetas seleccionadas y cómo añadir las que faltan. No hace falta construir adaptadores de todos los agentes.

Comprobación manual: una raíz temporal con una skill física y otra enlazada hacia una carpeta externa muestra solo la primera, sin explicación visible de la omisión. Otra skill situada en `.codex/skills` no genera una propuesta automática de carpeta.

Evitar «todas», «cualquier skill» y las referencias a cachés automáticas mientras no estén cubiertas. Las ubicaciones que no se puedan escanear deberían explicarse, no simplemente desaparecer sin contexto.

Referencias: `packages/adapter-codex/src/codex-adapter.ts:193`, `:244`, `:271`; `apps/desktop/src/main/onboarding/root-service.ts`; `apps/landing/src/pages/index.astro:25`.

### 4. Subir la legibilidad del texto secundario

`--text-tertiary` usa `rgba(244,244,246,0.34)`. Sobre el fondo `#0b0b0d` produce aproximadamente **2,87:1** de contraste. Aparece en etiquetas, contexto y enlaces, combinado con tamaños de 9,5–11 px. El resultado se ve cuidado en una captura, pero exige esfuerzo durante el uso.

Subir contraste y tamaño de las etiquetas necesarias para interpretar una acción o un dato; reservar el nivel más tenue para decoración. No es necesario aclarar toda la aplicación ni añadir un tema claro. Comprobar los colores finales sobre cada superficie; no basta con verificar el modo de alto contraste.

También hay una referencia a `var(--focus-ring)` que no está definida y sustituye el contorno de foco del enlace GitHub del sidebar. Usar el token de foco existente.

Referencias: `apps/desktop/src/renderer/styles/tokens.css:16`, `:44`; `apps/desktop/src/renderer/styles/components.css:106`; `apps/desktop/src/renderer/styles/shell.css:668`.

## Tono y estilo de los textos

**El tono es demasiado defensivo y técnico para la utilidad que ofrece.** La intención de ser preciso es buena, pero seguridad, evidencia y restricciones ocupan más espacio que el trabajo que ayuda a hacer. En varios lugares parece hablar la especificación interna del producto.

Mantendría: segunda persona, frases directas, privacidad local y claridad sobre lo que se guarda. Recortaría: reiteraciones de «observado», «evidencia», «atómico», «harness», «runtime», «journal», «snapshot», «contrato de producto» y la insistencia en justificar lo que no hace.

Propuesta para el hero:

> **Encuentra y edita tus skills en un solo lugar.**
>
> Explora las carpetas que elijas, lee las instrucciones de cada skill y revisa los cambios antes de guardarlos. Una app local para Codex y carpetas compatibles con SKILL.md.
>
> Gratis y de código abierto. Sin cuenta ni telemetría.

El botón debe describir su destino real: «Descargar para macOS» cuando exista ese archivo; «Ver el código» mientras solo exista el repositorio público.

| Texto actual | Propuesta | Motivo |
| --- | --- | --- |
| «Sin puntuaciones misteriosas. Solo la evidencia.» | «Abre una skill y entiende qué hace.» | Expresa una utilidad concreta. |
| «El mapa completo, sin adivinar.» | «Encuentra, revisa y edita tus skills.» | Reduce una promesa absoluta. |
| «Instalaciones y evidencia observada en los ámbitos aprobados.» | «Las skills de las carpetas que has añadido.» | Se entiende al primer vistazo. |
| «…cuando el backend lo acredita.» | «Revisa los cambios antes de guardarlos.» | Elimina un detalle de implementación del flujo principal. |
| «El journal persistente…» | «El historial conserva las operaciones entre sesiones.» | Explica el resultado. |
| «snapshot» en mensajes generales | «copia de recuperación» | Mantiene el término técnico en el detalle avanzado. |
| «raíz aprobada» | «carpeta que has autorizado» | Hace visible la decisión del usuario. |
| «otro contrato de producto» | «Esta versión incluye un editor manual.» | Evita lenguaje de planificación interna. |
| «Preguntas razonables. Respuestas directas.» | «Preguntas frecuentes» | Ahorra retórica. |
| «Buscar actualizaciones» | «Comprobar cambios en los orígenes locales» en ayuda o tooltip | No sugiere una búsqueda en un registro remoto. |

La comprobación de actualizaciones recorre únicamente instalaciones con procedencia local reconstruible (`apps/desktop/src/main/operations/service.ts:352`). Conviene decir qué se puede actualizar, no solo que «actualiza skills».

La FAQ puede reducirse a cuatro preguntas: compatibilidad, privacidad, guardado/deshacer y limitaciones de la versión. Los permisos POSIX 0700/0600 y el detalle de retención encajan mejor en documentación técnica.

## Interfaz y estilo general

**Conservaría la dirección visual y simplificaría la información.** No recomiendo un rediseño.

1. **Reducir las etiquetas repetidas del inventario.** «En seguimiento» y varias píldoras «Sin datos» por fila dan mucha presencia a estados normales o vacíos. Mostrar de forma destacada lo accionable: estructura inválida, cambio local, actualización disponible o solo lectura. Mantener las dimensiones completas en el inspector y los filtros.
2. **Dar prioridad al contenido de la skill.** En editor e inspector, metadatos y mensajes de garantías compiten con las instrucciones. Ubicación y estado son útiles; hashes, identificadores y detalles de recuperación pueden ir bajo «Detalles técnicos».
3. **Acortar la entrada.** El tour tiene tres pantallas y después hay aprobación de carpetas y selección de seguimiento. Ya existe «Saltar explicación», lo cual ayuda. Para esta escala, consideraría una bienvenida y acceso directo a buscar; seguimiento puede configurarse después. Es una mejora, no un requisito para lanzar.
4. **Mejorar la vista previa de Markdown.** El renderer actual reconoce títulos, listas simples y bloques de código, pero deja negritas, código inline, tablas y listas numeradas sin interpretar. Para un producto cuyo valor es leer skills, esto aporta más que otra animación. Mantener HTML crudo desactivado y una política explícita para enlaces e imágenes. Referencia: `apps/desktop/src/renderer/SafeMarkdown.ts:22`.
5. **Completar idiomas y plurales.** El ejemplo visual HTML del landing permanece en español en `/`; también se comparte una captura de producto en español. La app arranca en español por defecto aunque la web use inglés por defecto. En el inspector español aparecen `Only candidate in the effective scope`, `Vínculo owned` y frases de evidencia en inglés. Con una skill se muestran «1 instalaciones» y «Buscar entre 1 skills». Traducir el ejemplo, humanizar los mensajes del adaptador, corregir singular/plural y elegir una política de idioma consistente. Referencias: `apps/landing/src/pages/index.astro:269`, `apps/desktop/src/renderer/i18n.ts:8`, `apps/desktop/src/renderer/inventory/Inspector.ts:125`.
6. **Acercar la demostración al principio en móvil.** A 390 × 844 el hero ocupa casi la primera pantalla y la captura aparece recortada. No observé desbordamiento horizontal. Recortar el texto inicial y usar una vista de detalle legible en móvil ayudaría más que comprimir el escritorio entero.

## Animaciones

La base es contenida: presiones de 90 ms, hover de 140 ms, transiciones de estado de 180–260 ms y una curva marcada. Hay manejo de movimiento reducido. El pulso durante un escaneo tiene un motivo y no lo quitaría por defecto. No identifiqué un motivo para añadir una librería de animación.

| Antes | Después | Por qué |
| --- | --- | --- |
| El sentido del carrusel depende de `data-slide`, no de avanzar o retroceder (`onboarding.css:123`). | Resolver la dirección por navegación; o quitar el desplazamiento y conservar una aparición breve. | Volver de la tercera a la segunda pantalla no debería comunicar el mismo avance espacial. |
| El brillo del CTA sigue el puntero con una transición de transform de 100 ms (`global.css:151`). | Probar seguimiento directo, conservando la transición de opacidad; también es válido dejar un brillo estático. | Es pulido opcional: eliminar el pequeño retraso puede hacer la interacción más directa. |
| Los hovers del bloque de acciones de escritorio no están condicionados al tipo de puntero (`components.css:70`). | Aplicar el mismo criterio de hover/puntero fino que ya usa la landing. | Evita estados hover persistentes en pantallas táctiles. |

**Veredicto de movimiento: aprobado con ajustes menores.** La legibilidad y los textos tienen mucha más prioridad. No añadiría apariciones al hacer scroll, animaciones en cada fila ni transiciones al cambiar de pestaña del editor.

## Lo que falta para generar autoridad

El producto muestra la marca Skillglass, pero la autoría queda diluida en «Skillglass contributors». Para el objetivo descrito, falta una conexión clara contigo.

- Una firma visible: «Hecho por Roberto», con enlace a tu perfil o web.
- Un párrafo breve sobre el problema real que te llevó a construirlo y cómo lo usas.
- Una demostración real de 20–40 segundos: encontrar una skill, abrirla, editar una instrucción, revisar el diff y deshacer.
- README orientado a quien llega por primera vez: qué resuelve, captura, descarga, compatibilidad y uso rápido. Después, compilación y contribución.
- Notas de la primera release con funciones, límites conocidos y un canal claro de feedback.

No hacen falta testimonios inventados, una newsletter, contenido SEO en serie ni una estrategia de comunidad. Para este proyecto, tu criterio y el producto funcionando son la prueba.

## Alcance que dejaría fuera de la v1

Marketplace, instalación desde cualquier URL, sincronización, cuentas, equipos, pagos, telemetría de uso, generación con IA, actualización automática de la aplicación, adaptadores para todos los agentes y un refactor amplio. Tampoco convertiría la firma comercial de todas las plataformas en un requisito universal: sí revisaría la fricción de instalación de la plataforma que promociones.

## Cierre propuesto

1. Corregir pérdidas de borrador o bloqueos de uso que se confirmen durante la comprobación final.
2. Alinear promesas y capturas con descubrimiento, duplicados y actualizaciones locales reales.
3. Mejorar contraste, simplificar textos principales y completar inglés.
4. Preparar README breve, autoría, demo real y notas de versión.
5. Cerrar el commit de publicación, ejecutar CI nativa sobre ese commit y probar el artefacto final.
6. Publicar repositorio y release, revisar enlaces sin sesión y conectar la descarga real.

Cuando esto esté cerrado, el proyecto ya tiene un alcance suficiente para una v1 de uso personal y presentación pública.

## Verificación realizada y límites

- Node 24.19.0 y pnpm 11.5.1.
- Typecheck de aplicación y helpers E2E, lint, Astro check y build estático: correctos.
- Vitest: 53 archivos, **371 pruebas correctas**.
- Auditoría de dependencias de producción con pnpm: sin vulnerabilidades notificadas por el registro. No sustituye una auditoría de seguridad del producto.
- Empaquetado actual de macOS arm64 completado, incluido el hook final de firma ad-hoc. El ejecutable local de Electron Forge había perdido su permiso de ejecución; se restauró ese permiso en `node_modules` para poder comprobar el empaquetado.
- E2E: primera ronda con 27 correctas, 3 fallos y 13 omitidas. La prueba nativa no encontraba aún el paquete y otras dos fallaron durante el arranque/rearranque de Electron, antes de verificar el comportamiento de negocio. Tras completar el empaquetado, las **3 pasan en una repetición dirigida**: arranque doble del binario y SQLite, navegación/scroll y edición con undo tras reiniciar. En total, las 30 pruebas activas pasan entre ambas rondas; no hubo una única ronda completa limpia.
- Las 13 comparaciones de píxeles están condicionadas a `FORGE_VISUAL_BASELINES=1` y no se ejecutaron. Se inspeccionaron capturas de referencia existentes, que incluyen versiones anteriores, y la aplicación actual con datos temporales.
- Landing comprobada visualmente en español e inglés, escritorio y 390 × 844. En móvil no se observó desbordamiento horizontal. La versión pública `/es/` devuelve HTTP 200; GitHub confirma repositorio privado y ausencia de releases.
- Prueba manual adicional del descubrimiento, inspector, vista previa de Markdown, edición y cierre nativo con datos aislados. Se confirma el cierre sin aviso y la omisión del enlace fuera de la raíz.
- No se han ejecutado nuevas pruebas nativas en Windows, Linux ni Omarchy. La última CI remota observada es del commit anterior a los cambios locales; el commit final de publicación sigue necesitando su propia matriz.
- No se han cambiado funcionalidades, commits, visibilidad del repositorio ni releases. El único archivo de proyecto añadido por esta revisión es este informe.
