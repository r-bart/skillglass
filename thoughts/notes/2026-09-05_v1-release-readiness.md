# Lecciones del cierre de Skillglass v1

Fecha: 2026-09-05.

- La protección de cierre pertenece al proceso principal, pero el renderer debe comunicar el estado real del borrador y de la operación. Las pruebas necesitan distinguir entre una salida de negocio, que debe respetar el diálogo, y una salida forzada de teardown.
- El texto observado o escrito por la persona debe marcarse como literal en el límite donde se construye el dato. Intentar decidir qué traducir dentro de un componente acaba traduciendo nombres, rutas o mensajes del adaptador por accidente.
- Una descarga pública necesita datos tipados y verificados por plataforma, arquitectura, nombre, firma y URL. El estado pendiente no debe producir enlaces activos; el estado publicado debe corresponder a assets comprobados.
- Las comparaciones visuales detectan problemas que no aparecen en pruebas geométricas. En este cierre encontraron una rejilla heredada que comprimía las etiquetas del inspector y una fecha variable que hacía inestable el snapshot.
- En una landing pequeña, el copy mejora cuando cada enlace describe su destino y se eliminan estados internos como «validación final» del recorrido principal. La información técnica permanece en la guía de instalación.
- Las rejillas con cantidades impares generaban filas huérfanas. Agrupar 3 pasos, 6 capacidades, 4 garantías y 4 preguntas produjo un ritmo más claro; en móvil, dejar visible parte de la siguiente captura hizo evidente el desplazamiento horizontal.

No se añadió una regla nueva a `CLAUDE.md`: las reglas existentes sobre fronteras, trazabilidad y pruebas ya cubren estos aprendizajes.
