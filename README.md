# LearnTrack 3.11.0

Planificador de carga mental con asistente de IA local (Ollama · Llama 3.2), agenda (Mes, Semana y Día), página de Proyectos
(Kanban y línea de tiempo) y acceso con cuenta (MongoDB Atlas).
El asistente conversa en «Mi panel» y «Mi agenda»: agenda, edita y mueve actividades, libera un día aplazando lo que no cabe,
reorganiza la semana, divide un proyecto en tareas antes de su fecha límite, lee cronogramas (PDF, DOCX, TXT, MD, CSV, ICS),
admite dictado por voz, **lee sus respuestas en voz alta** (con la voz que elijas) y recupera lo que borraste. **La IA solo clasifica y extrae; fechas, cargas y cambios los decide el código**,
y todo cambio grande se te propone antes de aplicarlo.

**Novedades 3.11 (SPA real):** el frontend es una **aplicación de una sola página**: una sola instancia de React, un
`BrowserRouter` y un **enrutador central** (`frontend-react/src/app/router.jsx`). Entrar, salir y moverse entre la parte pública y
la privada **ya no recargan el documento**. El acceso tiene direcciones propias (`/login`, `/registro`, `/verificar-correo`, como
ventana encima de la página), y hay páginas nuevas hechas con piezas que ya existían: **`/bienestar`**, **`/papelera`** y
**`/perfil`** (Información básica y Privacidad, antes pestañas de Configuración). Código organizado por funcionalidad
(`features/`), con contextos de sesión, tema y avisos, guardias de rutas y servicios HTTP. Detalle en
**[INFORME-3.11.0.md](INFORME-3.11.0.md)**.

**Novedades 3.10 (verificación del correo):** al crear una cuenta se envía por SMTP un **código de 6 dígitos** al correo; sin
introducirlo no hay sesión ni acceso a nada privado (lo comprueba el servidor en cada petición). Configura `SMTP_*` en el `.env`
(ver [Verificación del correo](#verificación-del-correo)). Detalle en **[INFORME-3.10.0.md](INFORME-3.10.0.md)**.

**Novedades 3.9 (papelera):** selección de una, varias o todas las actividades de la papelera para **restaurarlas** o
**eliminarlas para siempre**, y botón **«Vaciar papelera»** siempre visible, con confirmación. Detalle en
**[INFORME-3.9.0.md](INFORME-3.9.0.md)** y en [Papelera y deshacer](#papelera-y-deshacer).

**Novedades 3.8 (animaciones):** sistema de animaciones propio, sin dependencias nuevas (CSS + IntersectionObserver + Web
Animations): entradas al aparecer en pantalla con escalonado, transición entre páginas, tarjetas y botones con microinteracciones,
calendario animado (cambio de mes, día seleccionado, altas y ediciones), Nexo con indicador de escritura y mensajes que aparecen,
contadores y barras que crecen hasta el valor **real**, esqueletos de carga con brillo, y respeto total de «reducir movimiento».
Detalle en **[INFORME-3.8.0.md](INFORME-3.8.0.md)** y en la sección [Animaciones](#animaciones).

**Novedades 3.6 (React + PWA):** frontend migrado a **React 19 + Vite** (`frontend-react/`) con las mismas pantallas,
la misma API y la misma seguridad. React es el único frontend y no existe modo clásico. **PWA instalable** con caché
conservadora (nada privado en el dispositivo) y aviso de versión nueva; **menú móvil**; módulo **Estudio** con repaso espaciado
(SM-2) sobre la API `/api/repaso`; dictado por voz y festivos corregidos. Todo el detalle en **[MIGRACION.md](MIGRACION.md)**.

**Novedades 3.4:** **Prompt Maestro** con el nombre del asistente (`nombreIA`, «Nexo» por defecto) y la fecha/hora local
inyectados en cada llamada a Ollama; correcciones («No, era a las 5») que editan en vez de crear; hora sin decir → 2-3 horarios
libres para elegir (`requiere_confirmacion`); liberar un día decide sobre TODAS sus actividades; prioridad por fecha de vencimiento;
**archivo + mensaje** en el mismo envío y lo que se lee del archivo se añade solo (con Deshacer); **limpieza automática con
node-cron** (archiva las completadas ya vencidas); **auto-estado** («en proceso» durante su horario); nueva página **Proyectos**
(Kanban y línea de tiempo por proyecto); **Mi agenda** con el diseño Moderno, desplegable Mes/Semana/Día y **línea de tiempo
académica**; `npm run zip` (`scripts/generar-zip.js`, con `archiver`).

**Novedades 3.3:** barra de navegación con avatar (perfil, cambiar de cuenta, cerrar sesión e **importador de días festivos**) y
engranaje (Configuración); página **Configuración** con pestañas laterales (información básica, voz de la IA, estética con 4 temas
nuevos, **paleta generada con Colormind** y **fondo personalizado**, cuentas vinculadas con GitHub, Steam y Xbox, notificaciones,
privacidad y seguridad); conversación por voz en el chat.

## Publicar en Internet

La versión 3.11.0 puede desplegarse separando el frontend React estático en **GitHub Pages** y la API Node.js/Express en **Railway**, con MongoDB Atlas como base de datos. Consulta **[DEPLOY-GITHUB-PAGES-RAILWAY.md](DEPLOY-GITHUB-PAGES-RAILWAY.md)**. La autenticación entre dominios requiere configurar cookies/CORS; se recomienda usar un dominio propio para el frontend y la API.

## Ejecutar

Requiere **Node.js 20.19 o superior** (`node -v`); el frontend React y su compilación lo necesitan. La lectura de **PDF**
necesita Node 20.16 o superior (lo exige `pdfjs-dist`).

```
npm install
copy .env.example .env      (Windows)   |   cp .env.example .env   (Mac/Linux)
# edita .env y pon tu MONGO_URI de MongoDB Atlas y tu servidor de correo (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM)
npm run build               # compila el frontend React (frontend-react/dist)
npm start
```

Abre http://localhost:3000. React es obligatorio: si no existe `frontend-react/dist/index.html`, el servidor se detiene y te indica ejecutar `npm run build`. El antiguo frontend HTML/CSS/JS ya no forma parte del proyecto.
Desarrollo con recarga en caliente: `npm run dev` y abre http://localhost:5173.

**Pruebas:** `npm run test:todo` compila React y ejecuta las pruebas de backend, integración y frontend.
`npm run test:e2e` ejecuta la suite de navegador real con React (requiere Playwright y Chromium).

**Empaquetar en .zip:** `npm run zip` (o `node scripts/generar-zip.js [salida.zip]`) crea `learntrack-v<versión>.zip` con toda la
estructura de carpetas, sin `node_modules`, `.env`, la compilación de React ni capturas de pruebas. Usa la librería `archiver`
(dependencia de desarrollo).

### MongoDB Atlas

Crea un clúster, un usuario de base de datos (Database Access) y permite tu IP (Network Access); copia la cadena de conexión
(Connect → Drivers) en `MONGO_URI`. Las colecciones, los índices (únicos y TTL) y las migraciones idempotentes se aplican solos al
arrancar. Atlas es un *replica set*, así que **aplicar una propuesta es atómico** (transacción multi-documento). Si conectas un
MongoDB independiente sin réplica, la app lo detecta al arrancar, lo avisa en consola y aplica los cambios uno a uno (sin atomicidad),
compensando con el diario si algo falla a mitad.

Si venías de la versión con `data_store.json`, importa tus datos una vez con `npm run migrar:datos`
(o `npm run migrar:datos -- ruta/al/data_store.json`). Las actividades antiguas solo tenían `fecha`: el servidor completa
`fecha_inicio`/`fecha_fin` al arrancar (migración idempotente en `backend/datos/actividades.js`).

### Ollama (IA local)

```
ollama pull llama3.2
ollama serve
```

Si Ollama no está activo, el chat responde **503** con un mensaje claro y todo lo demás sigue funcionando (crear y editar con
«+ Nueva actividad», check-in, papelera, deshacer).

**Ventana de contexto.** Ollama usa por defecto una ventana pequeña (en la documentación actual: 4k tokens con menos de 24 GiB de VRAM;
versiones antiguas usaban 2048) y la API compatible con OpenAI **no permite fijarla por petición**. LearnTrack ya envía solo lo
relevante (actividades de ±14 días, máximo 40, en formato compacto). Si quieres más margen:

- variable de entorno al arrancar el servidor de Ollama: `OLLAMA_CONTEXT_LENGTH=8192 ollama serve`, o
- un modelo derivado con un `Modelfile`:
  ```
  FROM llama3.2
  PARAMETER num_ctx 8192
  ```
  `ollama create llama3.2-8k -f Modelfile` y en `.env` pon `OLLAMA_MODEL=llama3.2-8k`.

Compruébalo en la documentación de **tu** versión (`ollama --version`): https://docs.ollama.com/context-length y
https://docs.ollama.com/api/openai-compatibility.

**Imágenes (opcional).** Llama 3.2 3B es solo de texto. Para leer fotos de cronogramas: `ollama pull llama3.2-vision` y
`OLLAMA_VISION_MODEL=llama3.2-vision` en `.env`. Sin esa variable, las imágenes se rechazan con un mensaje claro.

## Pruebas

```
npm test                      # 201 pruebas: primero tests/unitarias (sin servidor) y luego tests/integracion (API + base de pruebas)
npm run test:front            # 76 pruebas del frontend React (Vitest + Testing Library): rutas y guardias, acceso, papelera, verificación…
npm run test:e2e              # tests/navegador, navegador real (opcional): npm i -D playwright-core && npx playwright install chromium
npm run test:e2e:animaciones  # animaciones en navegador real: escritorio, móvil 390 px y «reducir movimiento» (49 comprobaciones)
```

- **SMTP simulado** (`tests/utilidades/smtp-falso.js`, v3.10): habla el protocolo SMTP real, así que Nodemailer funciona como en
  producción; las pruebas leen el código del correo recibido (como una persona) y pueden simular caídas del servidor de correo.
- **APIs externas simuladas** (`tests/utilidades/apis-externas-falsas.js`): Nager.Date y Colormind sin salir a internet, con
  caídas y datos maliciosos (nombres con `<script>`, fechas inválidas). Las pruebas nunca llaman a los servicios reales.
- **Ollama simulado** (`tests/utilidades/ollama-falso.js`): servidor compatible con OpenAI; hay una prueba por cada intención, más
  modelo caído (503) y JSON inválido (reintento y 502 sin escribir nada).
- **Base de datos de prueba**, por orden: `MONGO_URI_TEST` (MongoDB real desechable) → `mongodb-memory-server` si lo instalas
  (`npm i -D mongodb-memory-server`) → `tests/utilidades/mongo-memoria.js`, un servidor **en memoria que habla el protocolo de MongoDB
  pero no es MongoDB** (filtros con `mingo`, índices únicos, `collMod`, transacciones con instantánea). La salida de `npm test`
  indica cuál se usó. Para validar contra un MongoDB real, define `MONGO_URI_TEST`.
- `npm run test:e2e` arranca `server.js` y comprueba en Chromium (zona horaria America/Bogota): sin violaciones de CSP, check-in en
  el servidor, el chat crea actividades y las vistas se redibujan, Aplicar/Deshacer, papelera, archivo PDF con casillas y la misma
  carga en panel y agenda; la barra (avatar y engranaje arriba a la izquierda, menú y panel lateral), importar festivos sin tocar
  ninguna actividad y verlos en la agenda, «Cambiar de cuenta»; y, en Configuración, voz, los temas nuevos (colores exactos y
  persistencia), la paleta de Colormind en toda la página, el fondo, la foto, las 6 cuentas, las notificaciones, la contraseña, la
  baja de cuenta y que no haya desplazamiento horizontal a 390 px; y, desde 3.4: agenda solo Moderna con Mes/Semana/Día, archivo +
  mensaje (se añade solo y asigna la materia), horarios sugeridos, corrección sin duplicar, Proyectos (Kanban que cambia el estado
  en el servidor y línea de tiempo con vencimientos), línea de tiempo académica y nombre del asistente (78 comprobaciones en la 3.11).

## Animaciones

Sistema propio y reutilizable (v3.8), sin bibliotecas: Framer Motion no hacía falta para nada de lo pedido y añadiría peso al
paquete público.

| Pieza | Dónde | Para qué |
|---|---|---|
| `src/styles/animaciones.css` | común | Tokens (`--lt-dur-*`, `--lt-ease-*`, `--lt-distancia`), fotogramas, entradas `data-revelar`, escalonado `data-revelar-grupo`, botones, tarjetas (`lt-tarjeta`, `lt-tarjeta-sutil`), botón ocupado (`aria-busy`), esqueletos, contadores, menú, avisos, diálogos, zona pública |
| `src/styles/privado/animaciones-privado.css` | privado | Panel, Nexo, agenda, proyectos, Estudio, desplegable, panel lateral y configuración |
| `src/utils/animaciones.js` | común | Un solo `IntersectionObserver`, `iniciarAnimaciones()`, `animarCambio()` (Web Animations, solo transform/opacity) |
| `src/hooks/useAnimaciones.js` | común | `useRevelar()`, `useAnimarCambio(clave, tipo)`, `useDestello(firma)` |
| `src/components/common/Contador.jsx`, `Esqueleto.jsx` | común | Contador animado en CSS puro con el valor real en el DOM; marcador de carga accesible |

Uso:

```jsx
const revelar = useRevelar();
<section ref={revelar} data-revelar="arriba">…</section>        {/* arriba | izquierda | derecha | escala | aparecer */}
<ul ref={revelar} data-revelar-grupo="">…</ul>                   {/* los hijos entran escalonados */}
<strong><Contador valor={57} sufijo="%" /></strong>              {/* texto real «57%» siempre en el DOM */}
{datos === null ? <Esqueleto texto="Cargando proyectos…" /> : <Lista … />}
<button disabled={guardando} aria-busy={guardando}>Guardar</button>
```

Reglas: solo se mueven `transform`/`opacity`; nada queda oculto si JavaScript falla o no hay `IntersectionObserver` (el estado
inicial oculto depende de `html.lt-js`); con `prefers-reduced-motion: reduce` no hay movimiento (los indicadores de carga pasan a
un pulso de opacidad); el hover solo existe con ratón y en táctil hay un leve «hundido» al pulsar.

## Estructura

El código está separado en **backend** (servidor), **frontend** (navegador) y **compartido** (lo que usan los dos).
En el frontend, cada funcionalidad tiene su carpeta en `frontend-react/src/features/` (páginas, componentes, hooks, servicios y CSS) y las piezas reutilizables viven en `components/`, `hooks/` y `contexts/`.

```
server.js                         Arranque (npm start): .env, MongoDB, índices/migraciones, limpieza (node-cron), escucha y cierre
package.json · .env.example · README.md · MIGRACION.md (React + PWA, v3.6)

frontend-react/                   Frontend React + Vite + PWA (SPA desde la 3.11). Código por funcionalidad en src/features;
                                  las carpetas privadas (zonas.config.js) solo se entregan con sesión. Detalle más abajo

compartido/                       Módulos ES puros: los importan el servidor y el navegador (/app/compartido/…)
  catalogos.js                    Tipos, exigencias, estados y respuestas del check-in (con sus nombres visibles)
  fechas.js                       Fechas "YYYY-MM-DD" y horas "HH:MM" sin zona horaria; textos «jue 9, 10:00–12:00»
  carga.js                        REGLA ÚNICA de carga mental (panel, agenda, historial, planificador, chat)
  paleta.js                       Colores: contraste WCAG, paleta armónica local y variables CSS de una paleta de 5 colores
  prioridad.js                    URGENCIA: prioridad por fecha de vencimiento (urgente ≤ 2 días, alta ≤ 7) y orden por urgencia

backend/
  app.js                          crearApp(): une seguridad, sesión, límites, rutas y frontend (también lo usan las pruebas)
  errores.js                      ErrorConEstado: errores con código HTTP que el manejador convierte en { error }
  config/entorno.js               Carga el .env antes que cualquier modelo
  middleware/
    seguridad.js                  CSP estricta, Permissions-Policy, CORS, comprobación de Origin (CSRF), sin caché
    autenticacion.js              Cookie de sesión, req.usuario y las reglas que protegen API, páginas y archivos
    limites.js                    Límites de peticiones (por IP, por cuenta y por usuario)
    errores.js                    404 de API y de páginas, y manejador final de errores
  rutas/                          Una por tema; solo validan, llaman a datos/servicios y responden
    paginas-react.rutas.js        Páginas públicas/privadas React, recursos protegidos y alias antiguos
    repaso.rutas.js               /api/repaso (repaso espaciado SM-2)
    auth.rutas.js                 /api/auth (registro, login, logout, me)
    actividades.rutas.js          /api/actividades (auto-estado, archivadas), /api/papelera y /api/proyectos (resumen)
    bienestar.rutas.js            /api/checkin(s) y /api/historial
    asistente.rutas.js            /api/ia/*, /api/propuestas/*, /api/operaciones/*
    perfil.rutas.js               /api/perfil (datos, tema, paleta con Colormind, fondo con multer, voz, foto, cuentas, baja)
    festivos.rutas.js             /api/festivos (países, regiones, importar = fusión, consultar, quitar)
    contacto.rutas.js             /api/contacto
  datos/                          Acceso a MongoDB, un archivo por colección (index.js los reúne: import * as db)
    index.js                      prepararBaseDeDatos() + re-exporta todo
    utilidades.js                 esTexto/confiable (anti inyección NoSQL), ids, ErrorDatos, transacciones
    usuarios.js · sesiones.js · actividades.js (CRUD, papelera, diario) · bienestar.js · propuestas.js · mensajes.js
  modelos/                        Esquemas Mongoose: Usuario, Avatar, Fondo, Sesion, Actividad, Historial, Checkin, Mensaje, Propuesta, Operacion
  validacion/                     Validación de toda entrada; index.js los reúne
    texto.js · cuenta.js · actividades.js (incl. salida del modelo de IA) · asistente.js · bienestar.js · contacto.js
    apariencia-festivos.js        Color semilla, año, país y región
  servicios/
    asistente/
      orquestador-chat.js         Flujo de /api/ia/chat y de los archivos (propuestas, aclaraciones, aplicar, deshacer)
      cliente-ollama.js           Llamadas a Ollama (JSON, temperatura 0.1, un reintento)
      prompts.js                  Un prompt por tarea, con ejemplos
      esquemas-respuesta-ia.js    Esquemas estrictos para la salida del modelo (entrada no confiable)
      interprete-lenguaje.js      Español → fechas, horas y duraciones, de forma determinista
      planificador.js             Liberar día, reorganizar, planificar proyectos (determinista)
    archivos/
      lector-documentos.js        Archivos en memoria: firma + extensión, PDF, DOCX, texto, límites
      lector-ics.js               Calendarios iCalendar (.ics)
    cuenta/
      contrasenas.js              scrypt
      imagenes.js                 Tipo real de la foto y del fondo por su firma; tamaños máximos
      integraciones.js            YouTube, GitHub, Discord, Spotify, Steam, Xbox (simulado o desactivado; enganche OAuth)
    tiempo.js                     Hora LOCAL del usuario (cabecera X-Zona-Horaria o ZONA_HORARIA): auto-estado y Prompt Maestro
    tareas/limpieza.js            node-cron: archiva cada noche las completadas cuyo vencimiento ya pasó
    externos/                     APIs públicas llamadas DESDE EL SERVIDOR (tiempo máximo, sin redirecciones, 512 kB máx.)
      http-externo.js             pedirJSON(): petición con AbortController; si falla → 503 con mensaje claro
      festivos.js                 Nager.Date: países (caché 24 h), festivos de un año, regiones; datos limpiados
      colormind.js                Colormind: POST con el color semilla; si no responde, paleta armónica local

frontend-react/
  public/                         recursos estáticos, iconos, PWA y tema inicial (tema-inicial.js, antes de pintar)
  zonas.config.js                 carpetas de src/ cuyo código es PRIVADO (r/privado, solo con sesión)
  vite.config.js                  compilación, separación pública/privada del código y PWA
  src/
    main.jsx                      punto de entrada: un solo createRoot y un solo BrowserRouter
    app/                          App, proveedores globales, enrutador central (router.jsx), mapa de rutas (rutas.js), PWA
    components/common/            piezas reutilizables sin lógica de negocio (Dialogo, Cargando, Esqueleto, Mensaje…)
    components/layout/            cabecera, pie y diseño público; layout/privado: diseño privado, barra de la cuenta,
                                  menú del engranaje y diseño con pestañas de Mi perfil / Configuración
    components/navigation/        guardias RutaPrivada y RutaPublica, y GestorNavegacion (título, desplazamiento, foco)
    contexts/                     AuthContext (sesión), TemaContext (apariencia y zona) y NotificacionesContext (avisos)
    hooks/                        useAuth, useTema, useAvisos y useAnimaciones
    services/                     http.js (único cliente HTTP), errores.js (errores comunes), sesion.js y tema.js
    styles/                       estilos globales; styles/privado: temas y base de la zona privada
    utils/                        fechas, animaciones y eventos
    features/<funcionalidad>/     pages, components, hooks, services y su CSS: landing, auth, dashboard, calendar,
                                  activities, projects, review, wellness, trash, profile, settings, ai-assistant
    pruebas/                      preparación de Vitest y utilidades (pintar la app con el enrutador en memoria)

compartido/                       reglas de negocio compartidas entre backend y React
scripts/                          desarrollo, importación de datos y empaquetado
tests/                            pruebas unitarias, integración y E2E exclusivas de React

**Direcciones.** Públicas: `/`, `/planificador`, `/asistente` y la ventana de acceso `/login`, `/registro`, `/verificar-correo`.
Privadas: `/panel`, `/calendario`, `/proyectos`, `/estudio` (la ruta antigua `/repaso` redirige a Estudio), `/bienestar`, `/papelera`, `/perfil`, `/configuracion`. Cualquier otra
dirección muestra «Página no encontrada» con estado 404. Las antiguas (`/proyectos.html`, `/app-dashboard.html`, `/calendario.html`,
`/perfil.html`, `/planificador-info.html`, `/asistente-info.html`, `/index.html`) redirigen (301) a las nuevas, `/?acceso=login` abre
`/login` y `/configuracion#informacion` lleva a `/perfil#informacion`. Todo lo privado está protegido por sesión EN EL SERVIDOR: sin
ella, las páginas redirigen a `/login` (o a `/verificar-correo` si hay una verificación a medias), el código de `/r/privado` responde
401 y la API también. Dentro de la app, React navega sin recargar y los guardias solo deciden qué pintar.

**Ícono del sitio.** `favicon.svg` es el logo de LearnTrack convertido a vector (sin fondo, con sus degradados). Para cambiarlo,
sustituye ese archivo y vuelve a generar `favicon.ico` (16, 32 y 48 px) y `apple-touch-icon.png` (180 px, fondo blanco).

## API

| Ruta | Descripción |
|---|---|
| `POST /api/auth/registro`, `/login`, `/logout`, `GET /api/auth/me` | Autenticación. Desde la v3.10, `registro` responde `202 { verificacion }` **sin sesión** y `login` de una cuenta sin verificar responde `403 { codigo: 'verificacion_pendiente', verificacion }` |
| `POST /api/auth/verificar-correo` `{ codigo }` | (3.10) Comprueba el código (con la cookie temporal `lt_verif`) e **inicia la sesión** → `200 { usuario }` |
| `POST /api/auth/reenviar-codigo` | (3.10) Código nuevo; el anterior deja de valer → `200 { verificacion }` · `429` si hay que esperar |
| `GET /api/auth/verificacion` | (3.10) Estado de la verificación en curso de este navegador (correo oculto, segundos restantes) |
| `GET/POST /api/actividades`, `PUT/DELETE /api/actividades/:id` | CRUD manual. `DELETE` es **borrado lógico** (va a la papelera). El `GET` aplica antes el **auto-estado**; `?archivadas=incluir` añade las archivadas. Campos nuevos: `fecha_vencimiento`, `fecha_asignacion` |
| `GET /api/actividades/archivadas` · `POST /api/actividades/:id/desarchivar` | Lo archivado por la limpieza automática y devolverlo a la agenda |
| `GET /api/proyectos` | Resumen de cada proyecto (incluye archivadas): total, completadas, progreso %, fechas, prioridad y siguiente tarea |
| `GET /api/papelera`, `POST /api/papelera/:id/restaurar` | Papelera y restauración manual de una actividad |
| `POST /api/papelera/restaurar` `{ ids }` | (3.9) Restaura la selección → `{ restauradas, actividades, avisos }` |
| `DELETE /api/papelera/seleccion` `{ ids }` | (3.9) Elimina **para siempre** la selección → `{ eliminadas }` |
| `DELETE /api/papelera` | (3.9) **Vacía** la papelera del usuario (`deleteMany`) → `{ eliminadas }` |
| `GET /api/checkin?fecha=`, `GET /api/checkins?desde=&hasta=`, `PUT /api/checkin` | Check-in diario (servidor; el navegador solo lo cachea) |
| `GET/POST /api/historial` | El servidor calcula el % con la regla única; solo días ≤ hoy (fecha local del cliente) |
| `POST /api/ia/chat` | **Único** punto de entrada del chat (sustituye a `/api/ia/agendar` y `/api/ia/parsear`, eliminados) |
| `POST /api/ia/archivo` | Archivo + mensaje (multipart: `archivo`, `instruccion`, `fechaHoy`, `horaLocal`; 1 archivo, máx. 5 MB) → `aplicado` (lo comprobado se añade solo, con `loteId` para Deshacer) y, si hay algo dudoso u opcional, `siguiente` = propuesta con casillas |
| `POST /api/propuestas/:id/aplicar` · `/cancelar` | Confirmar o descartar una propuesta (un solo uso, 10 min) |
| `POST /api/operaciones/:loteId/deshacer` | Deshace un cambio completo de la IA |
| `POST /api/ia/consultar` | Consejo breve del panel |
| `GET /api/ia/capacidades` | Formatos de archivo disponibles, visión, transacciones, días de papelera |
| `GET /api/perfil` | Datos del perfil (sin hash de contraseña ni tokens), apariencia, voz, cuentas vinculadas y preferencias |
| `PUT /api/perfil` | **Parche**: solo cambia los campos enviados (`nombre`, `email`, `temaSeleccionado`, `coloresPersonalizados`, `vozAsistente`, `nombreIA`, `notificacionesActivas`, `preferenciasNotificaciones`, `passwordNueva`). Correo y contraseña exigen `passwordActual`; con contraseña nueva se cierran las demás sesiones |
| `POST /api/perfil/paleta` | `{ color: "#rrggbb" }` → `{ colores[5], variables, fuente: "colormind" \| "local" }`. Solo genera; se guarda con `PUT /api/perfil` |
| `POST/GET/DELETE /api/perfil/fondo` | Imagen de fondo (multipart, campo `imagen`, máx. 1,5 MB, validada por su firma; solo la ve su dueño) |
| `PUT/GET/DELETE /api/perfil/avatar` | Foto de perfil (cuerpo binario JPEG/PNG/WebP, máx. 200 KB, validada por su firma; solo la ve su dueño) |
| `POST /api/perfil/vincular` · `DELETE /api/perfil/vincular/:servicio` | Conectar / desconectar `youtube`, `github`, `discord`, `spotify`, `steam` o `xbox` |
| `GET /api/festivos/paises` · `GET /api/festivos/regiones?pais=&anio=` | Países y regiones con festivos (Nager.Date, a través del servidor) |
| `POST /api/festivos/importar` | `{ pais, anio, region? }` → **fusión**: `{ añadidos, yaExistian, limite, encontrados, festivos }`. Nunca toca actividades |
| `GET /api/festivos?desde=&hasta=` · `DELETE /api/festivos?pais=` | Festivos importados del usuario; quitarlos (todos o de un país) |
| `DELETE /api/perfil` | Baja de cuenta: exige `password` y `confirmacion: "ELIMINAR"`; borra todos los datos del usuario |
| `GET /api/estudio` | (3.12) Objetivos de aprendizaje con su resumen (progreso, horas, situación), sugerencias visibles de la IA y próximas sesiones |
| `POST /api/estudio` · `PUT/DELETE /api/estudio/:id` | (3.12) Crear, editar o eliminar un objetivo (al eliminarlo, sus sesiones quedan como actividades normales) |
| `POST /api/estudio/:id/sugerencia` `{ accion, dias?, planificar? }` | (3.12) Aceptar, posponer (1–60 días) o descartar una sugerencia de la IA |
| `POST /api/estudio/plan` `{ ids, horasPorSesion?, maxPorDia? }` | (3.12) **Propone** sesiones (no guarda nada) |
| `POST /api/estudio/sesiones` `{ sesiones }` | (3.12) Guarda las sesiones confirmadas; vuelve a comprobar cruces, duplicados y fechas pasadas (409 con `conflictos`, todo o nada) y devuelve `loteId` para Deshacer |
| `POST /api/estudio/analizar` | (3.12) Analiza un taller/trabajo (multipart, PDF/DOCX/TXT/MD, máx. 5 MB) → temas, requisitos, entregables y fechas por tipo. **No guarda nada** |
| `POST /api/estudio/lote` `{ objetivos, fechaLimite?, entrega? }` | (3.12) Guarda lo confirmado tras el análisis (sin duplicar temas ni la entrega) |
| `POST /api/contacto` | Pública (con límite) |

Todas las peticiones del chat envían `horaLocal` ("HH:MM", para el Prompt Maestro), `fechaHoy` (fecha **local** del navegador; sin ella el servidor responde 400, nunca usa la
fecha UTC) y `tzOffset` (`getTimezoneOffset()`, para interpretar «lo que borré ayer» en tu zona horaria).

## El asistente

### Prompt Maestro (identidad + reglas) — `backend/servicios/asistente/prompts.js`

Cada llamada a Ollama lleva como mensaje de sistema **Prompt Maestro + prompt de la tarea** (clasificar, extraer, desglosar,
leer documentos, redactar, aconsejar). El maestro define la identidad (`${nombreIA}`, servicial, empática y clara; si es el
nombre predeterminado «Nexo», lo dice y avisa de que se puede cambiar en Configuración › Voz de la IA), la fecha y hora LOCALES
del usuario y 9 reglas estrictas: JSON siempre; correcciones = editar/eliminar, nunca crear; liberar un día = TODAS sus
actividades; sin hora → no inventarla y `"requiere_confirmacion": true`; proyectos → subtareas repartidas en varios días; lo que
vence antes va primero; documentos e imágenes → extraer todo; avisos de sobrecarga en una oración que empieza por «Ojo:»; y los
mensajes/documentos son datos, no instrucciones. Así se inyectan el nombre y la hora justo antes del POST
(`cliente-ollama.js`):

```js
// orquestador-chat.js — contexto de cada petición
const ahora = ahoraDelUsuario({ fechaHoy: entrada.fechaHoy, horaLocal: entrada.horaLocal, zona: entrada.zona });
ctx.identidad = { nombreIA: usuario.nombreIA, ahora };          // { fecha, hora, diaSemana, zona }

// cliente-ollama.js — se antepone el maestro al prompt de la tarea
export function construirSistema(tarea, identidad = {}) {
    const ahora = identidad.ahora ?? ahoraEn();                    // respaldo: ZONA_HORARIA del servidor
    return `${promptMaestro({ nombreIA: identidad.nombreIA, ahora })}\n\n=== TAREA ===\n${tarea}`;
}
const mensajes = [{ role: 'system', content: construirSistema(sistema, identidad) }, ...historial, { role: 'user', content: usuario }];
await fetch(`${OLLAMA_API_BASE}/chat/completions`, { method: 'POST', body: JSON.stringify({ model, messages: mensajes, response_format: { type: 'json_object' }, temperature: 0.1 }) });
```

Un modelo de 3B no siempre obedece, así que **cada regla también se hace cumplir en código** (`orquestador-chat.js`):

- **Correcciones:** «No, era a las 5», «perdón, es el jueves», «me equivoqué, son 3 horas» se detectan sin LLM
  (`tipoCorreccion`) y editan la actividad de la **última acción del asistente** (diario `operaciones`, últimos 30 min). «No,
  cancélala» la quita (deshace su creación). Si no hay acción reciente y el modelo dice «crear», se convierte en «editar».
- **Horario ambiguo:** si no dices la hora de algo que aún no ha pasado, responde `tipo: 'aclaracion'` con
  `requiere_confirmacion: true` y 2-3 horarios **libres** (uno de mañana, tarde y noche, sin cruzarse con lo que ya tienes y después
  de la hora actual si es hoy) + «Sin hora fija». «Hoy jugué…», «a cualquier hora» o «todo el día» no preguntan.
- **Urgencia:** `compartido/prioridad.js` (vencida o ≤ 2 días = urgente, ≤ 7 = alta). Al liberar o reorganizar, lo urgente se
  reubica primero y **nunca se aplaza más allá de su `fecha_vencimiento`**. «Para el viernes», «se entrega el 20» o «vence mañana»
  fijan la fecha de vencimiento; un examen o una entrega vence el día en que ocurre; las subtareas de un proyecto vencen en su
  fecha límite.
- **Avisos:** todas las advertencias de sobrecarga son una sola oración que empieza por «Ojo:».

**Flujo.** El modelo devuelve un JSON con `intencion` (`crear | editar | mover | liberar_dia | reorganizar | planificar_proyecto |
eliminar | restaurar | importar | preguntar | charla`) y referencias textuales. El servidor lo valida con un esquema estricto, resuelve
fechas y horas en código («mañana» no se confunde con «por la mañana»; «de 10 pm a 1 am» cruza la medianoche; «1 hora y media» = 1.5)
y ejecuta lógica determinista. La respuesta es una de:

- **aplicado** — crear una actividad clara o editar/mover una sola se aplica directo, con botón **Deshacer**;
- **propuesta** — `{ crear[], editar[], mover[], eliminar[], restaurar[] }` con la carga por día antes/después y una frase por
  decisión («moví X al sábado porque ese día tienes 20 % de carga»). Mover o eliminar varias, liberar un día, reorganizar,
  planificar proyectos, eliminar e importar **exigen Aplicar/Cancelar**. La propuesta vive en MongoDB (id aleatorio, del usuario,
  un solo uso, caduca a los 10 min con índice TTL **y** comprobación de `expira` en código). Escribir «sí» aplica la propuesta
  visible; un «sí» sin propuesta pendiente no ejecuta nada;
- **aclaración** — solo si falta un dato que cambia el resultado (fecha límite, horas por día, aplazar o eliminar, qué actividad,
  conflicto de horario). Máximo 2 preguntas, con botones de respuesta rápida y texto libre; «Decide tú» usa valores razonables y
  los muestra como supuestos;
- **respuesta** — preguntas sobre tu agenda o charla (el modelo redacta con datos calculados por el código).

**Ediciones con semántica de parche.** El modelo recibe el registro completo de la actividad y solo se aplican los campos que tu
mensaje menciona: «mueve el entrenamiento al viernes» cambia la fecha (desplazando el rango completo) y conserva tipo, exigencia,
estado, proyecto y horario.

**Liberar un día** decide sobre **TODAS** las actividades pendientes de esa jornada: aplaza por defecto (eliminar solo si lo dices de
forma explícita; si dices «elimina todo lo del jueves», pregunta). Reubica en los 7 días siguientes (o hasta la entrega del proyecto
o el vencimiento de cada tarea), sin pasar del 85 % de capacidad de cada día (check-in de ese día o 100), prefiriendo días con
menos carga y cercanos, sin solapes de hora; ocio/deporte no van a días saturados. Los hitos (exámenes, entregas, exigencia alta) y
las **fijas** también aparecen en la propuesta, pero **desmarcados y con aviso** («márcala solo si de verdad cambió de fecha»): se
aplican solo si los marcas. Las completadas se quedan. Si nada cabe, propone lo menos malo y lo avisa.

**Proyectos.** Pregunta lo mínimo (fecha límite y horas por día), el modelo propone 4–10 tareas validadas y el planificador las
agenda en orden antes de la fecha límite dejando 1 día de colchón, con el campo `proyecto` (la página Proyectos las agrupa sola).
«Mueve/elimina el proyecto X» actúa sobre todas las actividades de ese proyecto.

**Voz (bidireccional).** *Hablar → texto:* botón 🎤 con la Web Speech API (`es-CO`, con `es-ES` de respaldo): los resultados parciales aparecen en el campo y **tú
revisas y envías**. Estados visibles (escuchando, sin permiso, error), `aria-pressed`/`aria-label`; si el navegador no lo admite o
la página no es HTTPS/localhost, el botón se desactiva con un mensaje. En Chrome/Edge el audio lo procesa el servicio de
reconocimiento del navegador; LearnTrack no graba ni guarda audio. Cabecera `Permissions-Policy: microphone=(self)`.
*Texto → voz:* «🔊 Leer respuestas» lee cada respuesta del servidor en cuanto llega (`speechSynthesis`, troceada en frases de
≤ 180 caracteres porque Chrome corta las largas; sin emojis), con la voz elegida en Configuración › Voz de la IA (se guarda en la
cuenta como `vozAsistente`; si esa voz no existe en el dispositivo se usa la primera en español). *Conversación:* «🗣 Conversación
por voz» encadena escuchar → enviar solo → responder en voz alta → volver a escuchar; con una propuesta pendiente basta decir «sí»
o «no». Se apaga al pulsarlo otra vez, ante un error del micrófono o tras dos silencios seguidos. Escribir o volver a hablar
interrumpe la lectura.

**Archivos + mensaje.** Botón 📎 o arrastrar y soltar: el archivo **queda preparado** junto al cuadro de texto (con ✕ para
quitarlo); escribes una explicación («son de la materia Redes», «solo los exámenes») y **Enviar** manda los dos juntos
(multipart con multer, en memoria). El servidor extrae el texto (PDF, DOCX, TXT, MD, CSV; los `.ics` se leen sin LLM; las
imágenes van al modelo de visión si configuras `OLLAMA_VISION_MODEL`) y envía a Llama 3.2 **tu mensaje + el contenido** en la misma
llamada (`Petición del usuario: …` + el documento entre delimitadores). Se valida la firma además de la extensión, máximo 30
páginas y 24 000 caracteres (troceados). El modelo extrae exámenes, entregas, tareas y clases con una **cita** del documento.
**Lo fiable se añade solo al calendario** en un único lote con **Deshacer**: elementos cuya cita aparece literalmente en el texto,
los de un `.ics` y los de una imagen (con aviso de revisar). Si tu mensaje nombra un proyecto o materia, se asigna a todo lo
importado; exámenes y entregas reciben su `fecha_vencimiento`. Lo **dudoso** (cita no encontrada) y los bloques de **preparación**
opcionales llegan aparte, en una propuesta con casillas desmarcadas. El texto del documento va entre delimitadores y el modelo
tiene instrucciones de ignorar lo que diga dentro (inyección de prompt): un archivo solo puede **añadir** actividades, nunca
editar ni borrar. El texto extraído no sale del servidor ni se guarda.

## Estudio (3.12)

**Estudio** (antes «Repaso», `/repaso` sigue redirigiendo) organiza el aprendizaje con **objetivos** (colección `objetivos_estudio`):
tema, habilidad o competencia, nivel actual y objetivo, fecha límite, prioridad, horas estimadas, progreso y sesiones. Las
sesiones son actividades normales del calendario con `objetivoId`, así que la carga, la papelera y Deshacer funcionan igual.
El repaso espaciado SM-2 se conserva sin cambios en la misma página.

- **Necesidades de aprendizaje**: «no entiendo…», «me cuesta…», «tengo dificultades con…» → **sugerencia** (con el motivo)
  que se acepta, pospone o descarta; si además pidió entender algo, el tutor lo explica. Las menciones repetidas se cuentan.
  «Quiero/necesito aprender X (antes del …)» → plan de estudio con propuesta. Una pregunta informativa («¿qué es…?») se
  explica pero **no** crea un tema. Lo descartado no se vuelve a sugerir por contexto. Detección en código
  (`interprete-lenguaje.js`), no en el modelo.
- **Contexto**: en Proyectos, «¿qué necesito aprender?» deduce temas de las tareas del proyecto abierto; en Estudio y
  Proyectos la conversación la lleva un **tutor** con los datos de esa sección (leídos en el servidor para la cuenta autenticada).
- **Plan de sesiones**: lo calcula `servicios/estudio/planificador-estudio.js` (sin LLM): antes de la fecha límite, primero lo
  que vence antes, huecos libres, ≤ 85 % de carga, una sesión por tema y día y como máximo 2 de estudio por día. La persona
  ajusta día, hora y duración y solo entonces se guarda.
- **Documentos académicos**: las fechas se calculan en código a partir de la **cita literal**; si la cita no está en el
  documento, la fecha se descarta; las relativas o con varias fechas piden confirmación. Nada se guarda sin confirmar.

## Mi agenda y Proyectos

- **Mi agenda** usa solo el diseño **Moderno**: a la izquierda, mini calendario y **⏰ Próximas entregas** (lo que vence antes,
  con su prioridad); a la derecha, la vista elegida en el **desplegable Mes / Semana / Día**. Las tareas urgentes (≤ 2 días) llevan ⚠.
- **Línea de tiempo académica** (debajo): cada trabajo de la universidad (tipo estudio con fecha de vencimiento, o un examen/entrega)
  como una barra desde el día en que se **asignó** (`fecha_asignacion`) hasta su **vencimiento**, con la línea de hoy y el progreso;
  los proyectos académicos se resumen en una fila con su % y enlazan a Proyectos.
- **Proyectos** (`/proyectos`): lista de proyectos con su progreso y la siguiente tarea; al elegir uno, sus subtareas en **Kanban**
  (Pendiente / En proceso / Completado, arrastrar y soltar o ◀ ▶) o en **Línea de tiempo** (Gantt con ◆ en cada vencimiento y la
  franja de hoy). Las archivadas cuentan para el progreso y se pueden «Devolver a la agenda». «+ Tarea» crea una ya dentro del proyecto.

## Limpieza automática y auto-estado

- **Limpieza (node-cron, `backend/servicios/tareas/limpieza.js`):** cada día a las 03:15 (`LIMPIEZA_CRON`, en `ZONA_HORARIA`) y al
  arrancar, las actividades **completadas** cuya fecha de vencimiento (o, si no tienen, su último día) ya pasó se **archivan**
  (`archivadaEn`): salen de la agenda pero siguen en la base, en Proyectos y en `GET /api/actividades/archivadas`. Con
  `LIMPIEZA_MODO=eliminar` van a la papelera (y se purgan solas); `desactivado` la apaga. Las pendientes nunca se tocan.
  Al archivar, los días pasados de la agenda dejan de mostrar esas actividades (el historial de carga ya guardado no cambia).
- **Auto-estado (`GET /api/actividades`):** antes de responder, las actividades **pendientes** cuyo horario incluye la hora actual
  del usuario pasan a **«en proceso»**. La hora es la LOCAL del navegador (cabecera `X-Zona-Horaria`, p. ej. America/Bogota; si
  no llega, `ZONA_HORARIA`), no el reloj UTC del servidor. Si cambias el estado a mano, el servidor respeta tu decisión
  (`estadoFijadoPorUsuario`). Sin hora definida, no se cambia nada.

## Regla de carga (única)

`compartido/carga.js` la usan el medidor del panel, el historial (servidor), el indicador por día de la agenda y el planificador:

- puntos = exigencia × horas × 10 (ocio/deporte de recarga, −2, restan); % = puntos / capacidad × 100;
- capacidad por check-in: alto 120, medio 100, bajo 70 (sin check-in, 100);
- una actividad aporta `horas` a **cada día** de su rango (`horas` = horas por día); las **completadas siguen contando**;
- semáforo: < 50 % verde, 50–85 % amarillo, > 85 % rojo (en la agenda: Mes, Semana y Día).

## Papelera y deshacer

**Eliminar** una actividad no la borra físicamente: `eliminadaEn` marca la actividad y todas las lecturas filtran `{ eliminadaEn: null }` (lo que también
cubre los documentos antiguos sin el campo). Un índice TTL las purga a los `PAPELERA_DIAS` días (30 por defecto); si cambias el valor,
el servidor ajusta el índice con `collMod` al arrancar. Cada cambio de la IA queda en el diario `operaciones` (TTL 7 días) con un
`loteId`: «Deshacer» o «deshaz lo último» revierten la operación completa. En el chat: «recupera lo que borré ayer», «restaura la tarea
de redes», «recupera todo lo de esta semana» (por fecha de borrado y/o título; si hay varias coincidencias, te las lista).

**Desde la ventana de la papelera (3.9):**
- Marca una o varias actividades con su casilla, o todas con «Seleccionar todas». Al hacerlo aparecen «♻ Restaurar (N)» y
  «Eliminar permanentemente (N)», que se aplican a toda la selección.
- «Vaciar papelera» está siempre visible, aunque haya algo seleccionado, y se deshabilita si la papelera está vacía.
- Las dos eliminaciones definitivas piden confirmación en una ventana que dice cuántas actividades se borran y que no se puede deshacer.

En el servidor, cada operación filtra a la vez por el usuario de la sesión **y** por `eliminadaEn ≠ null`. Así, una actividad activa
o de otra persona nunca coincide. Al vaciar se usa `deleteMany({ userId, eliminadaEn ≠ null })`. Al eliminar para siempre también se
borran del diario `operaciones` las copias de esas actividades.

## Barra de navegación y Configuración

- **Barra:** `componentes/barra-navegacion/` monta en las tres páginas privadas el **avatar** (abre un panel lateral con nombre,
  correo, «Editar mi perfil», «Cambiar de cuenta» —cierra la sesión y abre el acceso—, «Cerrar sesión» y el importador de festivos) y
  el **engranaje** (menú desplegable con las 6 secciones de Configuración). Teclado: Escape cierra, flechas recorren el menú, el foco
  vuelve al botón. «Mi perfil» ya no es un enlace del menú.
- **Configuración** (`/configuracion`; `/perfil` redirige): pestañas laterales con patrón ARIA (en móvil, barra horizontal). La
  dirección `#voz`, `#estetica`… abre cada pestaña (lo usa el menú del engranaje).

## Estética: temas, paleta con Colormind y fondo

- **Temas** (`frontend-react/src/estilos/temas.css`, variables `--color-*` en `:root[data-theme="…"]`): Tema Base (`tech-focus`, el de
  siempre), Moderno, Oscuro Profundo (negro `#000`), Futurista, Zen & Calm y Oscuro elegante. Las variables antiguas (`--azul`,
  `--cian`…) se reasignan a las nuevas, así que todo el CSS cambia sin reescribirlo. `tema-inicial.js` (script clásico en el `<head>`)
  aplica tema, paleta y fondo antes de pintar desde `localStorage` (solo caché) y lo corrige con `/api/auth/me`. Al cerrar sesión o
  cambiar de cuenta se borra esa caché. Para añadir un tema: su bloque en `temas.css`, su valor en `TEMAS` (`backend/modelos/Usuario.js`
  y `tema-inicial.js`) y una tarjeta en `configuracion.html`.
- **Paleta con IA (Colormind).** El navegador envía el color base a `POST /api/perfil/paleta` y **el servidor** hace el POST a
  Colormind (colormind.io solo responde por HTTP y la CSP no deja que la página conecte con otros dominios):

  ```js
  // backend/servicios/externos/colormind.js
  const respuesta = await pedirJSON('Colormind', 'http://colormind.io/api/', {
      method: 'POST', ms: 6000,
      body: { model: 'default', input: [hexARgb(semilla), 'N', 'N', 'N', 'N'] }   // "N" = que lo genere Colormind
  });
  // → { result: [[r,g,b] × 5] }; se valida, la semilla se respeta como 1.er color y, si Colormind no responde,
  //   se genera una paleta armónica local (fuente: 'local'). compartido/paleta.js convierte los 5 colores en variables
  //   CSS con contraste comprobado (texto ≥ 7:1, primario ≥ 4.5:1) y la página las aplica con
  //   document.documentElement.style.setProperty('--color-primario', '#…') — CSSOM, permitido por la CSP.
  ```

  La vista previa se aplica a toda la página sin guardar; «Guardar esta paleta» envía `{ temaSeleccionado: 'personalizado',
  coloresPersonalizados }` y aparece la tarjeta «Mi paleta».
- **Fondo personalizado.** La página reduce la imagen a 1920 px de ancho (JPEG) y la envía como multipart (campo `imagen`) a
  `POST /api/perfil/fondo`, que usa **multer** en memoria:

  ```js
  const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FONDO_BYTES, files: 1, fields: 0, parts: 2 } }).single('imagen');
  rutas.post('/fondo', (req, res, next) => subir(req, res, (err) => {
      if (!err) return next();
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El fondo supera 1,5 MB.' : 'Envía una sola imagen en el campo «imagen».' });
  }), async (req, res) => {
      const tipo = detectarImagen(req.file?.buffer);              // firma real: JPEG, PNG o WebP (nunca SVG)
      if (!tipo) return res.status(415).json({ error: 'El archivo no es una imagen JPEG, PNG o WebP válida.' });
      await db.guardarImagenBD('fondo', req.usuario.id, tipo, req.file.buffer);   // colección "fondos" + imagenFondoUrl
      res.status(201).json(respuestaPerfil(await db.obtenerPerfilBD(req.usuario.id)));
  });
  ```

  La imagen se guarda en MongoDB (colección `fondos`, una por usuario) y `imagenFondoUrl` = `/api/perfil/fondo?v=<fecha>`; se sirve
  solo a su dueño con `nosniff`. El frontend la aplica como `background-image` (variable `--fondo-imagen` con un velo del color de
  fondo para que el texto siga legible). En la versión completa de la ruta (`perfil.rutas.js`) también se exige `multipart/form-data`
  (415) y multer es opcional (sin él, 503 con aviso).

## Días festivos: fusión sin tocar tu agenda

Desde el avatar eliges país, región (opcional) y año; el servidor pide los festivos a **Nager.Date**
(`/api/v3/PublicHolidays/{año}/{país}`, sin clave) y los **fusiona** en tu cuenta. Nager.Date trabaja por país y por región
(estado, provincia o comunidad, código ISO 3166-2 como `ES-MD`), no por ciudad: por eso el selector dice «Región o ciudad» y lista
las regiones que el país publica. Cómo se evita cualquier conflicto:

1. **Viven aparte.** Los festivos se guardan en `Usuario.eventosImportados` (tipo `festivo`, fuente `nager.date`), **no** en la
   colección de actividades. Importar o quitar festivos no ejecuta ninguna escritura sobre `actividades`: tus tareas y eventos no
   se crean, cambian, mueven ni borran, y tampoco cambian su carga mental (los festivos no suman puntos).
2. **Solo se añade (push), nunca se reemplaza.** Cada festivo tiene un id determinista (`país-región-fecha-nombre`). Se inserta con
   una actualización atómica «añade si ese id no está ya»:
   `updateOne({ id: usuario, 'eventosImportados.id': { $ne: idFestivo } }, { $push: { eventosImportados: festivo } })`.
   Importar dos veces —o dos pestañas a la vez— no duplica; los festivos que ya tenías no se modifican.
3. **Coincidencias de fecha.** Si ya tienes una actividad ese día (incluso con el mismo título, p. ej. «Navidad»), las dos conviven:
   la agenda muestra el festivo como etiqueta 🎉 no editable junto a tus actividades. Una prueba lo comprueba comparando las actividades
   byte a byte antes y después de importar.
4. **Datos externos = no confiables.** Se descartan fechas inválidas o de otro año, se quitan etiquetas HTML y caracteres de control,
   como máximo 200 por petición y 600 por usuario (si se llega al límite se avisa). Si Nager.Date no responde: 503 y nada cambia.
5. **Quitar** («Quitar festivos importados») vacía solo `eventosImportados` (o los de un país); las actividades siguen igual.

La agenda los muestra en las vistas Mes, Semana y Día y en el mini calendario; Mi panel avisa si hoy es festivo.

## Voz, cuentas vinculadas y seguridad de la cuenta

- **Voz de la IA:** el selector lista las voces del sistema (`speechSynthesis.getVoices()`, las de español primero), «Probar voz» y
  «Guardar voz» (`vozAsistente` en la cuenta). Las voces dependen del sistema operativo y del navegador: una voz guardada en otro
  dispositivo se conserva y se marca «no disponible en este dispositivo».
- **Cuentas vinculadas:** YouTube, GitHub, Discord, Spotify, Steam y Xbox con estado Conectado/Desconectado. `INTEGRACIONES_MODO` =
  `simulado` (por defecto fuera de producción: solo guarda el estado, **sin hablar con los servicios**, y la pantalla lo avisa) o
  `desactivado` (por defecto en producción: 501). El enganche para OAuth real es `iniciarVinculacion()` en
  `backend/servicios/cuenta/integraciones.js`. No se guardan tokens; cuando los guardes, cífralos. Los iconos son genéricos (vídeo,
  código, chat, música, mando): para los logos oficiales usa el kit de prensa de cada marca.
- **Notificaciones:** se guardan el interruptor general y las dos preferencias, pero **todavía no hay nada que envíe notificaciones**.
- **Privacidad y seguridad:** cambiar la contraseña exige la actual (y cierra las demás sesiones). **Eliminar cuenta** tiene doble
  confirmación: botón «Eliminar cuenta…» y, en la ventana, contraseña + escribir `ELIMINAR`. Borra usuario, sesiones, actividades
  (también la papelera), festivos, historial, check-ins, propuestas, diario de operaciones, foto, fondo y mensajes de contacto.

## Verificación del correo

Desde la v3.10, una cuenta nueva no puede entrar hasta demostrar que tiene acceso a su correo:

1. **Crear cuenta** valida los datos, crea la cuenta *pendiente* (`emailVerificado: false`), genera un código de 6 dígitos con
   `crypto.randomInt` y lo envía por SMTP (Nodemailer). **No** inicia sesión: el navegador recibe solo una cookie temporal
   (`lt_verif`, 1 hora) que liga el código a ese navegador.
2. La ventana pasa a «Verifica tu correo electrónico»: correo oculto (`usua***@gmail.com`), seis casillas (se puede pegar el código),
   cuenta atrás de la caducidad y «Reenviar código» con su espera.
3. **Verificar correo** comprueba el código en el servidor; si es correcto marca `emailVerificado: true`, borra el código y entonces
   inicia la sesión normal y lleva a «Mi panel».

| Variable | Por defecto | Para qué |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | —, 587, false | Servidor de correo (465 + `SMTP_SECURE=true` para TLS directo) |
| `SMTP_USER`, `SMTP_PASS` | — | Credenciales (en Gmail, una *contraseña de aplicación*) |
| `SMTP_FROM` | `LearnTrack <SMTP_USER>` | Remitente visible |
| `OTP_EXPIRATION_MINUTES` | 10 | Validez del código (1–60) |
| `OTP_MAX_ATTEMPTS` | 5 | Intentos fallidos por código (1–10); después hay que pedir otro |
| `OTP_RESEND_COOLDOWN_SECONDS` | 60 | Espera entre envíos al mismo correo |
| `OTP_MAX_SENDS_PER_HOUR` | 5 | Máximo de códigos por correo y hora |
| `VERIFICACION_CUENTAS_ANTIGUAS` | `permitir` | Cuentas creadas antes de la v3.10: `permitir` (conservan el acceso) o `exigir` (verifican al entrar) |

Sin `SMTP_HOST`, en desarrollo los correos se guardan como `.eml` en `correos-dev/` (ábrelos con tu cliente de correo); en
producción el registro de cuentas nuevas queda desactivado (nunca se finge un envío). Al arrancar, el servidor indica el modo y
comprueba la conexión SMTP. Las cuentas que nunca se verifican se borran solas a los 7 días (índice TTL parcial).

## Cuentas, documentos legales y administración (3.13)

- **Registro:** además de nombre, correo y contraseña, pide la **fecha de nacimiento** y una casilla **desmarcada** «He leído y
  acepto los Términos y Condiciones y la Política de Tratamiento de Datos Personales de LearnTrack» (enlaces a `/terminos` y
  `/privacidad`). El servidor lo vuelve a comprobar (`aceptaDocumentos === true` y versiones vigentes) aunque el navegador ya lo haga.
- **Evidencia de la aceptación:** por documento, versión, huella SHA-256 del texto exacto, fecha y vía (`registro`,
  `actualizacion`, `representante`). Sin IP ni seguimiento.
- **Edad:** mínimo 14 años. De 14 a 17, se piden nombre, correo y parentesco del representante; recibe un correo con un enlace
  (`/autorizacion-representante#t=…`, válido 7 días, un solo uso, en la base de datos solo su hash) para autorizar o no. Hasta que
  autoriza, la API responde 403 `autorizacion_representante`; si no autoriza, la cuenta y sus datos se eliminan.
- **Versión nueva de un documento:** sube `VERSION_TERMINOS` o `VERSION_PRIVACIDAD` en `compartido/legal.js`. Cada cuenta verá una
  pantalla para aceptarla (la API responde 428 `aceptacion_pendiente`); ver el perfil, cerrar sesión y eliminar la cuenta siguen disponibles.
- **Textos:** `compartido/legal.js` es la fuente única (`npm run legal:md` genera `DOCUMENTOS-LEGALES.md`). Son un borrador para
  revisión de un abogado colombiano; los datos `[PENDIENTE: …]` deben completarse antes de publicar.
- **Check-in diario:** ahora es opcional («Ahora no»), porque ánimo y sueño pueden ser datos sensibles de salud.
- **Administrador único:** se crea solo con `npm run admin:crear` (ver [ADMINISTRADOR.md](ADMINISTRADOR.md)); panel en `/admin`.

## Seguridad

- **Verificación del correo (v3.10):** código de `crypto.randomInt`; en MongoDB solo su hash (scrypt con sal, ligado al usuario);
  comparación en tiempo constante; caduca; un solo uso; 5 intentos (reservados de forma atómica, también en paralelo); espera entre
  envíos y máximo por hora y correo; límites por IP para verificar (30 / 15 min) y reenviar (10 / h). El código va ligado al
  navegador que se registró (cookie `lt_verif`): registrar el correo de otra persona no permite quedarse con su cuenta. El
  servidor solo acepta sesiones de cuentas verificadas en **cada** petición. Ni el código, ni su hash, ni el token aparecen en
  respuestas o logs.
- **Contraseñas:** scrypt con sal aleatoria. **Sesiones:** token de 256 bits en cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` con
  `NODE_ENV=production`); en la base solo su SHA-256; 7 días; máximo 5 por usuario.
- **Perfil:** cambiar correo/contraseña o eliminar la cuenta exige la contraseña actual (8 intentos fallidos / 15 min por usuario); la foto y el fondo se validan por firma real (no se acepta SVG) y se sirven con `nosniff`.
- **APIs externas (Nager.Date, Colormind):** solo las llama el servidor (la CSP mantiene `connect-src 'self'`), con tiempo máximo,
  sin seguir redirecciones, respuesta máx. 512 kB y límite de 30 consultas / 15 min por usuario; su respuesta se valida y se limpia.
- **Límites:** login 5 fallos por cuenta y 15 por IP / 15 min; registro 8/h por IP; verificación 30 / 15 min y reenvío 10/h por IP; API general 300 / 15 min por IP; y, **por usuario
  y por separado**: chat 30 / 15 min, archivos 6 / 15 min, consejo 20 / 15 min.
- **Salida del modelo = entrada no confiable:** esquema estricto, máximo 30 operaciones por propuesta, solo sobre actividades del
  usuario. Los ids que propone el modelo se verifican en **una** consulta `{ userId, id: { $in } }`; al aplicar se vuelven a verificar
  y si el número no coincide se rechaza toda la propuesta (sin IDOR).
- **Inyección NoSQL:** cada valor externo que llega a un filtro se valida como texto simple (`esTexto`) y, como segunda capa,
  `mongoose.set('sanitizeFilter', true)` (los operadores propios se marcan con `mongoose.trusted`).
- **CSRF:** `SameSite=Strict` + rechazo de cualquier `Origin` ajeno. **CORS:** solo el propio sitio (más `ALLOWED_ORIGINS`).
- **Cuerpos:** JSON máximo 10 kB; la ruta de archivos tiene su propio límite (multipart, 1 archivo, 5 MB).
- **CSP estricta en todas las páginas:** `script-src 'self'`, `style-src 'self'` + Google Fonts, sin `unsafe-inline`. Ninguna página
  tiene `style=""`, `<style>`, scripts en línea ni manejadores `on*` (lo comprueba una prueba). Los anchos dinámicos (barra de carga,
  vista semanal, Gantt) se fijan desde JavaScript con CSSOM (`element.style`), que la CSP sí permite.
- **XSS:** el frontend escribe todo texto con `textContent` (sin `innerHTML`); el servidor elimina caracteres de control y `< >`.
- **Logs:** no se registran cuerpos de peticiones ni el contenido de los archivos.

## Producción

- Sirve la app por HTTPS (también lo necesita el dictado por voz fuera de localhost) y define `NODE_ENV=production`.
- Detrás de un proxy inverso define `TRUST_PROXY=1` (si no, el límite por IP verá la IP del proxy).
- Configura el SMTP (`SMTP_HOST`…): en producción sin él no se pueden crear cuentas. Con `SMTP_SECURE=false` se exige STARTTLS.
  Para que los códigos no acaben en spam, usa un remitente de tu dominio con SPF, DKIM y DMARC.
- En Atlas activa las copias de seguridad y restringe Network Access a las IP de tu servidor.

## Límites conocidos

- Cambiar el correo desde Configuración (exige la contraseña) todavía **no** vuelve a pedir un código para el correo nuevo.
- El registro sigue respondiendo «Ese correo ya está registrado» para correos de cuentas existentes (comportamiento anterior a la
  v3.10); eso permite saber si un correo tiene cuenta, como antes.

- Llama 3.2 3B puede clasificar mal un mensaje; por eso las fechas y cargas se calculan en código, hay correcciones deterministas
  para frases inequívocas y todo cambio grande pasa por una propuesta. Las respuestas reales dependen de tu modelo y su contexto.
- El auto-estado se aplica cuando se piden las actividades (al abrir o refrescar la agenda, cada 5 min con la pestaña abierta), no
  en segundo plano; tampoco marca «completado» al terminar el horario (eso lo decides tú).
- Archivar quita de la agenda las completadas ya vencidas: los porcentajes de carga de días pasados que se ven en la agenda bajan
  (el historial guardado no cambia). Si prefieres verlas, usa `LIMPIEZA_MODO=desactivado` o una gracia (`LIMPIEZA_DIAS_GRACIA`).
- Las imágenes se leen solo con un modelo de visión (`OLLAMA_VISION_MODEL`); no hay OCR local. Lo leído de una imagen se añade solo,
  así que conviene revisarlo (o deshacerlo con un clic).
- Festivos: Nager.Date no tiene festivos por ciudad (solo país y región) y no cubre todos los países; la lista sale de su API.
- La voz depende del navegador: el dictado necesita Chrome o Edge (HTTPS o localhost); la lectura funciona en la mayoría, pero las
  voces disponibles cambian por sistema. La respuesta se lee cuando llega completa (el servidor no la envía por partes).
- Colormind es un servicio gratuito sin garantía de disponibilidad y solo por HTTP; si falla se usa la paleta local.
- Las reglas de repetición de los `.ics` (RRULE) no se expanden: se importa la primera ocurrencia y se avisa.
- Un evento que cruza la medianoche se guarda en su día de inicio, sin hora de fin y con sus horas totales.
- Los PDF escaneados (imagen sin texto) no se pueden leer sin un modelo de visión.
- `mammoth` (lector de DOCX) arrastra `argparse`/`sprintf-js`, con un aviso moderado de `npm audit` que afecta a su herramienta de
  línea de comandos, no a la lectura de documentos que usa LearnTrack.


## Despliegue separado (GitHub Pages + Railway)

Consulta [`DEPLOY-GITHUB-PAGES-RAILWAY.md`](./DEPLOY-GITHUB-PAGES-RAILWAY.md) para publicar el frontend en GitHub Pages y la API en Railway. La autenticación entre dominios requiere configurar correctamente cookies y CORS; se recomienda un dominio propio compartido por ambos subdominios.
