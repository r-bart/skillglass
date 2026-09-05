# Verificación del candidato local Skillglass v1.0.0

Fecha: 2026-09-05. El candidato de producto quedó registrado en `48d0a7f10e6cfd1b3826626b1b32e75ab18f67a2` y se subió a `origin/develop` con `[skip ci]` para permitir la prueba local antes de la matriz nativa.

## Resultado

El producto queda preparado como candidato local para una v1 pequeña. Se han cerrado los fallos funcionales, de claridad, estilo, movimiento, localización y preparación de release identificados en la revisión inicial. La revisión arquitectónica final devuelve **PASS, sin hallazgos accionables**.

La publicación sigue pendiente porque la matriz nativa, el tag definitivo, la visibilidad del repositorio, la release y el despliegue público aún no se han ejecutado.

## Cambios verificados

- Cierre nativo protegido para borradores de creación y edición y para operaciones en curso.
- Propuesta de `.codex/skills` con consentimiento, raíces gestionadas de solo lectura y avisos estructurados para omisiones de escaneo.
- Duplicados descritos por su ubicación, sin inventar activación o precedencia.
- Interfaz completa en español e inglés, con pluralización y datos del usuario conservados literalmente.
- Markdown habitual mediante AST y lista permitida; HTML, imágenes y enlaces no admitidos quedan inertes.
- Onboarding corto con explicación y selección detallada opcionales.
- Contraste terciario elevado de aproximadamente 2,87:1 a 4,63–4,66:1 según la superficie; foco, teclado, movimiento reducido y zoom comprobados.
- Movimiento limitado a propiedades compuestas, hovers condicionados a puntero fino y brillo principal estático.
- Landing bilingüe con promesa ajustada al producto, demo por capturas reales, autoría de Roberto, enlaces de feedback y estado de descarga sin enlaces ficticios.
- Pasada final con `better-writing`: enlaces orientados al destino, botones con verbo, vocabulario consistente y eliminación del lenguaje interno de validación del recorrido principal.
- Pasada final con `better-layout`: rejillas equilibradas, agrupación por importancia y pista visible del carrusel móvil.

## Pruebas locales

- Node `v24.19.0` y pnpm `11.5.1`.
- Typecheck del monorepo y de helpers E2E: PASS.
- ESLint: PASS.
- Vitest: **55 archivos, 414 pruebas, PASS**.
- Auditoría de dependencias de producción: sin vulnerabilidades notificadas.
- Astro check: 0 errores, 0 avisos y 0 hints. Build de `/` y `/es/`: PASS después del copy final.
- Contrato MVP inmutable: **10/10 PASS**. SHA-256: `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`; diff vacío.
- Ronda E2E completa: 44 pruebas pasaron y 2 comparaciones detectaron exclusivamente segundos variables en «Caducidad». Tras enmascarar ese valor volátil, las 2 pruebas afectadas pasaron juntas. La suite visual había actualizado y ejecutado sus 18 pruebas con éxito; los 21 snapshots resultantes se revisaron antes de aceptarlos.
- Paquete Electron nativo: abre dos veces, conserva SQLite y pasa integridad/migraciones.
- Landing: ES/EN sin desbordamiento a 320, 390, 760 y 1440 px; 390 px revisado visualmente; RTL a 390 px y zoom CSS 200 % sin desbordamiento.
- Revisión previa a visibilidad pública: 44 commits y el árbol actual sin patrones de credenciales conocidos; copy y assets públicos sin rutas locales de Roberto ni nombres de fixtures temporales.
- `git diff --check`: PASS. Sin TODO/FIXME/HACK nuevos usados como sustituto de trabajo.

## Artefacto local de macOS

- Archivo: `release-candidate/macos/skillglass-v1.0.0-macos-arm64.zip`
- Tamaño: 123.912.891 bytes.
- SHA-256: `8e1046b99696a8bb5f70300ead6e78eda1fe357c952040c7fe43a716ea2502ae`.
- `codesign --verify --deep --strict`: PASS con firma ad hoc aplicada después de los fuses.
- Extracción nueva y arranque del ejecutable exacto: PASS; crea una base SQLite íntegra con esquema v4.

Este ZIP prueba el checkout local. El workflow debe reconstruirlo desde el commit final; su hash cambiará y será el que se publique en `SHA256SUMS.txt`.

## Límites y pasos de publicación

- Windows x64 y Linux x64 conservan sus makers, pero necesitan la matriz nativa del commit final y el smoke correspondiente.
- Omarchy/Pacman continúa como no verificado hasta completar la prueba nativa en Hyprland/Wayland.
- macOS no tiene identidad Developer ID ni notarización. Windows y Linux no tienen firma de editor.
- El candidato está en la rama privada `develop`; la release, los enlaces de descarga activos y el despliegue final no se han publicado.
- Después de la prueba local: ejecutar la matriz sobre la revisión elegida, comprobar hashes y assets, crear el tag `v1.0.0`, publicar repositorio/release, activar las descargas y verificar todo sin sesión.

Veredicto local: **APPROVE para preparar el commit candidato; publicación externa pendiente de autorización y CI nativa**.
