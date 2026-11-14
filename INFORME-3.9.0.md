# LearnTrack 3.9.0 — Gestión de la papelera

Base: `LearnTrack-3.8.0.zip`, la misma versión entregada antes. Se conservan:

- la arquitectura;
- la autenticación;
- la capa de datos (`backend/datos`), las rutas existentes y sus convenciones;
- los estilos y las animaciones de la 3.8.

No se añadieron dependencias.

## 1. Cómo funcionaba antes (análisis previo)

- **Borrado lógico.** `DELETE /api/actividades/:id` marca la actividad con `eliminadaEn`. Todas las lecturas de la agenda filtran `{ eliminadaEn: null }`. Un índice TTL purga la papelera a los `PAPELERA_DIAS` días (30 por defecto).
- **Papelera.** `GET /api/papelera` lista hasta 200 actividades. `POST /api/papelera/:id/restaurar` restaura una y avisa si algún día queda saturado. «Deshacer», en los avisos, usa esa misma ruta.
- **Seguridad.** Todas las rutas usan `requiereAuthApi` (sesión), y cada consulta filtra por `userId`. `sanitizeFilter` y `confiable()` protegen contra inyección NoSQL. `verificarOrigen` sirve de protección CSRF y se suma a `SameSite=Strict`.
- **Interfaz.** La ventana de la papelera (`Papelera.jsx`) se abre desde «Mi panel» y desde «Mi agenda». Tenía un botón «♻ Restaurar» en cada fila; ese botón se mantiene.

## 2. Nuevas rutas del backend

Todas requieren sesión, se registran en el router existente de `/api/papelera` y responden JSON con el mismo formato de errores (`{ error }`).

| Método y ruta | Cuerpo | Respuesta | Qué hace |
|---|---|---|---|
| `POST /api/papelera/restaurar` | `{ ids: [..] }` | `200 { restauradas, actividades, avisos }` · `400` · `404` | Restaura la selección. Devuelve la lista activa nueva y avisos de saturación (máximo 3). |
| `DELETE /api/papelera/seleccion` | `{ ids: [..] }` | `200 { eliminadas }` · `400` · `404` | Elimina **para siempre** la selección. |
| `DELETE /api/papelera` | — | `200 { eliminadas }` | **Vacía** la papelera del usuario. No necesita selección. |

Se conservan sin cambios `GET /api/papelera` y `POST /api/papelera/:id/restaurar`. La parte común (lista activa y avisos de saturación) se extrajo a una función `trasRestaurar`, que comparten la restauración individual y la múltiple.

### Seguridad

- **Usuario.** El usuario sale siempre de la sesión (`req.usuario.id`), nunca del cuerpo de la petición.
- **Filtros.** Cada operación filtra a la vez por `userId` **y** por estar en la papelera (`eliminadaEn ≠ null`). Una actividad activa o de otra persona nunca coincide: se ignora sin tocarla y sin revelar si existe. Si no queda ningún id válido, la respuesta es `404`.
- **Vaciar.** Se hace con `deleteMany({ userId, eliminadaEn: { $ne: null } })`.
- **Validación de `ids`** (`validarIdsPapelera`):
  - debe ser un array con entre 1 y 200 elementos;
  - cada elemento debe tener el formato de id existente;
  - los repetidos se eliminan.
  
  Un objeto como `{ $ne: null }` se rechaza con `400`, antes de llegar a MongoDB.
- **Datos personales.** Al eliminar para siempre se borran también del diario `operaciones` (el de «Deshacer») las copias de esas actividades. Así no quedan sus datos guardados.
- **CSRF.** Las rutas nuevas heredan la comprobación de `Origin`: vaciar desde otro sitio da `403`, y hay una prueba que lo comprueba.

## 3. Selección individual y múltiple (React)

- **Estado en React.** La selección es un `Set` de ids en el estado de `Papelera.jsx`. Cada fila tiene una casilla con su etiqueta, así que se puede pulsar el título. No se toca el DOM salvo la propiedad `indeterminate` de «Seleccionar todas», que no tiene atributo HTML equivalente.
- **Marcas visuales.** Una fila seleccionada se marca con fondo, borde y una franja de color. Un contador muestra «1 seleccionada» o «N seleccionadas» y se anuncia a lectores de pantalla.
- **Seleccionar todas.** Marca o desmarca todas las actividades. Si solo hay algunas marcadas, aparece en estado mixto.
- **Acciones según la selección.** Sin selección, «Restaurar» y «Eliminar permanentemente» **no se muestran**. Con una o más actividades aparece una barra con:
  - «♻ Restaurar (N)»;
  - «Eliminar permanentemente (N)»;
  - «Cancelar selección».
- **Limpieza.** La selección se vacía después de restaurar, eliminar o vaciar. También se quitan de ella las actividades que salen de la lista.

## 4. Eliminación y restauración

- **Restaurar la selección.** Se hace en **una** petición. La lista de la papelera se actualiza y la agenda o el panel reciben la lista activa nueva, así que no hay que recargar la página.
- **Eliminar permanentemente** (una o varias):
  - se abre una ventana de confirmación: «Se eliminarán para siempre N actividades de la papelera. Esta acción no se puede deshacer.»;
  - el foco empieza en «Cancelar»;
  - al confirmar se borra solo lo seleccionado.
- **Vaciar papelera:**
  - el botón está siempre visible y no depende de la selección;
  - está deshabilitado si la papelera está vacía;
  - pide confirmación indicando que se borrarán **todas** las actividades, estén seleccionadas o no, y que no se puede deshacer;
  - al terminar, informa de cuántas se eliminaron.
- **Sin peticiones dobles.** Mientras una operación está en curso:
  - todas las casillas y botones de acción quedan deshabilitados;
  - el botón activo muestra la rueda de carga (`aria-busy`);
  - la confirmación no se puede cerrar con Escape;
  - cada función de acción también ignora un segundo intento.
- **Resultado visible.** El resultado («2 actividades eliminadas para siempre», «Papelera vaciada: se eliminaron 3 actividades») aparece **dentro** de la papelera. El aviso flotante habitual quedaría detrás de la ventana modal.
- **Restauración individual.** «♻ Restaurar» en cada fila y «Deshacer» en los avisos siguen funcionando igual. Lo comprueban las pruebas del componente, la integración y el navegador.

## 5. Error encontrado y corregido en un componente común

`Dialogo.jsx` cerraba también el diálogo **padre** al cerrarse uno anidado. React propaga los eventos `close` y `cancel` por el árbol de componentes, así que cerrar la confirmación habría cerrado la papelera entera.

Ahora cada diálogo solo atiende sus propios eventos (`e.target === ref.current`). La prueba «Cancelar no cierra la papelera» lo cubre: falla sin la corrección (comprobado) y pasa con ella.

## 6. Archivos

| Archivo | Cambio |
|---|---|
| `backend/validacion/actividades.js` | `validarIdsPapelera()` y `MAX_IDS_PAPELERA` (200). |
| `backend/datos/actividades.js` | `restaurarVariasBD`, `eliminarDefinitivamenteBD`, `vaciarPapeleraBD` (con `deleteMany`) y limpieza del diario. |
| `backend/rutas/actividades.rutas.js` | Tres rutas nuevas en `crearRutasPapelera()` y `trasRestaurar()` compartida. |
| `frontend-react/src/privado/api.js` | `papelera.restaurarVarias`, `eliminarDefinitivamente` y `vaciar`. |
| `frontend-react/src/privado/actividades/Papelera.jsx` | Selección, barras de acciones, confirmación, vaciar y estados de carga. |
| `frontend-react/src/privado/actividades/papelera.css` | Estilos de selección, barras y confirmación, adaptados a móvil (casillas de 22 px, botones a todo el ancho). |
| `frontend-react/src/comun/ui/Dialogo.jsx` | Corrección de diálogos anidados (§5). |
| `tests/utilidades/entorno.js` | `delCuerpo()` para pruebas `DELETE` con cuerpo. |
| `tests/navegador/prueba-react.js` | Paso nuevo «papelera» con 6 comprobaciones y capturas. |
| `README.md`, `package.json` | Versión 3.9.0, API y sección de la papelera. |

**Nuevos:**
- `tests/integracion/papelera.test.js` (8 pruebas)
- `frontend-react/src/privado/actividades/Papelera.test.jsx` (10 pruebas)
- este informe

## 7. Resultados reales (Linux, Node 22.22, Chromium 141)

| Comprobación | Resultado |
|---|---|
| `node --check` de los archivos del backend y de las pruebas tocados | correcto |
| `npm run build` | correcto |
| `npm run test:front` | **50/50** (40 anteriores + 10 de la papelera) |
| `npm test` | **168/168**, dos ejecuciones (160 anteriores + 8 de la papelera) |
| `npm run test:e2e` | **62/62**, dos ejecuciones (56 anteriores + 6 de la papelera) |
| `npm run test:e2e:animaciones` | **41/41** (40 anteriores + la papelera en móvil de 390 px) |
| `npm audit --omit=dev` | 0 vulnerabilidades (dependencias sin cambios) |

Además, el ZIP entregado se descomprimió en una carpeta vacía y allí se repitieron `npm ci`, `build`, `test:front`, `npm test` y `test:e2e`.

Durante el desarrollo aparecieron dos fallos, y ambos los causó este cambio. Están corregidos:

1. **Ids duplicados.** Las dos ventanas de confirmación compartían `id`. La prueba en navegador leía la que estaba cerrada. Ahora hay una sola ventana cuyo texto depende de la acción.
2. **Diálogos anidados.** Al cerrar la confirmación se cerraba también la papelera (§5). Era un defecto latente de `Dialogo.jsx` que la papelera hizo visible.

## 8. Límites conocidos

- **Lista de hasta 200 actividades.** `GET /api/papelera` lista como máximo las 200 más recientes (como antes), así que «Seleccionar todas» marca solo esas. «Vaciar papelera» sí borra **todas**, aunque haya más de 200; la confirmación lo indica («200 actividades o más»).
- **Diario de deshacer.** Al eliminar para siempre se borran del diario sus copias. Si «Deshacer» se pulsa sobre un lote antiguo de Nexo que incluía esas actividades, revierte solo lo que todavía existe.
- **Probado solo en Chromium**, de escritorio y móvil emulado. Conviene revisarlo a mano en Safari (iOS) y Firefox.
