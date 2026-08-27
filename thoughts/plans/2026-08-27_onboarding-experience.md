# Plan de implementación: onboarding de inventario y seguimiento

**Fecha**: 2026-08-27  
**Estado**: Complete — implementado y verificado  
**Prototipo de referencia**: `thoughts/research/prototypes/onboarding/?v=2&copy=final-polish`, variante **Enfoque**

---

## Objetivo

Sustituir el onboarding técnico actual por una experiencia de primer uso que explique el valor de Skill Forge, obtenga de forma explícita el permiso para escanear ubicaciones locales, permita elegir qué skills seguir de cerca y termine en el inventario existente.

La selección de seguimiento no elimina ni oculta skills: todas las instalaciones de las carpetas aprobadas permanecen visibles y actualizadas en el inventario. La selección determina qué skills se destacan y aparecen en las superficies de atención, especialmente `Por revisar`.

## Requisitos

- [x] Mostrar una bienvenida de tres slides con el copy aprobado:
  1. Entender todas las skills existentes.
  2. Abrir una skill y verla en detalle.
  3. Crear skills para flujos repetidos.
- [x] Permitir avanzar, retroceder, usar los indicadores y saltar la explicación.
- [x] Preservar la aprobación explícita de rutas antes del primer escaneo.
- [x] Resolver la aprobación y el escaneo como un estado preparatorio dentro del último paso, sin convertir las carpetas en la narrativa principal.
- [x] Mostrar las skills descubiertas con búsqueda y filtros `Todas`, `Global` y `Proyecto…`.
- [x] Permitir seleccionar o quitar todas las skills visibles sin alterar las ocultas por el filtro.
- [x] Mostrar el total seleccionado de forma global y persistir la selección por `installationId`.
- [x] Enviar al usuario a `Inventario · Todas las skills` tras completar el flujo y mostrar “Tu inventario está listo”.
- [x] Mantener las skills no seleccionadas visibles en el inventario.
- [x] Filtrar `Por revisar` para que solo incluya skills bajo seguimiento.
- [x] Permitir cambiar la selección posteriormente desde el inventario.
- [x] Mantener toda la información y persistencia en el dispositivo, sin registrar ejecuciones ni conversaciones.
- [x] Soportar teclado, lector de pantalla, movimiento reducido y ventanas estrechas de 760 × 520.
- [x] No forzar el nuevo onboarding a instalaciones existentes: deben conservar el comportamiento actual con todas sus skills bajo seguimiento.

---

## Decisiones de producto y dominio

### Qué significa “monitorizar”

`Monitorizar` será una preferencia de atención, no un nuevo límite de acceso al sistema de archivos:

- Las **carpetas aprobadas** siguen siendo el límite de seguridad y observación.
- El scanner y el watcher mantienen actualizado el inventario completo.
- Las **skills bajo seguimiento** reciben la etiqueta correspondiente y alimentan `Por revisar`.
- Las skills no seleccionadas siguen visibles y pueden inspeccionarse, editarse o añadirse al seguimiento después.

Esto evita que el inventario muestre información obsoleta y mantiene separadas autorización, observación y preferencia de usuario.

### Estado del flujo

El renderer manejará una máquina de estados explícita:

```ts
type OnboardingStep =
  | { kind: "loading" }
  | { kind: "intro"; slide: 0 | 1 | 2 }
  | { kind: "sources" }
  | { kind: "scanning" }
  | { kind: "skills" }
  | { kind: "saving" }
  | { kind: "complete" }
```

Reglas de entrada:

- Sin aprobación de raíces: empezar en `intro` y pasar a `sources` al continuar o saltar.
- Raíces aprobadas pero onboarding de seguimiento incompleto: reanudar directamente en `skills` después del escaneo de arranque.
- Raíces y seguimiento completos: abrir el inventario; el menú `Carpetas` conserva la gestión de ubicaciones actual.
- Instalación anterior a esta funcionalidad: inicializar todas las instalaciones existentes como seguidas y no interrumpir el arranque.

### Selección inicial

- En un onboarding nuevo, preseleccionar todas las skills descubiertas. Es la opción más segura respecto al comportamiento actual y evita omisiones silenciosas.
- Permitir que el usuario quite skills individualmente o por filtro.
- Si existen skills, exigir al menos una selección para completar.
- Si el escaneo válido devuelve cero skills, permitir abrir un inventario vacío y ofrecer añadir otra carpeta o proyecto; el onboarding no debe convertirse en un callejón sin salida.

---

## Análisis de alternativas

### Opción A: reutilizar la aprobación de carpetas como “monitorización”

**Descripción**: mantener únicamente la selección de raíces y presentar sus skills como si fueran seleccionables, sin persistencia por instalación.

**Ventajas**:

- Menor cambio de contratos y servicios.
- Implementación inicial más corta.

**Inconvenientes**:

- No permite seleccionar skills individuales dentro de una misma carpeta.
- El copy prometería una preferencia que el producto no recuerda.
- No permite gestionar el seguimiento desde el inventario.

**Complejidad**: baja, pero semánticamente incorrecta.

### Opción B: selección persistente por instalación, separada de las raíces

**Descripción**: añadir un servicio de seguimiento con contratos tipados y persistencia local. Las raíces controlan acceso; los `installationId` controlan atención.

**Ventajas**:

- Coincide con el prototipo y con el modelo mental mostrado al usuario.
- Mantiene el inventario completo y correcto.
- Permite reutilizar la misma selección durante y después del onboarding.
- Evita ampliar permisos o introducir rutas arbitrarias por IPC.

**Inconvenientes**:

- Añade un pequeño contrato y servicio de aplicación.
- Requiere definir compatibilidad para usuarios existentes.

**Complejidad**: media.

### Recomendación

Implementar la **Opción B**. Es la única que convierte la selección visual en una capacidad real sin mezclarla con la política de seguridad de raíces aprobadas.

---

## Contratos propuestos

Crear `packages/contracts/src/ipc/monitoring.ts`:

```ts
export const MonitoringStateDtoSchema = z.object({
  status: z.enum(["required", "complete"]),
  selectedInstallationIds: z.array(InstallationIdSchema).max(2_000),
  completedAt: IsoDateTimeSchema.optional(),
}).strict()

export const SaveMonitoringSelectionInputSchema = z.object({
  installationIds: z.array(InstallationIdSchema).max(2_000),
}).strict().superRefine(rejectDuplicates)
```

Extender el bridge sin alterar el contrato de aprobación de raíces:

```ts
interface ForgeBridge {
  monitoring: {
    state(): Promise<MonitoringStateDto>
    save(input: SaveMonitoringSelectionInput): Promise<MonitoringStateDto>
  }
}
```

Canales nuevos:

```ts
monitoringState: "forge:monitoring:state"
monitoringSave: "forge:monitoring:save"
```

El proceso main validará que todos los `installationIds` enviados existen en la proyección actual. El renderer nunca enviará rutas.

---

## Archivos a crear o modificar

| Archivo | Acción | Propósito |
|---|---|---|
| `packages/contracts/src/ipc/monitoring.ts` | Crear | Schemas y DTOs del seguimiento |
| `packages/contracts/src/ipc/{index,channels,contracts,bridge}.ts` | Modificar | Registrar canales y ampliar `ForgeBridge` |
| `packages/contracts/src/ipc/contracts.test.ts` | Modificar | Round-trip, límites, duplicados e inputs inválidos |
| `apps/desktop/src/preload/bridge.ts` | Modificar | Exponer únicamente los dos métodos tipados nuevos |
| `apps/desktop/src/main/monitoring/settings-repository.ts` | Crear | Persistir `monitoring.selection.v1` en SQLite settings |
| `apps/desktop/src/main/monitoring/service.ts` | Crear | Validar selección, compatibilidad legacy y estado |
| `apps/desktop/src/main/monitoring/ipc.ts` | Crear | Registrar handlers con validación de emisor y schema |
| `apps/desktop/src/main/monitoring/index.ts` | Crear | Exportaciones del módulo |
| `apps/desktop/src/main/monitoring/*.test.ts` | Crear | Repositorio, servicio e IPC |
| `apps/desktop/src/main/onboarding/composition.ts` | Modificar | Componer servicio, IPC y bootstrap legacy |
| `apps/desktop/src/renderer/onboarding/OnboardingFlow.ts` | Crear | Máquina de estados y coordinación del flujo |
| `apps/desktop/src/renderer/onboarding/WelcomeCarousel.ts` | Crear | Slides, navegación, indicadores y copy |
| `apps/desktop/src/renderer/onboarding/SourceApprovalStep.ts` | Crear | Adaptación compacta del permiso de raíces actual |
| `apps/desktop/src/renderer/onboarding/SkillSelectionList.ts` | Crear | Lista reutilizable con filtros, búsqueda y selección visible |
| `apps/desktop/src/renderer/onboarding/MonitoringManagerDialog.ts` | Crear | Edición posterior desde el inventario |
| `apps/desktop/src/renderer/onboarding/*.test.ts` | Crear | Comportamiento, accesibilidad y estados de error |
| `apps/desktop/src/renderer/inventory/load-all.ts` | Crear | Paginación común para onboarding, gestión y pendientes |
| `apps/desktop/src/renderer/App.ts` | Modificar | Integrar estados, routing, persistencia y destino final |
| `apps/desktop/src/renderer/inventory/Inventory.ts` | Modificar | Acción “Gestionar seguimiento” y estado visual por fila |
| `apps/desktop/src/renderer/Pending.ts` | Modificar | Mostrar solo pendientes de skills seguidas |
| `apps/desktop/src/renderer/styles/onboarding.css` | Crear | Estilos aislados del flujo aprobado |
| `apps/desktop/src/renderer/main.ts` | Modificar | Importar el nuevo módulo de estilos antes de responsive |
| `apps/desktop/src/renderer/styles/responsive.css` | Modificar | Integración con breakpoints y ventana mínima existentes |
| `apps/desktop/src/renderer/App.test.ts` | Modificar | Routing, compatibilidad y finalización |
| `tests/e2e/support/forge-test-app.ts` | Modificar | Helpers para slides, fuentes y selección |
| `tests/e2e/support/forge-visual-fixture.ts` | Modificar | Escenarios visuales de bienvenida y selección |
| `tests/e2e/accessibility-keyboard.e2e.spec.ts` | Modificar | Flujo completo por teclado y movimiento reducido |
| `tests/e2e/project-selection.e2e.spec.ts` | Modificar | Mantener aprobación explícita dentro del nuevo flujo |
| `tests/e2e/visual-fidelity.e2e.spec.ts` | Modificar | Capturas de los dos estados clave |
| `tests/e2e/visual-fidelity.e2e.spec.ts-snapshots/*` | Actualizar | Baselines inspeccionados del onboarding aprobado |

No hace falta una migración estructural de SQLite: la selección cabe en el repositorio `settings`, igual que la aprobación de raíces y los proyectos. Se versionará el documento para permitir una migración futura.

---

## Fases de implementación

### Fase 0: contrato de aceptación

#### Task 0.1: definir tests de especificación del onboarding

Crear un manifiesto específico en `thoughts/tests/2026-08-27_onboarding-experience.md` antes de implementar. Debe cubrir:

- No se escanea antes de aprobar raíces.
- El flujo puede recorrerse o saltarse con teclado.
- La selección se persiste por ID opaco, no por ruta.
- `Global` y cada proyecto filtran sin perder selección oculta.
- Las skills no seguidas continúan visibles.
- `Por revisar` solo muestra skills seguidas.
- El flujo se reanuda tras cerrar durante el escaneo o antes de guardar.
- Una instalación existente no queda bloqueada por el nuevo onboarding.

El suite inmutable existente `tests/spec/forge-mvp.e2e.spec.ts` no se modificará.

### Fase 1: persistencia y frontera IPC

#### Task 1.1: añadir contratos de seguimiento

Añadir schemas, tipos, canales y métodos del bridge. Mantener el allowlist cerrado y validar input/output en ambos extremos.

#### Task 1.2: implementar repositorio y servicio

Persistir este documento:

```ts
interface MonitoringSelectionDocument {
  readonly version: 1
  readonly updatedAt: string
  readonly completedAt: string
  readonly installationIds: readonly string[]
}
```

Comportamiento del servicio:

1. `state()` devuelve `required` si no existe documento.
2. `save()` deduplica mediante rechazo, valida contra `ProjectionRepository` y persiste de forma atómica usando `SettingsRepository`.
3. Los IDs guardados que no estén presentes temporalmente se conservan, pero no se muestran como seleccionados hasta que reaparezcan.
4. En una instalación legacy —aprobación de raíces existente al arrancar y sin documento de seguimiento— guardar una selección inicial con todas las instalaciones proyectadas y estado `complete`.

#### Task 1.3: componer IPC, preload y ciclo de vida

- Registrar los handlers junto a onboarding e inventory.
- Capturar si la aprobación de raíces ya existía **antes** de cualquier acción del nuevo flujo para distinguir legacy de una instalación nueva reanudada.
- Hacer que `monitoring.state()` espere una promesa interna de arranque. `startPersistedScan()` resolverá esa promesa después del escaneo inicial y del bootstrap legacy, incluso cuando no hubiera raíces persistidas. Así no se guarda accidentalmente una selección legacy vacía mientras la proyección todavía se está reconstruyendo.
- Mantener un único servicio por proceso y cerrar sus handlers en `dispose()`.
- No añadir APIs de filesystem al renderer.

### Fase 2: componentes del flujo

#### Task 2.1: extraer carga paginada y modelo de selección

Crear `loadAllInventoryItems()` con `pageSize: 100` y cursores. Reutilizarlo desde `Pending`, onboarding y el diálogo de gestión.

El modelo local conservará la selección total independientemente del filtro:

```ts
visible = items.filter(matchesScope).filter(matchesSearch)
allVisibleSelected = visible.length > 0 && visible.every(isSelected)
toggleVisible = allVisibleSelected ? remove(visible) : add(visible)
```

#### Task 2.2: implementar el carrusel de bienvenida

- Llevar el markup conceptual de `variants/focus.js` a React semántico.
- Usar un `h1` único por slide, grupo accesible de indicadores y botones reales.
- Mantener `Continuar`, `Anterior`, `Saltar explicación` y `Elegir mis skills`.
- Mover el foco al título de cada slide después de una navegación iniciada por el usuario.
- Con `prefers-reduced-motion`, cambiar de contenido sin transición espacial.

#### Task 2.3: adaptar la aprobación de fuentes al último paso

- Extraer el componente `Onboarding` actual de `App.ts` como `SourceApprovalStep`.
- Conservar paths, acceso, evidencia, selección nativa de carpeta y selección de proyecto Codex.
- Cambiar la jerarquía de copy para presentarlo como preparación: “Elige dónde buscar tus skills”.
- El CTA aprueba raíces y muestra `Buscando skills…`; solo entonces se llama al scanner existente.
- En error, conservar selección y mostrar retry; nunca avanzar con un escaneo fallido.

#### Task 2.4: implementar selección y gestión reutilizable

`SkillSelectionList` recibirá items, proyectos, selección y callbacks; no conocerá IPC. Incluirá:

- Contador total “bajo seguimiento”.
- `Todas`, `Global`, `Proyecto…` con conteos.
- Búsqueda contextual y estado vacío estable.
- Filas completas clicables, checkbox nativo, descripción, scope y path de origen. El path se resolverá con un mapa `rootId → approvedRoot.displayPath` del estado de onboarding; no se hará un `inspect()` por fila.
- `Seleccionar las visibles` / `Quitar las visibles`.
- CTA `Abrir mi inventario` durante onboarding.

`MonitoringManagerDialog` reutilizará la lista y guardará mediante el mismo bridge. Al cancelar, restaurará la selección persistida.

### Fase 3: integración en la aplicación

#### Task 3.1: integrar routing y reanudación en `App`

- Cargar en paralelo el estado de raíces y el de seguimiento.
- Sustituir `onboardingRequired` por `setupRequired`:

```ts
const setupRequired = roots.status !== "complete" || monitoring.status !== "complete"
```

- Mientras `setupRequired`, renderizar una shell de onboarding dedicada sin sidebar ni operaciones.
- Tras aprobar raíces, recargar el inventario completo y avanzar a `skills`.
- Tras guardar la selección, establecer scope `{ kind: "all" }`, navegar a `inventory`, incrementar la revisión y restaurar el foco en el título.
- Mostrar un aviso accesible “Tu inventario está listo”.
- Al volver posteriormente a `Carpetas`, mostrar gestión de raíces, no el carrusel.

#### Task 3.2: conectar seguimiento con inventario y pendientes

- Pasar el `ReadonlySet<installationId>` desde `App` a `Inventory` y `Pending`.
- En inventario, mostrar una etiqueta discreta `En seguimiento` sin ocultar el resto.
- Añadir `Gestionar seguimiento` en la cabecera del inventario y abrir el diálogo reutilizable.
- En `Pending`, aplicar el filtro de seguimiento después de cargar todos los items y antes de agrupar por actualización, conflicto o validación.
- Si una skill deja de seguirse mientras está seleccionada en un lote, retirarla también de la selección del lote.
- El watcher continúa reconciliando todas las raíces aprobadas; no se modifica su política de seguridad ni la invalidación de planes.

### Fase 4: fidelidad visual y accesibilidad

#### Task 4.1: trasladar el lenguaje visual aprobado

- Reutilizar tokens existentes y portar únicamente los valores que no tengan equivalente.
- Mantener superficies oscuras con borde/inset en vez de sombras ambientales pesadas.
- Mantener radios anidados coherentes: contenedor 12 px, controles interiores 8 px.
- Reservar espacio estable para contador, lista, loading y vacío.
- Aplicar hover solo con `(hover: hover) and (pointer: fine)`.
- Evitar `transition: all`; animar solo `opacity` y `transform`, máximo 180–220 ms.
- No convertir el mockup del picker de prototipos en código de producción.

#### Task 4.2: completar tests unitarios y de contrato

Casos mínimos:

- Schemas rechazan IDs duplicados, desconocidos y payloads extra.
- Repositorio hace round-trip y rechaza documentos corruptos.
- Servicio distingue clean install, reanudación y legacy bootstrap.
- Carrusel conserva índice, límites y navegación por indicadores.
- Selección por scope y búsqueda no borra selecciones ocultas.
- `toggle visible` solo afecta filas visibles.
- Aprobación fallida no avanza; guardado fallido no sale al inventario.
- Cero skills permite completar con inventario vacío.
- `Pending` excluye no seguidas.

#### Task 4.3: actualizar E2E y snapshots

Escenarios visuales a capturar en 1420 × 892:

1. Primer slide de bienvenida.
2. Selección final con filtros y varias skills seleccionadas.

Verificaciones adicionales:

- Flujo completo a 760 × 520.
- Teclado únicamente, foco visible y orden lógico.
- `prefers-reduced-motion: reduce`.
- Proyecto seleccionado desde cwd neutral.
- Reinicio entre aprobación y selección final.
- Reinicio después de completar abre inventario directamente.
- Gestión posterior desde inventario.

#### Task 4.4: revisión final

- Ejecutar revisión visual contra el prototipo Enfoque.
- Revisar copy final en contexto real y truncados con nombres largos.
- Ejecutar `/post-review` tras completar el plan.

---

## Dependencias de tareas

```yaml
dependencies:
  0.1: []
  1.1: [0.1]
  1.2: [1.1]
  1.3: [1.2]
  2.1: [1.1]
  2.2: [0.1]
  2.3: [2.2]
  2.4: [2.1]
  3.1: [1.3, 2.2, 2.3, 2.4]
  3.2: [3.1]
  4.1: [3.1, 3.2]
  4.2: [1.3, 3.2]
  4.3: [4.1, 4.2]
  4.4: [4.3]
```

Las tareas `1.2`, `2.1` y `2.2` pueden desarrollarse en paralelo después de cerrar contratos y aceptación. La integración de `App.ts` debe esperar a que estén terminadas.

---

## Riesgos y mitigaciones

### Confundir seguimiento con autorización

**Riesgo**: que deseleccionar una skill parezca revocar acceso a su carpeta.  
**Mitigación**: copy explícito, modelos separados y gestión de carpetas independiente.

### Inventario desactualizado

**Riesgo**: observar solo directorios seleccionados impediría descubrir cambios en el resto.  
**Mitigación**: mantener watcher/scanner por raíz aprobada y aplicar seguimiento únicamente a atención y presentación.

### Carrera entre escaneo y selección

**Riesgo**: abrir `skills` antes de que la proyección esté reemplazada.  
**Mitigación**: `approveRoots()` ya espera a `scanService.scan()`; cargar items solo después de resolver ese promise y mostrar estado `scanning` mientras tanto.

### IDs que desaparecen

**Riesgo**: una skill eliminada deja un ID persistido.  
**Mitigación**: conservar el ID para poder reanudar si reaparece, pero intersectarlo con la proyección actual al presentar y contar.

### Regresión para usuarios existentes

**Riesgo**: una base de datos anterior tiene raíces completas pero no documento de seguimiento.  
**Mitigación**: detectar este caso antes de cualquier aprobación nueva, seleccionar todas las instalaciones actuales y marcar el onboarding como completo.

### Listas grandes

**Riesgo**: renderizar cientos de filas en el último paso.  
**Mitigación**: reutilizar paginación para cargar, limitar contrato a 2.000 IDs y virtualizar solo si una medición real supera el presupuesto; no introducir virtualización preventivamente.

### Accesibilidad del cambio de slide

**Riesgo**: el contenido cambia sin contexto para teclado o lector de pantalla.  
**Mitigación**: título enfocable con `tabIndex=-1`, foco programático tras acción, estado de progreso textual y movimiento reducido.

---

## Estrategia de pruebas

### Unitarias

- Contratos y repositorios de seguimiento.
- Servicio de compatibilidad legacy.
- Reducer/máquina de estados del onboarding.
- Filtros, búsqueda, selección visible y estado vacío.
- Filtrado de `Pending`.

### Integración

- IPC main ↔ preload con allowlist y sender confiable.
- Aprobar raíces → escanear → listar instalaciones → guardar seguimiento.
- Persistencia y reapertura de SQLite.

### E2E Electron

- Primera ejecución completa.
- Saltar explicación.
- Selección de proyecto y skill.
- Reinicio en estados intermedios.
- Gestión posterior desde inventario.
- Instalación legacy.
- Teclado, narrow viewport y reduced motion.

### Visual

- Comparar bienvenida y selección con la variante Enfoque.
- Inspeccionar manualmente snapshots antes de aceptarlos.
- No actualizar snapshots para ocultar regresiones funcionales.

---

## Criterios de terminado

### Contratos y persistencia

- [x] Los canales de seguimiento están en el allowlist y validan ambos extremos.
- [x] Ningún payload nuevo contiene paths o comandos arbitrarios.
- [x] La selección persiste tras reiniciar y un usuario legacy conserva todas sus skills seguidas.

### Flujo

- [x] Un usuario nuevo ve los tres mensajes aprobados y puede recorrerlos o saltarlos.
- [x] Ninguna raíz se escanea antes de aprobación explícita.
- [x] El último paso lista instalaciones reales, no fixtures.
- [x] Global/proyecto/búsqueda y selección visible funcionan sin perder estado oculto.
- [x] Completar abre `Inventario · Todas las skills` y anuncia “Tu inventario está listo”.
- [x] Reabrir la aplicación no vuelve a mostrar el onboarding completado.

### Producto

- [x] Una skill no seguida permanece visible en inventario.
- [x] `Por revisar` excluye skills no seguidas.
- [x] La selección puede modificarse desde inventario.
- [x] Gestión de carpetas continúa accesible y separada.

### Calidad

- [x] El manifiesto nuevo de tests pasa y no se ha modificado para adaptarlo a la implementación.
- [x] El suite inmutable existente permanece intacto y pasa: `pnpm exec playwright test tests/spec/forge-mvp.e2e.spec.ts`.
- [x] Checks completos: `pnpm run typecheck && pnpm run lint && pnpm test`.
- [x] E2E completo: `pnpm run test:e2e`.
- [x] Paquete de escritorio sigue arrancando mediante el smoke test existente.
- [x] No hay `TODO`, `FIXME` o `HACK` nuevos.
- [x] Revisión final visual y de accesibilidad sin findings bloqueantes.

---

## Verificación sugerida durante la implementación

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm exec playwright test tests/spec/forge-mvp.e2e.spec.ts
pnpm exec playwright test tests/e2e/accessibility-keyboard.e2e.spec.ts tests/e2e/project-selection.e2e.spec.ts
pnpm exec playwright test tests/e2e/visual-fidelity.e2e.spec.ts
pnpm run test:e2e
```

La actualización de snapshots debe hacerse únicamente después de inspeccionar el resultado a 1420 × 892 y 760 × 520.

---

## Evidencia de cierre

- `pnpm run typecheck`: PASS con Node 24.19.0 y pnpm 11.5.1.
- `pnpm run lint`: PASS.
- `pnpm test`: 52 archivos, 366 tests, PASS.
- `pnpm run test:e2e`: 43 escenarios, PASS; incluye paquete nativo, teclado, 760 × 520, reduced motion, reinicios y visuales.
- Suite inmutable: 10/10, hash conservado `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`.
- Snapshots de onboarding, selección, inventario e inspector inspeccionados antes de aceptar sus baselines.
- Post-review completado sin findings bloqueantes tras corregir validación de IDs, recuperación dinámica y seguimiento de skills nuevas.
