# Publicar LearnTrack 3.11.0: GitHub Pages + Railway

Esta configuración separa el frontend estático (GitHub Pages) de la API (Railway). MongoDB Atlas continúa siendo la base de datos. Express arranca en modo API_ONLY y no intenta servir `frontend-react/dist`.

## Requisito de autenticación entre dominios

LearnTrack usa una cookie HttpOnly `lt_sid` con `SameSite=Strict` por defecto. La opción más fiable es configurar un dominio propio para que el frontend y la API sean subdominios del mismo sitio registrable, por ejemplo:

- Frontend GitHub Pages: `https://app.midominio.com`
- API Railway: `https://api.midominio.com`

Son orígenes distintos (CORS) pero mismo sitio (SameSite), por lo que la cookie Strict puede viajar con `credentials: include`. Configura DNS y los dominios personalizados en GitHub Pages y Railway. En este caso usa `VITE_BASE_PATH=/` y `COOKIE_SAME_SITE=Strict`.

Si usas la URL predeterminada `https://usuario.github.io/LearnTrack/` y un dominio `*.up.railway.app`, son sitios distintos. En ese caso `COOKIE_SAME_SITE=None` es necesario para intentar enviar la cookie, pero los navegadores pueden bloquear cookies de terceros; no se garantiza que registro/login/sesiones funcionen en todos los navegadores. Para autenticación fiable, usa el dominio propio descrito arriba.

## 1. GitHub: repositorio y Pages

1. Sube todo el proyecto a un repositorio llamado `LearnTrack` y conserva la rama `main`.
2. No subas `.env`, contraseñas, claves ni URI de MongoDB. `.gitignore` excluye `.env`.
3. En el repositorio abre **Settings → Pages**.
4. En **Build and deployment → Source**, selecciona **GitHub Actions**.
5. En **Settings → Secrets and variables → Actions → Variables**, crea:
   - `VITE_API_URL`: URL pública HTTPS de la API Railway, sin `/` final (ej. `https://learntrack-api.up.railway.app`).
   - `VITE_BASE_PATH`: `/LearnTrack/` para la URL estándar de proyecto. Si configuras un dominio propio en la raíz, usa `/`.
6. El workflow `.github/workflows/deploy-pages.yml` compila y publica el frontend en cada push a `main`.
7. GitHub Pages entrega `404.html` como fallback SPA para las rutas internas.

`VITE_API_URL` es pública: se incluye en el bundle del navegador. Nunca pongas secretos en variables `VITE_*`.

## 2. Railway: publicar solo la API Express

1. Crea un proyecto en Railway y añade un servicio desde el repositorio GitHub.
2. Mantén el **Root Directory** en `/` (raíz del repositorio), porque `server.js`, `package.json` y `backend/` están en la raíz.
3. Railway detectará `railway.json`: `npm ci` para instalar y `npm start` para arrancar.
4. En **Settings → Networking**, genera un dominio HTTPS.
5. En **Variables**, configura como mínimo:

```env
NODE_ENV=production
API_ONLY=true
TRUST_PROXY=1
MONGO_URI=TU_URI_DE_MONGODB_ATLAS
ALLOWED_ORIGINS=https://TU-USUARIO.github.io
COOKIE_SAME_SITE=None
```

Para un dominio propio, reemplaza `ALLOWED_ORIGINS` por el origen exacto del frontend (ej. `https://app.midominio.com`) y cambia `COOKIE_SAME_SITE=Strict`. No agregues rutas `/LearnTrack/` al origen: solo esquema + host.

Configura además SMTP real para registro/verificación de correo:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

No uses la contraseña normal del correo; utiliza credenciales SMTP o contraseña de aplicación.

`MONGO_URI` debe ser una conexión de MongoDB Atlas con acceso de red permitido desde Railway. No dejes la base de datos abierta a todo Internet salvo que conozcas y aceptes ese riesgo.

## 3. Ollama / asistente IA

Ollama en `localhost` del computador no es accesible desde Railway. Para habilitar el asistente configura `OLLAMA_API_BASE` con un endpoint remoto privado y seguro, y `OLLAMA_API_KEY` si el proveedor lo requiere. No expongas el puerto 11434 sin protección. El resto de la API puede estar disponible aunque la IA no esté configurada.

## 4. Comprobaciones

- `https://TU-API/healthz` debe responder `{ "ok": true, "servicio": "learntrack" }`.
- Abre el frontend y revisa que los recursos carguen bajo `/LearnTrack/` (o `/` con dominio propio).
- Prueba login, logout, verificación por correo, `/api/auth/me`, crear/editar/eliminar actividades y papelera.
- En DevTools → Network comprueba que las llamadas vayan a `VITE_API_URL`, que las respuestas CORS incluyan `Access-Control-Allow-Credentials: true` y que el navegador acepte la cookie `lt_sid`.
- Si el navegador bloquea cookies de terceros con `github.io` + `railway.app`, configura un dominio propio para frontend y API y cambia SameSite a Strict.

## 5. Seguridad y límites

- GitHub Pages hace públicos todos los archivos JS/CSS compilados, incluidos los módulos cargados de forma diferida bajo `r/privado/`. La separación por chunks ya no es una barrera de seguridad. No hay secretos en el frontend; cada endpoint de datos debe seguir validando la sesión en Express. La API conserva `requiereAuthApi`; los guardias React solo mejoran la navegación y no sustituyen la autorización del backend.
- La URL de la API y los orígenes CORS no son secretos. Nunca incluyas credenciales en el código ni en variables `VITE_*`.
- GitHub Pages publica únicamente archivos estáticos. Railway ejecuta Express; Atlas almacena los datos; Ollama requiere un endpoint accesible desde Railway.

## 6. Actualizaciones

Frontend: cada `git push` a `main` ejecuta GitHub Actions y actualiza Pages.
Backend: Railway despliega automáticamente cambios del repositorio según su configuración.

```bash
git add .
git commit -m "Actualizar LearnTrack"
git push origin main
```
