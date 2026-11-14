# LearnTrack 3.6.1 — Informe de correcciones (asistente Nexo y seguridad)

Base: `LearnTrack-React-PWA-corregido-asistente-v3` (3.6.0 con los cambios de terceros en el asistente).
Fecha: 31 de octubre de 2026. No se reconstruyó nada desde cero; el frontend clásico (`frontend/`) sigue disponible
(`FRONTEND=legacy`). Los informes anteriores (`INFORME-CORRECCIONES-ASISTENTE.md`, `CORRECCIONES-ASISTENTE-2026-10.md`)
se conservan como historial; este documento los actualiza.

## 1. Resultados reales (este entorno: Linux, Node 22.22.0, npm 10.9.4)

| Comando | Resultado |
|---|---|
| `npm run build` | ✅ correcto (Vite 6.4.5 + PWA: `sw.js`, 23 entradas precacheadas) |
| `npm run test:front` | ✅ **31/31** (8 archivos) |
| `npm test` | ✅ **160/160**, 3 ejecuciones seguidas (151 originales + 9 nuevas) |
| Pruebas del asistente con `TZ` = Bogotá, Madrid, Tokio, Kiritimati (UTC+14), Pago Pago (UTC−11) | ✅ todas |
| `npm run test:e2e:react` (Chromium real) | ✅ 56/56, sin violaciones de CSP ni errores de consola |
| `npm run test:e2e` (frontend clásico) | ✅ 95/95 |
| `npm audit --omit=dev` (producción) | ✅ **0 vulnerabilidades** |
| `npm audit` (todo, incl. desarrollo) | 15: 13 moderadas, 2 bajas, **0 altas, 0 críticas** (ver §4) |

## 2. Las 7 pruebas que fallaban: causa y corrección

| Prueba | Causa raíz | Corrección (implementación) |
|---|---|---|
| Eliminación por año (`asistente-anio-ambiguo`) | La regla de creación aceptaba «tengo» + «tareas» + fecha: «Elimina todas las tareas **que tengo** para el año 2027» se trataba como **crear**. | Nuevo detector estricto `esPeticionDeCreacion()` (ver abajo). Además, la línea 44 de la prueba leía `propuesta.eliminar`, campo que la API nunca ha tenido; el contrato es `propuesta.operaciones.eliminar` (igual que `chat.test.js`). Se corrigió esa lectura y se dejó comentado el motivo. Las aserciones (qué se propone y que no se borre nada) no cambiaron. |
| Liberar la agenda de un año | «Libera mi **agenda**» se trataba como crear por la palabra «agenda». | El detector ya no acepta «agenda» como verbo salvo «agenda **una/un/el/para/…**» («agenda una reunión»). |
| Aclaración con varios campos conserva lo válido | `liberar()` no preguntaba el modo cuando faltaba el día, de modo que tras responder «mañana» no quedaba nada que preguntar. | Si ya hay que preguntar el día y el modo no es explícito («Libera el día»), se pregunta también aplazar/eliminar. Al responder solo una, se conserva y se pregunta **solo lo pendiente**. |
| Partido con fecha y horario = creación aunque la clase diga «charla» | El año contenido en la fecha («2 de enero **del 2028**») se interpretaba como alcance anual, y la regla anterior resolvía fechas contra un «hoy» fijo (`'2026-01-01'`). | `alcanceAnual()` ignora años que forman parte de una fecha concreta (mes con nombre, `dd/mm/aaaa`, ISO). La creación usa el «hoy» real del usuario. |
| Una creación nueva no se consume como respuesta de una aclaración antigua | La misma regla laxa (en `procesarChat`). | `procesarChat` usa el mismo detector estricto; solo se aplica a mensajes con texto (los botones de respuesta no llevan texto). |
| `liberar_dia`: propuesta, un uso, Deshacer (`chat.test.js`) | «libera mi **agenda** de mañana» → crear. | Igual que arriba: ahora genera la propuesta directamente (día conocido, «libera» = aplazar por defecto, siempre con confirmación). |
| `liberar_dia` ambiguo; «Decide tú» aplaza (`chat.test.js`) | Se había eliminado la tabla `POR_DEFECTO`; el botón «Decide tú» (texto vacío) volvía a preguntar. Además, una respuesta escrita «eliminar» ya no se aceptaba. | Se restauró `POR_DEFECTO` (no destructivo: modo = aplazar, confirmar = no). Solo se aplica cuando la persona **delega**: botón «Decide tú» o frases como «decide tú», «como quieras». «nada», «no sé»… vuelven a preguntar sin cambiar nada. «elimínalas» responde correctamente a «¿Aplazo o elimino?». |

### Reglas nuevas (`backend/servicios/asistente/interprete-lenguaje.js`)

- `esPeticionDeCreacion(texto, hoy)` es **verdadera** solo en dos casos:
  - un verbo de crear: crea, agrega, añade, registra, apunta, anota, agendar, o «agenda/programa» + determinante;
  - una frase en primera persona («tengo», «juego», «asisto»…) con un **evento concreto** (partido, reunión, parcial…) **y** una fecha u hora.

  Es **falsa** en estos casos:
  - la frase pide eliminar, liberar, mover, consultar, restaurar o editar;
  - la frase termina en «?»;
  - las palabras «agenda», «tengo», «tareas» o «actividad» aparecen sin uno de los dos casos anteriores.
- `alcanceAnual(texto)` devuelve el año completo solo si el año va suelto («las tareas de 2027»).
- `delegaDecision(texto)` reconoce que la persona cede la decisión al asistente.

### Comportamientos pedidos (1–7)

| # | Comportamiento | Estado | Prueba |
|---|---|---|---|
| 1 | Eliminación anual | Busca las actividades del año, presenta una propuesta y no borra nada hasta «Aplicar». | `asistente-anio-ambiguo` |
| 2 | Liberación anual | Pregunta «¿eliminar o trasladar?». Si eliges trasladar, pregunta la fecha y propone. Nunca crea una actividad, aunque el clasificador diga «crear». | `asistente-aclaraciones`, pruebas 3–4 |
| 3 | Aclaraciones | Conserva lo respondido y solo pregunta lo pendiente. | `asistente-aclaraciones`, prueba 1 |
| 4 | Creación con actividad, fecha y hora | Se reconoce aunque el clasificador diga «charla». | `asistente-anio-ambiguo` |
| 5 | Contexto anterior | Una creación nueva no se consume como respuesta de una aclaración antigua. | `asistente-anio-ambiguo` |
| 6 | `liberar_dia` | Genera la propuesta cuando ya tiene el día. | `chat.test.js` |
| 7 | Alcance ambiguo al eliminar | Pregunta antes de tocar nada. «Decide tú» nunca elimina. | `chat.test.js`, `asistente-aclaraciones` prueba 2 |

**Identificadores y otros usuarios.** Los ids que propone el modelo siguen pasando por `verificarIdsBD(userId, ids)`. Todas las búsquedas se hacen sobre las actividades del propio usuario. Una prueba nueva lo comprueba: el usuario B no ve las actividades de A en la eliminación anual, y si el clasificador «inventa» el id de una actividad de A, se descarta sin revelarla ni tocarla.

## 3. Archivos modificados y nuevos

- **Modificados:**
  - `backend/servicios/asistente/interprete-lenguaje.js`: tres funciones nuevas, añadidas al final.
  - `backend/servicios/asistente/orquestador-chat.js`: `corregirIntencion`, `procesarChat`, `liberar`, `interpretarRespuesta`, `reanudarAclaracion`, `POR_DEFECTO`.
  - `tests/integracion/asistente-anio-ambiguo.test.js`: solo la línea 44, para leer el campo que define el contrato de la API.
  - `package.json` y `package-lock.json`: versión 3.6.1 y dependencias (§4).
  - `README.md` y `MIGRACION.md`: versión, número de pruebas y avisos de seguridad.
- **Nuevos:**
  - `tests/unitarias/intencion.test.js` (4 pruebas);
  - `tests/integracion/asistente-aclaraciones.test.js` (5 pruebas);
  - este informe.
- **Sin cambios:** CSP, CSRF, sesiones, autorización, validación de entradas, rutas públicas y privadas (`/r/publico`, `/r/privado`), reglas de caché de la PWA y el resto de los contratos de la API.

## 4. Seguridad (`npm audit`)

Hoy la base de datos de avisos daba **21** hallazgos sobre el `package-lock` recibido. Tu ejecución mostraba 8; desde entonces se han publicado avisos nuevos. Ningún cambio usó `--force`, porque `--force` instalaría vitest 5 y archiver 4, que es una versión anterior.

### Aplicado

| Paquete | Antes → después | Cómo | Por qué |
|---|---|---|---|
| `multer` (alto, producción) | 2.4.0 → 2.5.0 | `npm audit fix`, dentro de `^2.4.0` | DoS en la subida de archivos |
| `body-parser` (alto) / `qs` (moderado), producción | → 2.4.0 / 6.17.1 | `npm audit fix` | DoS al procesar peticiones |
| `ip-address` (moderado, producción) | → 10.7.5 | `npm audit fix` | — |
| `vite` (moderado, desarrollo) | 6.4.4 → 6.4.5 | Versión de parche oficial, fijada en `package.json` | `server.fs.deny` se podía saltar en el servidor de desarrollo |
| `tinypool` (**crítico**, desarrollo) | 1.x → 2.2.0 | `overrides` en `package.json` | Contaminación de prototipo con posible ejecución de código. Vitest 3.2.7 funciona con 2.2.0: los 31 tests del frontend pasan. La otra vía era Vitest 4/5 (cambio mayor; Vitest 4.1.12 hace fallar `npm install` en npm 10). |

### Pendientes

Las 15 vulnerabilidades que quedan son de desarrollo o de compilación y ninguna llega al servidor ni al navegador.

| Paquetes | Gravedad | Dónde se usan | Motivo para no forzar |
|---|---|---|---|
| `vitest`, `@vitest/mocker` | Moderada | Solo pruebas, con jsdom. No se arranca el servidor de Vitest (`--ui` o modo navegador), que es la superficie afectada. | El arreglo exige Vitest ≥ 4.1.12, una versión mayor. Recomendación: migrar a Vitest 4 en una tarea aparte. |
| `workbox-build`, `@rollup/plugin-node-resolve`, `deepmerge`, `@trickfilm400/rollup-plugin-off-main-thread`, `ejs`, `jake`, `filelist`, `minimatch` | Moderada / baja | Solo al ejecutar `npm run build`, sobre plantillas propias del proyecto, no sobre datos de usuarios. | Depende de que vite-plugin-pwa y Workbox publiquen versiones nuevas. `--force` instalaría vite-plugin-pwa 0.2.1, mucho más antiguo. |
| `archiver`, `archiver-utils`, `zip-stream`, `readdir-glob`, `glob` | Moderada | Solo en `npm run zip` (`scripts/generar-zip.js`, `devDependency`), que no usa patrones glob de terceros. | `--force` instalaría archiver 4.0.2, una versión anterior a la actual (7). |

**Aviso en `npm install`:** npm 11 muestra «esbuild … install scripts not yet covered by allowScripts». Es informativo: tu compilación funcionó porque esbuild usa su binario de plataforma opcional. Si algún día fallara, ejecuta `npm install-scripts approve esbuild`.

## 5. Las dos pruebas del «partido» que fallaron en tu equipo

En tu ejecución (Windows, npm 11) fallaron con `tipo inesperado: respuesta` y `0 !== 1`. En este entorno no se pudieron reproducir con el código anterior. La ruta responsable sí se identificó: la regla laxa de creación resolvía fechas contra un día fijo (`'2026-01-01'`) y el año dentro de «2 de enero del 2028» se podía tomar como alcance anual. Ambas cosas se reemplazaron por las reglas deterministas del §2, que no dependen del reloj ni de la zona horaria (probadas en cinco zonas horarias distintas). Como no lo pude verificar en Windows, **confirma `npm test` en tu equipo**; si alguna prueba fallara, el mensaje de error indicará la línea exacta.

## 6. Cómo validarlo en tu equipo

```
npm ci
npm run build
npm run test:front     # 31/31
npm test               # 160/160
npm audit --omit=dev   # 0
```
