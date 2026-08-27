# Test Manifest: Onboarding Experience

**Date**: 2026-08-27
**Specs**: `thoughts/plans/2026-08-27_onboarding-experience.md`, `thoughts/tests/2026-08-26_forge-mvp.md`
**Status**: implemented; acceptance and regression coverage passing
**Immutable baseline suite**: `tests/spec/forge-mvp.e2e.spec.ts`

---

## Traceability Matrix

| Spec item | Business behavior | Scenario | Status |
|---|---|---|---|
| ONB-ROOT-APPROVAL/AC-1 | Ninguna raíz se escanea antes de su aprobación explícita | ONB-1 | Passing |
| ONB-KEYBOARD/AC-1 | El recorrido completo y el salto de la explicación funcionan solo con teclado | ONB-2 | Passing |
| ONB-SELECTION-PERSISTENCE/AC-1 | La selección se persiste mediante IDs opacos de instalación, nunca mediante rutas | ONB-3 | Passing |
| ONB-SCOPE-FILTERS/AC-1 | `Global` y cada proyecto filtran sin perder selecciones ocultas | ONB-4 | Passing |
| ONB-INVENTORY-VISIBILITY/AC-1 | Las skills no seguidas permanecen visibles en el inventario | ONB-5 | Passing |
| ONB-PENDING-ATTENTION/AC-1 | `Por revisar` incluye únicamente skills bajo seguimiento | ONB-6 | Passing |
| ONB-RESUME/AC-1 | El onboarding se reanuda tras cerrar durante el escaneo o antes de guardar | ONB-7 | Passing |
| ONB-LEGACY-COMPATIBILITY/AC-1 | Una instalación existente no queda bloqueada por el nuevo onboarding | ONB-8 | Passing |

## Acceptance Scenarios

### ONB-1 — La aprobación precede al primer escaneo

**Given** una primera ejecución sin raíces aprobadas  
**When** se abre el onboarding y se recorre o salta la explicación  
**Then** no se inicia ningún escaneo antes de que el usuario apruebe explícitamente al menos una raíz  
**And** el escaneo solo comienza después de confirmar esa aprobación.

### ONB-2 — Recorrido y salto mediante teclado

**Given** el onboarding abierto en el primer slide  
**When** el usuario opera exclusivamente con el teclado  
**Then** puede avanzar por los tres slides, retroceder y usar sus indicadores hasta llegar a la aprobación de fuentes  
**And** en una ejecución alternativa puede activar `Saltar explicación` y llegar al mismo paso sin recorrer los slides restantes.

### ONB-3 — Persistencia por ID opaco

**Given** varias instalaciones descubiertas bajo raíces aprobadas  
**When** el usuario guarda un subconjunto para seguimiento y reinicia la aplicación  
**Then** se restaura exactamente el mismo conjunto mediante sus `installationId`  
**And** ni el payload de guardado ni el documento persistido representan la selección mediante paths de filesystem.

### ONB-4 — Los filtros conservan la selección oculta

**Given** skills globales y skills pertenecientes a más de un proyecto  
**When** el usuario cambia entre `Global` y cada proyecto detectado y modifica la selección visible  
**Then** cada filtro muestra únicamente las skills de su ámbito  
**And** las selecciones fuera del filtro activo se conservan  
**And** al volver a su ámbito o a `Todas` reaparecen con el mismo estado de selección.

### ONB-5 — El seguimiento no oculta skills del inventario

**Given** que el usuario completa el onboarding dejando al menos una skill fuera del seguimiento  
**When** abre `Inventario · Todas las skills`  
**Then** aparecen tanto las skills seguidas como las no seguidas  
**And** la skill no seguida continúa disponible para verla en detalle.

### ONB-6 — `Por revisar` respeta la preferencia de seguimiento

**Given** una skill seguida y otra no seguida con motivos para aparecer en `Por revisar`  
**When** el usuario abre `Por revisar`  
**Then** aparece la skill seguida  
**And** la skill no seguida queda excluida.

### ONB-7 — Reanudación segura en estados intermedios

**Given** una instalación nueva con raíces ya aprobadas y seguimiento todavía incompleto  
**When** la aplicación se cierra durante el escaneo y vuelve a abrirse  
**Then** reconstruye el inventario y continúa hacia la selección de skills sin solicitar de nuevo la aprobación ni marcar el onboarding como completo  
**And when** en una ejecución alternativa se cierra después del escaneo pero antes de guardar la selección  
**Then** vuelve al paso de selección y permite completarlo.

### ONB-8 — Compatibilidad con instalaciones existentes

**Given** una instalación anterior con raíces aprobadas y skills proyectadas, pero sin documento de seguimiento  
**When** arranca por primera vez con la nueva versión  
**Then** abre la aplicación sin interponer el nuevo onboarding  
**And** inicializa como seguidas todas las instalaciones existentes.

## Coverage Summary

- Comportamientos de aceptación definidos: 8
- Escenarios de aceptación especificados: 8
- Elementos mapeados: 8
- Cobertura de trazabilidad del contrato: 100%
- Estado de ejecución: PASS en unitarios, E2E dedicados, suite inmutable y suite completa.
- Evidencia final: 366 tests unitarios y 43 E2E pasando con Node 24.19.0 y pnpm 11.5.1.

## Immutability Rule

No se modificará `tests/spec/forge-mvp.e2e.spec.ts` para acomodar el onboarding. La implementación y el nuevo soporte de pruebas deben satisfacer estos ocho escenarios sin alterar el contrato Forge MVP existente. Si cambia un comportamiento de negocio, primero debe revisarse este manifiesto de forma explícita; un fallo no se resolverá debilitando sus aserciones.
