# Correcciones del asistente — octubre de 2026

## Cambios incluidos

- La consulta de actividades por año calendario detecta un año explícito (1900–2200) y consulta las actividades del usuario cuyo intervalo se cruza con ese año, sin depender de la ventana compacta de contexto del modelo.
- Las peticiones claras de consulta o eliminación que mencionan un año se encaminan a una intención determinista.
- La eliminación anual presenta una propuesta confirmable; no elimina inmediatamente. Si no hay coincidencias, lo indica sin cambiar la agenda.
- Si la operación anual supera el máximo permitido por lote, no procesa una parte silenciosamente: informa del límite y no cambia ninguna actividad.
- Una respuesta ambigua a una aclaración, como «nada», ya no se convierte en «eliminar» ni activa valores predeterminados. Se vuelve a presentar la aclaración.
- Se añadieron pruebas de integración para consulta anual, eliminación anual con confirmación, año sin coincidencias y respuesta ambigua.

## Archivos modificados

- `backend/servicios/asistente/orquestador-chat.js`
- `tests/integracion/asistente-anio-ambiguo.test.js` (nuevo)

## Validación pendiente

Se ejecutó `node --check` sobre el archivo del orquestador y el nuevo archivo de pruebas. No se pudo ejecutar la suite de integración ni la compilación de React porque el ZIP de origen no incluye `node_modules` y no se instalaron dependencias en este entorno. Ejecuta en un entorno con Node.js compatible y acceso a las dependencias:

```bash
npm ci
npm test
npm run build
npm run test:front
```

Las pruebas de integración usan el entorno de pruebas del proyecto y deben ejecutarse sin apuntar a una base de datos de producción.
