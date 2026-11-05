# LearnTrack 3.6 — Migración a React + PWA

Este documento describe la migración del frontend de LearnTrack 3.4.2 (HTML, CSS y JavaScript «vanilla») a
**React 19 + Vite 6**, convertido en **Progressive Web App**. El backend (Express 5, MongoDB/Mongoose 8, Ollama), la
autenticación por sesión y los contratos de la API **no cambian**. El frontend clásico se conserva en `frontend/` y se
puede volver a él en cualquier momento (ver «Volver a la versión anterior»).

---

## 1. Arquitectura final

```
Navegador ──► Express (server.js / backend/app.js)
               │  helmet (CSP estricta, sin 'unsafe-inline'), CORS propio, comprobación de Origin (CSRF),
               │  sesión por cookie HttpOnly + SameSite=Strict, límites de peticiones
               │
               ├─ /api/*            API de siempre (sin cambios de contrato). 404 de la API siempre en JSON.
               │
               ├─ FRONTEND=react (por defecto si existe frontend-react/dist)
               │    /, /planificador, /asistente           → dist/index.html
               │    /panel, /calendario, /proyectos,
               │    /repaso, /configuracion                → dist/index.html SOLO con sesión (si no, 302 al acceso)
               │    /r/publico/*  JS y CSS públicos (con huella, caché inmutable)
               │    /r/privado/*  JS y CSS de la zona privada: SOLO con sesión (401 sin ella)
               │    /sw.js, /manifest.webmanifest, /offline.html, /recursos/*  (PWA y estáticos)
               │    otra dirección GET → la interfaz con estado 404
               │
               └─ FRONTEND=legacy
                    frontend/publico y frontend/privado (/app/* con sesión), exactamente como en la 3.4.2
```

**Dos zonas en React.** La aplicación tiene una sola página (`index.html`), pero su código se divide en dos zonas
que se descargan por separado:

* **Zona pública** (`src/publico/`): inicio, Planificador, Asistente, 404, acceso (inicio de sesión y registro) y
  contacto. Va en `dist/r/publico/`.
* **Zona privada** (`src/privado/`): Mi panel, Mi agenda, Proyectos, Repaso y Configuración. Va en
  `dist/r/privado/`, que Express **solo entrega con sesión**. Cargar código de forma diferida no lo protege por sí
  solo; la protección es esa regla del servidor (y, como siempre, `requiereAuthApi` en cada ruta de la API).

Entre zonas se navega con recarga completa (por ejemplo, al iniciar o cerrar sesión), así los estilos de cada zona no
se mezclan; dentro de una zona, la navegación es instantánea (React Router).

**Lo que se reutiliza sin duplicar:** las reglas de `compartido/` (carga mental, fechas, prioridad, catálogos) se
importan directamente desde React con el alias `@compartido`, igual que las usa el servidor. Los estilos originales
de cada pantalla se conservan (copiados a `frontend-react/src/…`), con las mismas clases e identificadores, así la
interfaz se ve igual que en la 3.4.2.

---

## 2. Estructura de carpetas

```
learntrack/
├── backend/                     ← sin cambios de contrato (ver §3 para los archivos tocados)
├── compartido/                  ← reglas comunes (servidor y navegador), sin cambios
├── frontend/                    ← FRONTEND CLÁSICO conservado (vía de recuperación)
├── frontend-react/              ← NUEVO: frontend React + PWA
│   ├── index.html               página única (sin scripts en línea: la CSP no los admite)
│   ├── vite.config.js           compilación, separación público/privado, PWA, Vitest
│   ├── public/                  copiado tal cual a dist/: iconos, imágenes, offline.html, tema-inicial.js, robots.txt
│   └── src/
│       ├── main.jsx, App.jsx, rutas.js
│       ├── api/                 cliente.js (servicio HTTP único) y publico.js (acceso y contacto)
│       ├── comun/               cabecera con menú móvil, sesión, tema, fechas locales, PWA y componentes de UI
│       │   └── ui/              Dialogo, BotonConfirmar, Avisos, Cargando, Mensaje, LimiteErrores
│       ├── estilos/             base.css (original) y app.css (añadidos de la versión React)
│       ├── publico/             ZonaPublica, acceso, contacto flotante, páginas y sus estilos
│       ├── privado/             ZonaPrivada y todo lo que exige sesión
│       │   ├── api.js           rutas de la API privada
│       │   ├── actividades/     formulario, papelera, eliminar con «Deshacer»
│       │   ├── asistente/       ChatIA, dictado y voz
│       │   ├── barra/           avatar, panel de perfil, importador de festivos, menú del engranaje
│       │   ├── estilos/         temas, estilos privados y de actividades (originales)
│       │   └── paginas/         panel, agenda, proyectos, repaso (nueva), configuracion
│       └── pruebas/             preparación de Vitest y utilidades
├── scripts/                     generar-zip.js (actualizado), desarrollo.js (nuevo), importar-datos-json.js
├── tests/
│   ├── integracion/             + frontend-react.test.js y repaso.test.js (nuevos)
│   └── navegador/               prueba-navegador.js (clásico) y prueba-react.js (nuevo)
├── .env.example                 solo nombres y valores de ejemplo
├── MIGRACION.md                 este documento
└── README.md
```

---

## 3. Archivos añadidos y modificados

### Añadidos
| Ruta | Para qué |
|---|---|
| `frontend-react/**` | El frontend React + PWA completo (ver §2). |
| `backend/rutas/paginas-react.rutas.js` | Sirve la compilación de React con las mismas reglas de seguridad (páginas privadas, `/r/privado` con sesión, 404 reales, PWA). |
| `scripts/desarrollo.js` | `npm run dev`: API + Vite con recarga en caliente. |
| `tests/integracion/frontend-react.test.js` | Rutas, protección de `/r/privado`, 404, PWA y revisiones estáticas de seguridad del código React. |
| `tests/integracion/repaso.test.js` | API del repaso espaciado: validaciones, flujo SM-2 y aislamiento entre usuarios. |
| `tests/navegador/prueba-react.js` | Prueba en navegador real del frontend React (56 comprobaciones). |
| `frontend-react/src/**/*.test.js(x)` | 31 pruebas de Vitest + Testing Library. |
| `.env.example`, `MIGRACION.md` | Documentación y variables de ejemplo. |

### Modificados
| Ruta | Cambio |
|---|---|
| `backend/app.js` | Interruptor `FRONTEND=react\|legacy` (`elegirFrontend`). La API y la seguridad no cambian. |
| `backend/rutas/paginas.rutas.js` | Exporta `DIRECCIONES_ANTIGUAS` para reutilizarlas en modo React. |
| `backend/rutas/repaso.rutas.js` | Activar sin cuerpo ya no da 500; la fecha se valida (ver §8). |
| `backend/validacion/repaso.js` | Calificación estricta y nueva `validarProximaFecha` (ver §8). |
| `server.js` | Indica al arrancar qué frontend sirve. |
| `frontend/privado/componentes/chat-ia/chat-ia.js` | **Dictado arreglado** también en el clásico (ver §8). |
| `frontend/privado/componentes/barra-navegacion/barra-navegacion.js` | Evento y clases de festivos arreglados (ver §8). |
| `frontend/publico/info-*/…html` | Enlaces del menú que llevaban a `/app-dashboard.html` (el panel) en lugar de a la página informativa. |
| `tests/integracion/importar.test.js`, `asistente-v34.test.js` | Pruebas que fallaban según la fecha del día (ver §9). |
| `tests/navegador/prueba-navegador.js` | Fuerza `FRONTEND=legacy`, cronograma con fechas futuras y textos/diseño de tu 3.4.2. |
| `tests/utilidades/entorno.js` | Las pruebas pueden levantar la app en modo `react` o `legacy`. |
| `scripts/generar-zip.js` | Excluye también `frontend-react/dist` y capturas de pruebas. |
| `package.json`, `package-lock.json` | Versión 3.6.0, scripts nuevos, dependencias de desarrollo (§4), `engines.node >= 20.19`. |
| `.gitignore` | `frontend-react/dist/` y capturas. |

Ningún modelo, índice ni dato de MongoDB se ha cambiado.

---

## 4. Dependencias nuevas

Todas son **de desarrollo** (se usan para compilar y probar; en producción Express solo sirve los archivos ya
compilados). Las dependencias de producción de la 3.4.2 **no se han tocado** (mismo `package-lock`).

| Paquete | Versión | Motivo |
|---|---|---|
| `react`, `react-dom` | ~19.1 | Interfaz. |
| `react-router` | 7.18.4 | Navegación (modo librería). 7.18.4 corrige los avisos de seguridad de 7.6–7.17. |
| `vite` | 6.4.4 | Compilación y servidor de desarrollo. 6.4.4 corrige los avisos de 6.3.x. Admite Node 18+. |
| `@vitejs/plugin-react` | ~4.5 | JSX y recarga en caliente. |
| `vite-plugin-pwa` | ~1.0 | Manifiesto y service worker (Workbox). |
| `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` | 3.2 / 26 / 16 / 6.6 / 14 | Pruebas del frontend. |

**Node.js:** 20.19 o superior (React Router 7 lo pide). Probado con Node 22.

---

## 5. Variables de entorno

Ver `.env.example` (solo valores de ejemplo, ninguno real). Las de siempre (`MONGO_URI`, `PORT`, `OLLAMA_*`…) más:

| Variable | Valor | Efecto |
|---|---|---|
| `FRONTEND` | vacío (por defecto), `react` o `legacy` | Vacío o `react`: React si `frontend-react/dist` existe; si no, el clásico con un aviso. `legacy`: siempre el clásico. |

Ninguna variable llega al navegador: la dirección de Ollama, la base de datos y las claves solo las usa el servidor
(una prueba revisa que la compilación no las contenga).

---

## 6. Instalación, ejecución, pruebas y compilación

```bash
# 1. Instalar (una vez)
npm install
cp .env.example .env            # y pon tu MONGO_URI real (Windows: copy .env.example .env)

# 2. Compilar el frontend React (cada vez que cambie frontend-react/)
npm run build                   # genera frontend-react/dist

# 3. Arrancar (producción o uso normal)
npm start                       # http://localhost:3000  (React; con FRONTEND=legacy, el clásico)

# Desarrollo con recarga en caliente (dos procesos: API en :3000 y Vite en :5173)
npm run dev                     # abre http://localhost:5173

# Pruebas
npm test                        # backend + integración (incluye las de React si existe dist/)
npm run test:front              # Vitest + Testing Library (frontend React)
npm run test:todo               # compila y ejecuta todo lo anterior
npm run test:e2e:react          # navegador real con el frontend React (requiere playwright-core y Chromium)
npm run test:e2e                # navegador real con el frontend clásico
```

Para las pruebas en navegador: `npm i -D playwright-core` y `npx playwright install chromium`
(o define `CHROMIUM_PATH` con la ruta de tu Chrome/Chromium).

---

## 7. PWA

* **Manifiesto** (`/manifest.webmanifest`): nombre «LearnTrack — Planificador de carga mental», nombre corto
  «LearnTrack», `start_url: /panel`, `scope: /`, `display: standalone`, colores `#2b3a67` (tema) y `#f4f6f9`
  (fondo), iconos PNG 192 y 512 y uno «maskable» de 512 (generados a partir del logo).
* **Service worker** (`/sw.js`, Workbox, alcance `/`), con una caché **conservadora**:
  * precachea SOLO archivos públicos y estáticos: `r/publico/**`, iconos e imágenes, `offline.html` y
    `tema-inicial.js`;
  * **no** guarda nada de `/api`, ni el código privado (`r/privado`), ni el HTML de ninguna página;
  * las navegaciones van **siempre a la red** (así el servidor decide sesión, redirecciones y 404). Sin conexión se
    muestra `offline.html`, que explica que los datos privados no se guardan en el dispositivo;
  * no hay escrituras sin conexión ni sincronización en segundo plano (requeriría diseñar autorización y conflictos).
* **Actualizaciones:** `registerType: 'prompt'`. Cuando hay una versión nueva aparece el aviso «Hay una versión nueva
  de LearnTrack · Actualizar / Más tarde»; nunca se cambia el código en mitad de una sesión sin que la persona
  acepte, y las cachés antiguas se limpian (`cleanupOutdatedCaches`). `/sw.js` y el manifiesto se sirven con
  `Cache-Control: no-cache`.
* **Cierre de sesión:** el servidor borra la sesión; como la caché no contiene datos privados, la siguiente persona
  en el mismo navegador no ve nada del usuario anterior (también se olvida el tema guardado en `localStorage`).

### Probar la PWA
1. `npm run build` y `npm start`.
2. Abre `http://localhost:3000` en Chrome o Edge (localhost cuenta como contexto seguro). DevTools › Application:
   Manifest (sin errores) y Service Workers (activo, alcance `/`).
3. Botón «Instalar» de la barra de direcciones. Al abrirla instalada empieza en `/panel`.
4. Desconecta el servidor y recarga: aparece «Sin conexión».
5. Cambia algo en `frontend-react/`, `npm run build`, recarga: aparece «Hay una versión nueva».

### Despliegue con HTTPS
Fuera de `localhost`, el service worker, la instalación y el dictado **exigen HTTPS**. Pon LearnTrack detrás de un
proxy con TLS (Nginx, Caddy, un balanceador…), define `NODE_ENV=production` (la cookie de sesión pasa a ser
`Secure`) y `TRUST_PROXY=1` (o el número de proxies) para que Express vea el protocolo real. Si el frontend se sirve
desde otro dominio, añádelo a `ALLOWED_ORIGINS`.

---

## 8. Correcciones incluidas

* **Dictado por voz** (frontend clásico y React): en la 3.4.2, `reconocedor.onresult` usaba variables que no
  existían (`btnMicrofono`, `divRespuesta`) y escribía con `innerHTML` (el texto dictado se habría interpretado como
  HTML). Ahora el texto reconocido, incluidos los resultados parciales, se escribe en el **valor** del cuadro de
  texto y se conserva tu idea de separar actividades por conectores («y luego», «también»…). Pruebas: Vitest,
  `dictado.test.js` y `ChatIA.test.jsx`; navegador: `prueba-react.js` con un reconocedor simulado.
* **Festivos** (clásico): el importador emitía el evento `'Calendario actualizado'` y la agenda escuchaba
  `'festivos-actualizados'`, así que la agenda no se enteraba; además la clase `feriados-form` no coincidía con su CSS.
  En React se usa un único canal de eventos (`src/privado/eventos.js`) y la prueba en navegador comprueba que la
  agenda muestra los festivos sin recargar. Se mantienen tus textos («feriados», «Tu país/ciudad»).
* **Repaso espaciado (API)**, revisado antes de construir su interfaz:
  * `POST /api/repaso/:id/activar` sin cuerpo JSON daba **500** (`req.body` no existe en Express 5): ahora el cuerpo
    es opcional y el primer repaso queda para hoy.
  * `proximaFecha` solo se comprobaba con una expresión: `'2026-13-45'` o `['2026-01-01']` pasaban y fallaban en
    Mongo con 500. Ahora debe ser una fecha real `YYYY-MM-DD`, dentro de ±1 año (400 si no).
  * La calificación usaba `Number(valor)`: `''`, `null`, `true` y `[3]` se aceptaban como 0, 0, 1 y 3. Ahora solo
    números enteros 0–5 o un dígito en texto.
  * Se quitó una reexportación duplicada de `validacion/repaso.js`.
* **Enlaces del menú** de las páginas informativas clásicas que llevaban al panel en lugar de a «Planificador».
* El botón flotante de **contacto** solo funcionaba en el inicio; en React funciona en todas las páginas públicas.

---

## 9. Resultados de las pruebas (ejecutadas en este entorno)

Entorno: Linux, Node 22.22, npm 10.9, MongoDB en memoria (réplica, con transacciones), Ollama y APIs externas
**simulados**, Chromium 141 sin interfaz.

### Superadas
| Conjunto | Resultado |
|---|---|
| `npm test` (unitarias + integración, incluye 9 de React y 5 de repaso) | **140 / 140** |
| `npm run test:front` (Vitest + Testing Library) | **31 / 31** |
| `npm run build` (compilación de producción) | correcta, sin avisos |
| `npm run test:e2e:react` (navegador real, frontend React) | **56 / 56** (dos ejecuciones seguidas) |
| `npm run test:e2e` (navegador real, frontend clásico, `FRONTEND=legacy`) | **95 / 95** |
| ZIP final: descomprimido en limpio → `npm install`, `npm run build`, `npm test`, `test:front`, e2e | ver informe de entrega |

Antes de la migración, tu 3.4.2 daba 122/126: tres pruebas dependían de la fecha del día (archivos de prueba con
fechas de octubre de 2026 ya pasadas, y un `\w` que no reconoce «miércoles») y una detectaba el `innerHTML` del
dictado. Las tres primeras se arreglaron fijando la fecha de la prueba; la cuarta, arreglando el dictado.

### Fallidas
Ninguna en la última ejecución.

### Pendientes (no se pudieron ejecutar aquí)
* **Ollama real** con Llama 3.2: todas las pruebas usan un Ollama simulado. La integración (endpoints, formato y
  errores 502/503) no cambia, pero las respuestas reales del modelo no se probaron.
* **MongoDB Atlas real**: se probó con MongoDB en memoria con réplica; no con tu clúster.
* **Navegadores**: solo Chromium. No se probó en Firefox, Safari (iOS/macOS) ni en dispositivos reales; la
  instalación de la PWA en Android/iOS y su icono «maskable» deben verificarse a mano.
* **Dictado real**: se usó un reconocedor simulado (Chromium sin micrófono). La lectura en voz alta tampoco se
  escuchó.
* **HTTPS / despliegue**: no se probó detrás de un proxy con TLS ni con `NODE_ENV=production`.
* **Auditorías automáticas** de accesibilidad (axe) o rendimiento (Lighthouse): no se ejecutaron. La accesibilidad
  se cuidó a mano (etiquetas, roles ARIA, foco, teclado, `prefers-reduced-motion`) y parte se comprueba en las
  pruebas.
* Las fuentes de Google (Poppins) no cargan en este entorno sin internet; en tu equipo sí.

---

## 10. Matriz de funcionalidades (original → React)

| Funcionalidad | 3.4.2 | React | Estado |
|---|---|---|---|
| Inicio, Planificador, Asistente | `frontend/publico/*` | `src/publico/paginas/*` | Migrado |
| 404 | `error-404.html` | `NoEncontrada.jsx` (servidor responde 404) | Migrado |
| Registro, inicio y cierre de sesión | `acceso.js`, `dom.js` | `acceso.jsx`, `sesion.js` | Migrado |
| Contacto flotante | `inicio.js` | `ContactoFlotante.jsx` | Migrado (en todas las públicas) |
| Tema/paleta/fondo sin destello | `tema-inicial.js` | mismo script en `public/` + `comun/tema.js` | Migrado |
| Barra privada: avatar, perfil, cambiar cuenta, salir | `barra-navegacion.js` | `privado/barra/*` | Migrado |
| Importador de festivos | `barra-navegacion.js` | `ImportadorFestivos.jsx` | Migrado y corregido |
| Menú del engranaje (Configuración) | `barra-navegacion.js` | `MenuConfiguracion.jsx` | Migrado |
| Mi panel: check-in, carga, consejo, historial, tu día | `panel.js` | `paginas/panel/Panel.jsx` | Migrado |
| Formulario de actividad, eliminar con «Deshacer» | `formulario-actividad.js` | `actividades/*` | Migrado |
| Papelera y restauración | `papelera.js` | `Papelera.jsx` | Migrado |
| Chat IA: propuestas, aclaraciones, deshacer, sugerencias | `chat-ia.js` | `asistente/ChatIA.jsx` | Migrado |
| Archivo + mensaje (📎 y arrastrar) | `chat-ia.js` | `ChatIA.jsx` | Migrado |
| Dictado, lectura en voz alta, modo conversación | `chat-ia.js`, `voz.js` | `ChatIA.jsx`, `dictado.js`, `voz.js` | Migrado y corregido |
| Mi agenda: Mes, Semana, Día, mini calendario, próximas entregas, línea académica, festivos | `calendario.js` | `paginas/agenda/*` | Migrado |
| Proyectos: lista, Kanban (arrastrar y botones), línea de tiempo, archivadas | `proyectos.js` | `paginas/proyectos/Proyectos.jsx` | Migrado |
| Configuración: 6 pestañas (perfil y foto, voz y nombre IA, temas/Colormind/fondo, cuentas, notificaciones, contraseña y baja) | `configuracion.js` | `paginas/configuracion/*` | Migrado |
| Repaso espaciado (SM-2) | solo API | `paginas/repaso/Repaso.jsx` | **Nuevo** (interfaz real con la API) |
| Menú hamburguesa en móvil | — | `comun/Cabecera.jsx` | Nuevo |
| PWA (instalable, sin conexión, actualización) | — | `vite.config.js`, `comun/pwa.js` | Nuevo |

---

## 11. Limitaciones conocidas y pendientes

* **Desarrollo con Vite (`npm run dev`)**: Vite entrega la página a cualquiera; la API sí exige sesión. La protección
  de las páginas privadas y de `r/privado` es la del servidor Express en producción (`npm run build` + `npm start`).
* **CSS**: el CSS público y el privado van en archivos separados, pero el CSS de las zonas no contiene datos; el
  código y el CSS privados sí exigen sesión (`r/privado`). La pequeña parte común (`base.css`, el enrutador y los
  componentes básicos) es pública por diseño.
* **Notificaciones**: igual que en la 3.4.2, los interruptores solo guardan la preferencia; no hay notificaciones
  push (requerirían claves VAPID y un servicio de envío).
* **Cuentas vinculadas**: siguen en modo simulado/desactivado como en la 3.4.2 (falta OAuth en el servidor).
* **Avisos de seguridad de npm**: `npm audit --omit=dev` señala 4 en dependencias de producción que ya estaban en la
  3.4.2 (`multer`, `body-parser`, `qs`, `ip-address`; denegación de servicio). Tienen arreglo dentro de los rangos
  que ya declara tu `package.json` (`npm audit fix`, sin `--force`), pero esas versiones se publicaron hace menos de
  una semana; no las apliqué por prudencia (cadena de suministro). Recomendación: revisa y ejecuta `npm audit fix`,
  y luego `npm test`. En desarrollo quedan avisos de `vitest`/`tinypool` (solo afectan a sus servidores de prueba,
  que este proyecto no expone; el arreglo exige Vitest 4.1.12, que hace fallar `npm install` en npm 10) y uno leve
  de `workbox-build` (solo al compilar).
* El frontend clásico (`frontend/`) se mantiene como vía de recuperación; no se ha borrado ningún archivo original.

---

## 12. Volver a la versión anterior

Sin tocar código ni datos:

1. Pon `FRONTEND=legacy` en tu `.env` (o borra `frontend-react/dist`).
2. Reinicia: `npm start`. Al arrancar verás «Frontend: clásico (frontend/)».

Las sesiones, cuentas y actividades son las mismas en los dos frontends (misma API y misma base de datos), así que
puedes cambiar de uno a otro en cualquier momento. Para eliminar React por completo: borra `frontend-react/`,
`backend/rutas/paginas-react.rutas.js`, el bloque `elegirFrontend` de `backend/app.js` y las dependencias de
desarrollo de §4; o, más simple, vuelve a tu ZIP 3.4.2 original (no se modifica).
