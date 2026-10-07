# LearnTrack

Planificador de carga mental con asistente de IA local (Ollama · Llama 3.2), agenda con 8 vistas y acceso con cuenta.

## Ejecutar

Requiere Node.js 18 o superior (`node -v`).

```
npm install
copy .env.example .env      (Windows)   |   cp .env.example .env   (Mac/Linux)
# edita .env y pon tu MONGO_URI de MongoDB Atlas
npm start
```

**MongoDB Atlas:** crea un clúster, un usuario de base de datos (Database Access) y permite tu IP (Network Access);
copia la cadena de conexión (Connect → Drivers) en `MONGO_URI`. Las colecciones e índices se crean solos al arrancar.
Si venías de la versión con `data_store.json`, importa tus datos una vez con `npm run migrar:datos`
(o `npm run migrar:datos -- ruta/al/data_store.json`); las sesiones no se importan: solo hay que iniciar sesión de nuevo.

Abre http://localhost:3000. La IA corre en local con Ollama (`ollama pull llama3.2` y `ollama serve`); si no está
activo todo funciona igual, pero el asistente no responderá y el chat no podrá crear actividades (puedes crearlas con el botón «Nueva actividad»).

## Estructura

```
server.js                 Rutas, límites de peticiones, cabeceras de seguridad
src/auth.js               Contraseñas (scrypt), sesiones, protección de rutas, verificación de Origin
src/validacion.js         Validación y sanitización de toda entrada del cliente
src/database.js           Acceso a datos (consultas Mongoose, todo asíncrono)
models/                   Esquemas Mongoose: Usuario, Sesion, Actividad, Historial (plano), Mensaje
scripts/importar-data-store.js  Importación única desde el antiguo data_store.json
src/ai-service.js         Llamadas a Ollama (consejos y parseo de lenguaje natural → JSON de actividad)
public/                   Páginas públicas: index, planificador-info, asistente-info, 404 + auth.js
private/                  Dashboard y Agenda (calendario.html/.js/.css): solo se sirven con sesión válida
```

## Rutas

| Ruta | Acceso |
|---|---|
| `/`, `/planificador-info.html`, `/asistente-info.html` | Públicas |
| `/app-dashboard.html`, `/calendario.html` | Privadas: sin sesión redirigen a `/?acceso=login` (middleware `requiereAuthPagina`) |
| `POST /api/auth/registro`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me` | Autenticación |
| `/api/actividades`, `/api/historial`, `/api/ia/consultar`, `/api/ia/parsear`, `/api/ia/agendar` | Requieren sesión; cada usuario solo ve lo suyo |
| `POST /api/contacto` | Pública (con límite); los mensajes se guardan en la colección `mensajes` |

## Mi agenda (`/calendario.html`)

Sección dedicada a la gestión del tiempo con 8 vistas intercambiables: **Mensual, Semanal, Diario, Kanban, Timeline (Gantt),
Minimalista, Eventos y Moderno**. Todas abren el mismo modal para crear, editar (`PUT`) o eliminar (`DELETE`) actividades.
Kanban admite arrastrar tarjetas o moverlas con ◀ ▶. En la vista Timeline las actividades se agrupan por `proyecto`.

**Chat con IA.** `POST /api/ia/agendar { texto, fechaHoy }` → Llama 3.2 devuelve un JSON → el servidor lo normaliza y valida
(un modelo pequeño se equivoca: se corrigen tipos, horas y fechas) → se guarda asociado al usuario autenticado → responde con
la actividad y la lista actualizada, y el frontend repinta la vista activa.

**Modelo de actividad** (todos los campos nuevos son opcionales; las actividades antiguas siguen funcionando):

| Campo | Valores |
|---|---|
| `titulo`, `tipo`, `exigencia`, `horas` | como antes (`tipo`: estudio/trabajo/ocio/deporte; `exigencia`: 3, 2, 1, -2; `horas`: 0.5–12) |
| `fecha_inicio` / `fecha_fin` | `YYYY-MM-DD` (`fecha` se mantiene como alias de `fecha_inicio`) |
| `hora_inicio` / `hora_fin` | `HH:MM` 24 h o vacío; si hay ambas y no envías `horas`, se calculan |
| `estado` | `pendiente` · `en_proceso` · `completado` (columnas del Kanban) |
| `proyecto` | texto ≤ 60 (agrupa en el Timeline) |

`PUT /api/actividades/:id` acepta cambios parciales (p. ej. solo `{ "estado": "completado" }`).

## Seguridad

- **Contraseñas:** scrypt con sal aleatoria (módulo `crypto` de Node). Nunca se guardan en claro.
- **Sesiones:** token aleatorio de 256 bits en cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` con `NODE_ENV=production`).
  En disco solo se guarda su hash SHA-256. Duran 7 días; máximo 5 sesiones por usuario.
- **Fuerza bruta:** login limitado a 5 fallos por cuenta y 15 por IP cada 15 min; registro 8/hora por IP;
  consultas a la IA 20 cada 15 min por usuario; API general 300 cada 15 min por IP.
- **Login sin filtraciones:** mismo mensaje y mismo tiempo de respuesta exista o no la cuenta.
- **Cabeceras:** `helmet` con CSP estricta (sin scripts en línea ni de terceros), `frame-ancestors 'none'`, HSTS, etc.
- **XSS / inyección:** validación de tipos y rangos en el servidor, eliminación de caracteres de control y `< >`,
  y el frontend solo escribe texto con `textContent` (nunca `innerHTML` con datos del usuario).
- **CSRF:** `SameSite=Strict`, solo se aceptan cuerpos JSON y se rechaza cualquier `Origin` ajeno.
- **CORS:** solo el propio sitio; otros orígenes con `ALLOWED_ORIGINS` en el `.env`.
- **Inyección NoSQL:** todo valor externo que llega a un filtro de Mongo se valida como texto simple (incluidos los ids que propone la IA), además de la validación de `validacion.js`.
- **Cuerpo máximo:** `express.json({ limit: '10kb' })`.
- **Secretos:** claves y configuración solo en `.env` (excluido por `.gitignore`); el navegador nunca las ve.
- **Agenda:** todo el contenido dinámico se escribe con `textContent` (sin `innerHTML`), sin estilos ni scripts en línea (compatible con la CSP estricta); el chat de IA tiene el mismo límite por usuario que el asistente.

## Producción

- Sirve la app por HTTPS y define `NODE_ENV=production` para que la cookie sea `Secure`.
- Detrás de un proxy inverso define `TRUST_PROXY=1` (si no, el límite de peticiones verá la IP del proxy).
- Datos en MongoDB Atlas: activa las copias de seguridad del clúster (contiene correos y hashes de contraseñas) y
  restringe Network Access a las IP de tu servidor en lugar de `0.0.0.0/0`.
- Las sesiones caducan solas gracias a un índice TTL en la colección `sesiones`.
- El historial se guarda plano: un documento `{ userId, fecha, porcentaje }` por usuario y día (índice único); la API
  sigue devolviendo el objeto `{ 'YYYY-MM-DD': porcentaje }` de siempre.
