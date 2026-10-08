# LearnTrack 3.0

Planificador de carga mental con asistente de IA local (Ollama · Llama 3.2), agenda con 8 vistas y acceso con cuenta (MongoDB Atlas).
El asistente conversa en «Mi panel» y «Mi agenda»: agenda, edita y mueve actividades, libera un día aplazando lo que no cabe,
reorganiza la semana, divide un proyecto en tareas antes de su fecha límite, lee cronogramas (PDF, DOCX, TXT, MD, CSV, ICS),
admite dictado por voz y recupera lo que borraste. **La IA solo clasifica y extrae; fechas, cargas y cambios los decide el código**,
y todo cambio grande se te propone antes de aplicarlo.

## Ejecutar

Requiere **Node.js 18 o superior** (`node -v`). La lectura de **PDF** necesita Node **20.16 o superior** (lo exige `pdfjs-dist`);
con una versión anterior todo lo demás funciona y el chat avisa de que el PDF no está disponible.

```
npm install
copy .env.example .env      (Windows)   |   cp .env.example .env   (Mac/Linux)
# edita .env y pon tu MONGO_URI de MongoDB Atlas
npm start
```

Abre http://localhost:3000.

### MongoDB Atlas

Crea un clúster, un usuario de base de datos (Database Access) y permite tu IP (Network Access); copia la cadena de conexión
(Connect → Drivers) en `MONGO_URI`. Las colecciones, los índices (únicos y TTL) y las migraciones idempotentes se aplican solos al
arrancar. Atlas es un *replica set*, así que **aplicar una propuesta es atómico** (transacción multi-documento). Si conectas un
MongoDB independiente sin réplica, la app lo detecta al arrancar, lo avisa en consola y aplica los cambios uno a uno (sin atomicidad),
compensando con el diario si algo falla a mitad.

Si venías de la versión con `data_store.json`, importa tus datos una vez con `npm run migrar:datos`
(o `npm run migrar:datos -- ruta/al/data_store.json`). Las actividades antiguas solo tenían `fecha`: el servidor completa
`fecha_inicio`/`fecha_fin` al arrancar (*backfill* idempotente); también puedes lanzarlo a mano con `npm run migrar:fechas`.

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
npm test            # 84 pruebas: fechas, carga, planificador, validación, archivos, datos, chat con Ollama simulado, seguridad
npm run test:e2e    # navegador real (opcional): npm i -D playwright-core && npx playwright install chromium
```

- **Ollama simulado** (`tests/helpers/ollama-falso.js`): servidor compatible con OpenAI; hay una prueba por cada intención, más
  modelo caído (503) y JSON inválido (reintento y 502 sin escribir nada).
- **Base de datos de prueba**, por orden: `MONGO_URI_TEST` (MongoDB real desechable) → `mongodb-memory-server` si lo instalas
  (`npm i -D mongodb-memory-server`) → `tests/helpers/mongo-memoria.js`, un servidor **en memoria que habla el protocolo de MongoDB
  pero no es MongoDB** (filtros con `mingo`, índices únicos, `collMod`, transacciones con instantánea). La salida de `npm test`
  indica cuál se usó. Para validar contra un MongoDB real, define `MONGO_URI_TEST`.
- `npm run test:e2e` arranca `server.js` y comprueba en Chromium (zona horaria America/Bogota): sin violaciones de CSP, check-in en
  el servidor, el chat crea actividades y las vistas se redibujan, Aplicar/Deshacer, papelera, archivo PDF con casillas y la misma
  carga en panel y agenda.

## Estructura

```
server.js                 Arranque: .env, MongoDB, índices/migraciones, escucha y cierre ordenado
src/app.js                Rutas, límites por usuario, cabeceras de seguridad (crearApp: también lo usan las pruebas)
src/entorno.js            Carga el .env antes que cualquier modelo
src/auth.js               Contraseñas (scrypt), sesiones, protección de rutas, verificación de Origin
src/validacion.js         Validación y sanitización de toda entrada (incl. parche de edición por IA)
src/database.js           Acceso a datos: borrado lógico, papelera, check-ins, propuestas, diario, transacciones, backfill
src/ai-service.js         Llamadas a Ollama (JSON, temperatura 0.1, un reintento) y tareas del modelo
src/prompts.js            Un prompt por tarea (clasificar, extraer, desglosar, archivo, redactar, consejo) con ejemplos
src/esquemas-ia.js        Esquemas estrictos para la salida del modelo (entrada no confiable)
src/interpretar.js        Español → fechas, rangos de horas (con cruce de medianoche) y duraciones, de forma determinista
src/planificador.js       Liberar día, reorganizar, planificar proyectos, carga antes/después (determinista)
src/chat.js               Orquestación de /api/ia/chat y de los archivos
src/archivos.js, src/ics.js   Archivos en memoria (firma + extensión, límites) y parser iCalendar
compartido/               Módulos ES puros que usan servidor y navegador: fechas.js y carga.js (regla única de carga)
models/                   Usuario, Sesion (TTL), Actividad, Historial, Mensaje, Checkin, Propuesta (TTL), Operacion (TTL)
private/                  Mi panel, Mi agenda, chat-ia.js (chat compartido), papelera.js, comun.js, app.css (solo con sesión)
public/                   Páginas públicas, auth.js, landing.js, estilos
scripts/                  importar-data-store.js (importación única) y backfill-fechas.js
tests/                    Pruebas (node:test), simuladores, fixtures y prueba de navegador
```

Todo lo privado (`/app-dashboard.html`, `/calendario.html` y `/app/*`, incluido `/app/compartido/*`) se sirve tras **una sola regla**
protegida por sesión: sin sesión, las páginas redirigen a `/?acceso=login` y los recursos responden 401.

## API

| Ruta | Descripción |
|---|---|
| `POST /api/auth/registro`, `/login`, `/logout`, `GET /api/auth/me` | Autenticación |
| `GET/POST /api/actividades`, `PUT/DELETE /api/actividades/:id` | CRUD manual. `DELETE` es **borrado lógico** (va a la papelera) |
| `GET /api/papelera`, `POST /api/papelera/:id/restaurar` | Papelera y restauración manual |
| `GET /api/checkin?fecha=`, `GET /api/checkins?desde=&hasta=`, `PUT /api/checkin` | Check-in diario (servidor; el navegador solo lo cachea) |
| `GET/POST /api/historial` | El servidor calcula el % con la regla única; solo días ≤ hoy (fecha local del cliente) |
| `POST /api/ia/chat` | **Único** punto de entrada del chat (sustituye a `/api/ia/agendar` y `/api/ia/parsear`, eliminados) |
| `POST /api/ia/archivo` | Archivo (multipart, 1 archivo, máx. 5 MB) → propuesta con casillas |
| `POST /api/propuestas/:id/aplicar` · `/cancelar` | Confirmar o descartar una propuesta (un solo uso, 10 min) |
| `POST /api/operaciones/:loteId/deshacer` | Deshace un cambio completo de la IA |
| `POST /api/ia/consultar` | Consejo breve del panel |
| `GET /api/ia/capacidades` | Formatos de archivo disponibles, visión, transacciones, días de papelera |
| `POST /api/contacto` | Pública (con límite) |

Todas las peticiones del chat envían `fechaHoy` (fecha **local** del navegador; sin ella el servidor responde 400, nunca usa la
fecha UTC) y `tzOffset` (`getTimezoneOffset()`, para interpretar «lo que borré ayer» en tu zona horaria).

## El asistente

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

**Liberar un día** aplaza por defecto (eliminar solo si lo dices de forma explícita; si dices «elimina todo lo del jueves», pregunta).
Reubica en los 7 días siguientes (o hasta la entrega del proyecto), sin pasar del 85 % de capacidad de cada día (check-in de ese día
o 100), prefiriendo días con menos carga y cercanos, sin solapes de hora; ocio/deporte no van a días saturados. No mueve hitos
(exigencia alta o títulos tipo examen, parcial, entrega) ni actividades marcadas como **fijas** (casilla nueva del modal), ni las
completadas. Si nada cabe, propone lo menos malo y lo avisa.

**Proyectos.** Pregunta lo mínimo (fecha límite y horas por día), el modelo propone 4–10 tareas validadas y el planificador las
agenda en orden antes de la fecha límite dejando 1 día de colchón, con el campo `proyecto` (el Timeline las agrupa solo).
«Mueve/elimina el proyecto X» actúa sobre todas las actividades de ese proyecto.

**Voz.** Botón 🎤 con la Web Speech API (`es-CO`, con `es-ES` de respaldo): los resultados parciales aparecen en el campo y **tú
revisas y envías**. Estados visibles (escuchando, sin permiso, error), `aria-pressed`/`aria-label`; si el navegador no lo admite o
la página no es HTTPS/localhost, el botón se desactiva con un mensaje. En Chrome/Edge el audio lo procesa el servicio de
reconocimiento del navegador; LearnTrack no graba ni guarda audio. Cabecera `Permissions-Policy: microphone=(self)`.

**Archivos.** Botón 📎 o arrastrar y soltar. Se procesan en memoria (no se escriben en disco ni se registran en logs), se valida la
firma además de la extensión, máximo 30 páginas y 24 000 caracteres (troceados en fragmentos y fusionados). Los `.ics` se leen sin
LLM. En el resto, el modelo extrae exámenes, entregas y clases con una **cita** del documento; si la cita no aparece en el texto, el
elemento se muestra desmarcado y con aviso. Siempre termina en una **propuesta con casillas** (nunca se aplica solo); para exámenes y
entregas futuras propone bloques de preparación opcionales (desmarcados). El texto del documento va entre delimitadores y el modelo
tiene instrucciones de ignorar lo que diga dentro (inyección de prompt); su salida solo puede producir actividades nuevas propuestas.
El texto extraído no sale del servidor ni se guarda: solo se guarda la propuesta (títulos, fechas y citas cortas) durante 10 minutos.

## Regla de carga (única)

`compartido/carga.js` la usan el medidor del panel, el historial (servidor), el indicador por día de la agenda y el planificador:

- puntos = exigencia × horas × 10 (ocio/deporte de recarga, −2, restan); % = puntos / capacidad × 100;
- capacidad por check-in: alto 120, medio 100, bajo 70 (sin check-in, 100);
- una actividad aporta `horas` a **cada día** de su rango (`horas` = horas por día); las **completadas siguen contando**;
- semáforo: < 50 % verde, 50–85 % amarillo, > 85 % rojo (en la agenda: mensual, semanal, diaria y moderna).

## Papelera y deshacer

Nada se borra físicamente: `eliminadaEn` marca la actividad y todas las lecturas filtran `{ eliminadaEn: null }` (lo que también
cubre los documentos antiguos sin el campo). Un índice TTL las purga a los `PAPELERA_DIAS` días (30 por defecto); si cambias el valor,
el servidor ajusta el índice con `collMod` al arrancar. Cada cambio de la IA queda en el diario `operaciones` (TTL 7 días) con un
`loteId`: «Deshacer» o «deshaz lo último» revierten la operación completa. En el chat: «recupera lo que borré ayer», «restaura la tarea
de redes», «recupera todo lo de esta semana» (por fecha de borrado y/o título; si hay varias coincidencias, te las lista).

## Seguridad

- **Contraseñas:** scrypt con sal aleatoria. **Sesiones:** token de 256 bits en cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` con
  `NODE_ENV=production`); en la base solo su SHA-256; 7 días; máximo 5 por usuario.
- **Límites:** login 5 fallos por cuenta y 15 por IP / 15 min; registro 8/h por IP; API general 300 / 15 min por IP; y, **por usuario
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
- En Atlas activa las copias de seguridad y restringe Network Access a las IP de tu servidor.

## Límites conocidos

- Llama 3.2 3B puede clasificar mal un mensaje; por eso las fechas y cargas se calculan en código, hay correcciones deterministas
  para frases inequívocas y todo cambio grande pasa por una propuesta. Las respuestas reales dependen de tu modelo y su contexto.
- Las reglas de repetición de los `.ics` (RRULE) no se expanden: se importa la primera ocurrencia y se avisa.
- Un evento que cruza la medianoche se guarda en su día de inicio, sin hora de fin y con sus horas totales.
- Los PDF escaneados (imagen sin texto) no se pueden leer sin un modelo de visión.
- `mammoth` (lector de DOCX) arrastra `argparse`/`sprintf-js`, con un aviso moderado de `npm audit` que afecta a su herramienta de
  línea de comandos, no a la lectura de documentos que usa LearnTrack.
