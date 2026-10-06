# LearnTrack

Planificador de carga mental con asistente de IA (Gemini) y acceso con cuenta.

## Ejecutar

Requiere Node.js 18 o superior (`node -v`).

```
npm install
copy .env.example .env      (Windows)   |   cp .env.example .env   (Mac/Linux)
npm start
```

Abre http://localhost:3000. En el `.env` pon tu `GEMINI_API_KEY`; sin ella todo funciona, pero el asistente
muestra un consejo genérico.

## Estructura

```
server.js                 Rutas, límites de peticiones, cabeceras de seguridad
src/auth.js               Contraseñas (scrypt), sesiones, protección de rutas, verificación de Origin
src/validacion.js         Validación y sanitización de toda entrada del cliente
src/database.js           Persistencia en data_store.json (usuarios, sesiones, actividades, historial)
src/ai-service.js         Llamada a Gemini (la clave solo existe en el servidor)
public/                   Páginas públicas: index, planificador-info, asistente-info, 404 + auth.js
private/                  Dashboard: solo se sirve con sesión válida (no está dentro de public/)
```

## Rutas

| Ruta | Acceso |
|---|---|
| `/`, `/planificador-info.html`, `/asistente-info.html` | Públicas |
| `/app-dashboard.html` | Privada: sin sesión redirige a `/?acceso=login` |
| `POST /api/auth/registro`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me` | Autenticación |
| `/api/actividades`, `/api/historial`, `/api/ia/consultar` | Requieren sesión; cada usuario solo ve lo suyo |
| `POST /api/contacto` | Pública (con límite); los mensajes se guardan en `data_store.json` |

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
- **Cuerpo máximo:** `express.json({ limit: '10kb' })`.
- **Secretos:** `GEMINI_API_KEY` solo en `.env` (excluido por `.gitignore`); el navegador nunca la ve.

## Producción

- Sirve la app por HTTPS y define `NODE_ENV=production` para que la cookie sea `Secure`.
- Detrás de un proxy inverso define `TRUST_PROXY=1` (si no, el límite de peticiones verá la IP del proxy).
- `data_store.json` es un archivo JSON pensado para un solo proceso y pocos usuarios. Para más carga,
  migra `src/database.js` a una base de datos real; el resto del código no cambia.
- Copias de seguridad: guarda `data_store.json` (contiene hashes de contraseñas y correos).
