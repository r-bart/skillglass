# Onboarding experience — post-review

**Date**: 2026-08-27  
**Plan**: `thoughts/plans/2026-08-27_onboarding-experience.md`  
**Verdict**: Ready for PR

## What worked well

1. Separar aprobación de carpetas y seguimiento mantuvo intacta la frontera de seguridad: las rutas se gestionan en main y el renderer solo persiste IDs opacos.
2. Un marcador versionado independiente distingue una instalación nueva reanudada de una instalación legacy sin depender del estado momentáneo del escaneo.
3. La lista de selección reutilizable permitió compartir búsqueda, filtros y semántica entre onboarding y gestión posterior sin duplicar lógica.
4. Las pruebas visuales de geometría detectaron un problema real de centrado que no aparecía en los tests de componentes.

## What was difficult

1. El seguimiento persistido puede contener IDs temporalmente ausentes. La frontera correcta es conservarlos internamente, proyectar solo los disponibles y rechazar cualquier ID ausente que vuelva desde IPC.
2. Una skill puede reaparecer durante la sesión; el renderer debe refrescar el estado de seguimiento cuando cambia el inventario, no solo al arrancar.
3. Las skills creadas o instaladas después del onboarding necesitan entrar automáticamente en seguimiento para conservar el valor de `Por revisar` sin alterar una configuración todavía incompleta.
4. El suite inmutable conserva el contrato histórico de aprobación directa. El seam E2E mantiene esa compatibilidad, mientras los specs nuevos validan el flujo y copy de producción completos.

## Patterns discovered

- **Autorización ≠ observación ≠ atención**: modelar estas tres responsabilidades por separado evita mezclar permisos de filesystem con preferencias de producto.
- **Persistencia completa, proyección disponible**: conservar IDs ausentes en storage y filtrarlos únicamente al construir el DTO permite recuperación automática cuando reaparecen.
- **Eventos de inventario refrescan preferencias derivadas**: si una preferencia se proyecta contra entidades dinámicas, debe recalcularse tras reconciliaciones del inventario.
- **Operaciones creadoras amplían seguimiento**: añadir la nueva instalación después del rescan confirmado mantiene `Por revisar` coherente sin completar un onboarding pendiente.

## CLAUDE.md update

No se requiere: el repositorio no contiene una regla de arquitectura equivalente y los patrones quedan documentados en el plan y esta nota.
