# Informe de migración exclusiva a React — LearnTrack 3.7.0

## Alcance

La versión 3.7.0 completa la migración del frontend: React 19 + Vite 6 es la única interfaz disponible. Se elimina el frontend HTML/CSS/JavaScript clásico y se retira el selector `FRONTEND`.

## Cambios

- Eliminada la carpeta `frontend/` completa.
- Eliminado `backend/rutas/paginas.rutas.js`; las rutas y recursos se sirven exclusivamente mediante `paginas-react.rutas.js`.
- Extraídos los alias de compatibilidad a `backend/rutas/direcciones-antiguas.js`, para mantener redirecciones sin importar el código anterior.
- `backend/app.js` exige `frontend-react/dist/index.html` y rechaza `FRONTEND=legacy`; no hay fallback silencioso a otra interfaz.
- `.env.example`, `server.js`, pruebas, scripts y documentación actualizados a React exclusivo.
- `npm run test:e2e` ejecuta la única suite E2E React.
- Backend, API, sesiones, modelos y datos de MongoDB no se modifican intencionalmente.

## Validación

Pendiente de ejecutar en este entorno tras instalar dependencias: `npm ci`, `npm run build`, `npm run test:front`, `npm test` y `npm run test:e2e`. Los resultados de 3.6.1 son históricos y no se presentan como resultados de 3.7.0.

## Actualización desde 3.6.1

1. Conserva una copia de seguridad del proyecto 3.6.1 y de tu `.env`.
2. Instala dependencias con `npm ci`.
3. Ejecuta `npm run build` y las pruebas.
4. Elimina de tu `.env` la variable `FRONTEND` si estaba configurada como `legacy` o `react`.
5. Inicia con `npm start`.
