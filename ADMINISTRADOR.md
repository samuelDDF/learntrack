# Administrador único de LearnTrack (v3.13)

LearnTrack tiene **una sola** cuenta de administración. No se crea desde la web (no hay registro público ni ruta HTTP que la
cree): solo con un script que se ejecuta en tu equipo o en el servidor. No hay credenciales predeterminadas y la contraseña
nunca se guarda en archivos ni variables de entorno.

## Qué archivos intervienen

| Archivo | Para qué |
|---|---|
| `scripts/admin.js` | El script: `crear`, `verificar` y `restablecer` |
| `backend/datos/administracion.js` | Crea el administrador, impide un segundo, comprueba la integridad, auditoría |
| `backend/modelos/Usuario.js` | Campo `rol` (inmutable) e índice único parcial `administrador_unico` |
| `backend/modelos/Auditoria.js` | Registro de acciones administrativas (se conserva 2 años) |
| `backend/validacion/admin.js` | Reglas de la contraseña del administrador y de las acciones del panel |
| `backend/rutas/admin.rutas.js` | API `/api/admin/*` (404 para cualquiera que no sea el administrador) |
| `frontend-react/src/features/admin/` | Panel `/admin` |

## Variables de entorno (solo nombres y propósito)

| Variable | Propósito |
|---|---|
| `MONGO_URI` | Base de datos donde se crea el administrador (la misma que usa la app) |
| `ADMIN_EMAIL` | Correo del administrador. Debe ser **distinto** del de cualquier cuenta normal |
| `ADMIN_NOMBRE` | Opcional. Nombre visible (por defecto «Administración») |
| `URL_PUBLICA_APP` | No es del administrador: dirección pública de la app para el enlace del correo al representante de un menor |

La **contraseña no es una variable**: el script la pide en la consola, sin mostrarla, dos veces.

## 1. Genera una contraseña fuerte

Requisitos del script: mínimo 14 caracteres, al menos 3 de 4 tipos (minúsculas, mayúsculas, números, símbolos) y que no
contenga la parte de tu correo antes de la @. Recomendado: usa un **gestor de contraseñas** (Bitwarden, 1Password, KeePassXC…)
y su generador (20 o más caracteres). Guárdala solo allí. No la pegues en chats, correos, `.env` ni Railway.

## 2. Desarrollo (tu equipo, base de datos local o de pruebas)

1. Abre una terminal en la carpeta del proyecto (la que tiene `package.json`).
2. En tu `.env` (que ya tiene `MONGO_URI`), añade la línea `ADMIN_EMAIL=` seguida del correo del administrador.
3. Ejecuta `npm run admin:crear`.
4. Escribe la contraseña cuando la pida (no verás nada al escribir: es normal) y pulsa Enter; repítela.
5. Debe responder `✔ Administrador creado: a***@d***.com` y `índice único activo`.

## 3. Producción (MongoDB Atlas que usa Railway)

El script se ejecuta **en tu equipo**, conectado a la base de datos de producción. No se despliega nada.

1. En MongoDB Atlas → tu proyecto → **Database** → **Connect** → **Drivers**: copia la cadena de conexión
   (o búscala en Railway → tu servicio → **Variables** → `MONGO_URI`).
2. En Atlas → **Network Access**, comprueba que la IP de tu equipo está permitida (si no, **Add IP Address** → **Add current IP**;
   quítala al terminar si no la necesitas).
3. En la terminal, solo para esa sesión (no lo guardes en archivos):
   - PowerShell (Windows): `$env:MONGO_URI = "…"` y `$env:ADMIN_EMAIL = "…"`
   - bash/zsh (macOS/Linux): `export MONGO_URI="…"` y `export ADMIN_EMAIL="…"`
4. Ejecuta `npm run admin:crear` y escribe la contraseña dos veces.
5. Cierra la terminal al terminar (las variables desaparecen).

`ADMIN_EMAIL` **no** hace falta en Railway: el servidor web no lo usa. Sí debes poner `URL_PUBLICA_APP` en Railway
(Variables → New Variable) con la dirección pública de la app.

## 4. Verifica

`npm run admin:verificar` (con `MONGO_URI` de esa base de datos). Debe mostrar:
`Administradores encontrados: 1`, `Índice único «administrador_unico»: activo` y `✔ Todo correcto`.
Código de salida: 0 correcto; 2 si no hay administrador o algo no cuadra. El panel también muestra la integridad arriba.

## 5. Comprueba que un segundo administrador es imposible

Vuelve a ejecutar `npm run admin:crear` (con otro `ADMIN_EMAIL` si quieres). Debe responder
`✖ Ya existe un administrador. LearnTrack solo admite uno: no se creó nada.` (código 2). Aunque alguien saltara el script,
MongoDB rechaza un segundo documento con `rol: 'admin'` por el índice único parcial, y el campo `rol` es inmutable: no se puede
convertir una cuenta normal en administrador desde la app (el registro siempre crea `rol: 'usuario'`, y cualquier `rol` enviado
en el cuerpo se descarta).

## 6. Inicia sesión

Abre LearnTrack → **Iniciar sesión / Registro** → pestaña **Iniciar sesión** → el correo del administrador y su contraseña.
Entrarás directamente en `/admin`. La sesión de administración dura 8 horas. Esta cuenta no tiene agenda, proyectos ni IA
(la API de usuario le responde 403).

## 7. Si pierdes la contraseña (recuperación)

LearnTrack no tiene recuperación de contraseña por correo (y para el administrador no debe tenerla). Con acceso a la base de datos:
`npm run admin:restablecer` con el mismo `ADMIN_EMAIL` → escribe la contraseña nueva dos veces. Se cierran todas sus sesiones y
queda en la auditoría. Si además perdiste el correo, no se puede cambiar desde el script: pídelo a quien administre la base de datos.

## 8. Evitar que otras personas ejecuten el script

- Quien tenga `MONGO_URI` puede ejecutar el script (y en realidad puede todo en la base de datos). La protección real es
  **proteger la cadena de conexión**: no la compartas, usa un usuario de Atlas con contraseña fuerte, limita **Network Access**
  y rota la contraseña del usuario de Atlas si sospechas una filtración (y actualízala en Railway).
- El script no tiene ninguna ruta web: desde Internet no se puede ejecutar.
- Revisa la **Auditoría** del panel: queda registrado `Administrador creado`, `Contraseña restablecida` e `Inicio de sesión del administrador`.

## Qué hace el panel `/admin`

- **Resumen:** totales (cuentas, activas y nuevas en 7 días, suspendidas, sin verificar, menores sin autorización) y la integridad.
- **Cuentas:** búsqueda por nombre, correo o id; filtro por estado; 25 por página. La cuenta de administración nunca aparece.
- **Ficha:** correo, estado, fecha de registro, última actividad, si es menor y el estado de la autorización, documentos aceptados
  (versión y fecha) y **solo conteos** de uso (nunca el contenido de actividades, proyectos, estudio o check-ins).
- **Acciones:** suspender (motivo obligatorio; fecha de fin opcional, máximo un año; cierra sus sesiones), reactivar, cerrar
  sesiones y eliminar (hay que escribir el correo de la cuenta y un motivo; borra todos sus datos). El administrador no puede
  suspenderse ni eliminarse a sí mismo (el servidor responde 404 a su propio id).
- **Auditoría:** cada acción con fecha y motivo (sin contraseñas ni el correo de cuentas eliminadas).
