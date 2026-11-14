# LearnTrack 3.10.0 — Verificación del correo con código de 6 dígitos (OTP)

Base: `LearnTrack-3.9.0.zip`, la última versión entregada. Se mantienen la arquitectura, React, la PWA, la CSP, el calendario, las actividades, la papelera, Nexo y el resto de módulos.

El inicio de sesión de las cuentas existentes **no cambia**. Ver §7.

## 1. Flujo completo

```
Crear cuenta ──► POST /api/auth/registro
                 · valida nombre, correo (normalizado) y contraseña
                 · crea la cuenta PENDIENTE (emailVerificado: false) — SIN sesión
                 · código de 6 dígitos (crypto.randomInt) → solo su hash en MongoDB
                 · correo por SMTP (Nodemailer) + cookie temporal lt_verif (liga el código a ESTE navegador)
                 ◄── 202 { verificacion: { emailOculto: "usua***@gmail.com", expiraEnSegundos, reenviarEnSegundos, … } }

«Verifica tu correo electrónico» (misma ventana de acceso)
   6 casillas · pegar · solo números · cuenta atrás · «Reenviar código (0:45)» · errores claros

Verificar correo ──► POST /api/auth/verificar-correo { codigo } (+ cookie lt_verif)
                 · comprueba que existe, que no ha caducado, que no se ha usado y que quedan intentos
                 · reserva el intento de forma ATÓMICA y compara en tiempo constante
                 · correcto → emailVerificado: true, borra el código y la cookie temporal
                 · y SOLO ENTONCES inicia la sesión normal (lt_sid) ──► «Mi panel»
```

- **Abandonar y volver.** Si recargas o vuelves a abrir LearnTrack con la cookie temporal todavía vigente, `/?acceso=verificar` retoma el paso de verificación. Las páginas privadas también te llevan ahí. Si la cookie ya caducó, inicias sesión con tu correo y tu contraseña: el servidor no abre sesión, responde `403 verificacion_pendiente`, reutiliza el código vigente o envía uno nuevo, y la ventana pasa al paso de verificación.
- **El paso no se puede omitir.** Sin el código correcto el servidor no crea la sesión. Además, `cargarSesion` rechaza en **cada petición** cualquier sesión de una cuenta sin verificar, aunque alguien la fabricara a mano en la base de datos. Hay una prueba que lo comprueba.

## 2. Rutas del backend

Se siguen las convenciones existentes: rutas en español bajo `/api/auth` y el formato de error `{ error, codigo }`.

| Ruta | Equivale a | Respuestas |
|---|---|---|
| `POST /api/auth/registro` (ya existía; ahora con verificación) | `register` | `202 { verificacion }`. `400` datos no válidos. `409` correo ya registrado. `429` hay que esperar. `503` el correo no salió (`correo_no_enviado`, con `verificacion` para pedir otro) o el SMTP no está configurado en producción (`correo_no_disponible`). |
| `POST /api/auth/verificar-correo` `{ codigo }` | `verify-email` | `200 { usuario }` y la sesión. `400` formato o código incorrecto, con los intentos restantes. `401 sin_verificacion` (sin cookie, o cookie caducada o ya usada). `410` código caducado, anulado o ya utilizado. `429` demasiados intentos. |
| `POST /api/auth/reenviar-codigo` | `resend-verification` | `200 { verificacion }`. `429` espera entre envíos o máximo por hora (`reenviarEnSegundos`). `401`. `503`. |
| `GET /api/auth/verificacion` | — (nueva) | `200 { verificacion }` para retomar el proceso, o `404`. |
| `POST /api/auth/login` (ya existía) | — | Igual que antes para cuentas verificadas y antiguas. Una cuenta sin verificar con la contraseña correcta recibe `403 { codigo: 'verificacion_pendiente', verificacion }`, sin sesión. |

Límites por IP nuevos: verificar, 30 cada 15 min; reenviar, 10 por hora. Se suman al límite de registro que ya existía (8 por hora).

## 3. Seguridad del código

| Requisito | Cómo se cumple |
|---|---|
| Código aleatorio criptográfico | `crypto.randomInt(0, 1_000_000)`, con ceros a la izquierda. Nunca `Math.random()`. |
| Solo el hash en MongoDB | `scrypt$sal$hash`: scrypt con sal aleatoria y el id del usuario como contexto, así el hash de una cuenta no sirve en otra. Comparación con `timingSafeEqual`. |
| Caducidad configurable | `OTP_EXPIRATION_MINUTES` (10 por defecto, acotado entre 1 y 60). |
| Un solo uso | Al verificar se borra todo el subdocumento `verificacionEmail`. La operación es atómica: solo puede ganar una petición. |
| Código nuevo invalida el anterior | Cada envío sustituye el hash, reinicia los intentos y rota el token del navegador. |
| Límite de intentos | `OTP_MAX_ATTEMPTS` (5). El intento se **reserva** con `$inc` condicionado antes de comparar, de modo que ni las ráfagas en paralelo ni el doble clic dan intentos extra. Al agotarlos, el código se anula. |
| Anti envío masivo | Espera entre envíos (`OTP_RESEND_COOLDOWN_SECONDS`, 60 s) y máximo por correo y hora (`OTP_MAX_SENDS_PER_HOUR`, 5), ambos en la base de datos, más los límites por IP. Los reenvíos simultáneos usan concurrencia optimista: se envía **un** solo correo. |
| Sin registros pendientes duplicados | Índice único del correo: un registro repetido **sustituye** al pendiente, nunca crea otro. Los pendientes abandonados se borran a los 7 días (índice TTL **parcial**, solo `emailVerificado: false`). |
| Correo normalizado | Se reutiliza `normalizarEmail` (recorta espacios y pasa a minúsculas), como en el registro anterior. |
| Nadie verifica el correo de otra persona | El código va ligado al navegador que se registró (cookie `lt_verif`, `HttpOnly`, `SameSite=Strict`; en la base de datos solo su SHA-256). Si otra persona registra tu correo, el código llega a **tu** bandeja y ella no puede completarlo. Cuando tú te registras de nuevo, vale **tu** contraseña. Está probado como intento de robo de cuenta. |
| Nada sensible expuesto | Ni el código, ni su hash, ni el token aparecen en respuestas ni en logs. Está probado capturando la consola durante el flujo. Los errores SMTP se registran solo por su tipo, sin destinatario. El código no va en el **asunto** del correo, que se ve en las notificaciones. |
| Protección en el backend | `puedeEntrar()` es la única regla y se aplica en el inicio de sesión y en `cargarSesion` en cada petición. Mandar `emailVerificado: true` en el registro no tiene efecto. |

## 4. Correo (Nodemailer + SMTP)

- **Configuración.** Solo por `.env`. `.env.example` documenta `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_REQUIRE_TLS`, `OTP_*` y `VERIFICACION_CUENTAS_ANTIGUAS`. En producción, si `SMTP_SECURE=false`, se **exige** STARTTLS con TLS 1.2 o superior.
- **Modos** (los indica el servidor al arrancar, y además comprueba la conexión SMTP):

  | Modo | Cuándo | Qué hace |
  |---|---|---|
  | `smtp` | Hay `SMTP_HOST` | Envía el correo. |
  | `archivo` | Desarrollo sin SMTP | Guarda el correo como `.eml` en `correos-dev/`, carpeta incluida en `.gitignore` y excluida del ZIP. No imprime el código en la consola. |
  | `no_configurado` | Producción sin SMTP | El registro responde «no disponible». Nunca se finge un envío. |

- **Diseño del correo** (`plantilla-verificacion.js`):
  - colores de LearnTrack y logo incrustado (`cid:`, sin imágenes remotas que permitan rastrear la apertura);
  - título «Verifica tu dirección de correo»;
  - el código en seis casillas grandes y la frase «El código expira en 10 minutos»;
  - aviso de seguridad («si no has solicitado crear una cuenta…, puedes ignorar este mensaje»);
  - versión en texto plano;
  - HTML con tablas y estilos en línea (compatible con Gmail, Outlook y Apple Mail), con un ancho máximo de 560 px que se adapta al móvil.

  Se comprobó con capturas a 700 px y a 375 px de ancho.

### Ejemplo con Gmail

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tu.cuenta@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx      # contraseña de aplicación (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones)
SMTP_FROM=LearnTrack <tu.cuenta@gmail.com>
```

Con Outlook o Microsoft 365 se usa `smtp.office365.com:587` con `SMTP_SECURE=false` (STARTTLS). Para un despliegue real conviene un servicio transaccional (Brevo, Mailgun, Amazon SES) con un dominio propio y SPF, DKIM y DMARC, para que los códigos no lleguen a spam.

## 5. Interfaz (React)

- **Componente.** El paso de verificación está en `VerificacionCorreo.jsx`, dentro de la misma ventana de acceso y con sus estilos.
- **Casillas.** Seis casillas numéricas (`inputMode="numeric"`; la primera con `autocomplete="one-time-code"` para el autocompletado del móvil):
  - avanzan solas al escribir y retroceden con Borrar o con las flechas;
  - aceptan **pegar** el código entero, aunque traiga espacios o tabuladores, como al copiarlo de las casillas del correo;
  - ignoran cualquier carácter que no sea un dígito.
- **Mensajes y tiempos.**
  - Texto «Se ha enviado un código de verificación a usua***@gmail.com».
  - Cuenta atrás «El código caduca en 9:41», calculada con los **segundos** que envía el servidor, así que no le afecta un reloj del dispositivo desajustado.
  - «Reenviar código (0:45)» desactivado hasta que termina la espera.
  - Mensajes de error (`role="alert"`) y de éxito (`role="status"`).
- **Indicador de carga.** La rueda de `aria-busy` que ya tenía la app.
- **Sin doble envío.** Los botones se desactivan durante la petición y una referencia bloquea un segundo envío.
- **Código caducado.** Desactiva «Verificar» y permite pedir otro **sin rellenar de nuevo el formulario**.
- **Usar otro correo.** Vuelve a «Crear cuenta».
- **Errores del servidor.** Si el SMTP falla, la ventana pasa igualmente al paso de verificación, muestra el error y deja «Reenviar código» disponible.
- **Responsive.** Probado en escritorio y en un móvil de 390 px (las casillas caben y miden al menos 44 px de alto).

## 6. Casos especiales (todos probados)

| Caso | Resultado |
|---|---|
| Código correcto | Verifica e inicia la sesión. |
| Código incorrecto | «Código incorrecto. Te quedan N intentos.» |
| Código expirado | «El código ha expirado. Pide uno nuevo…». El reenvío funciona. |
| Código ya utilizado | `401`/`410`; no se crea otra sesión. |
| Demasiados intentos (también en paralelo) | El código se anula; ni el correcto sirve; hay que pedir otro. |
| Reenvío demasiado frecuente | «Podrás pedir otro en 45 s», o el máximo por hora. |
| Reenvíos simultáneos | Un único correo. |
| Doble clic en «Verificar» | Una sola verificación y una sola sesión. |
| Correo de un usuario ya verificado | `409` «Ese correo ya está registrado» (también con mayúsculas o espacios); no se le envía nada. |
| Abandona y vuelve | Se retoma con `/?acceso=verificar` o iniciando sesión. Si el código caducó, se envía uno nuevo. |
| Error del servidor SMTP (rechazo o desconexión) | Mensaje claro; se puede reenviar sin esperar en cuanto el SMTP vuelve. |
| Error de conexión con MongoDB | El manejador de errores existente responde con un error genérico. Sin base de datos no se crea sesión, porque `cargarSesion` falla cerrado. |
| Registro del correo de otra persona | No permite robar la cuenta (ver §3). |

## 7. Cuentas existentes (migración)

Las cuentas creadas antes de la v3.10 no tienen el campo `emailVerificado`. **No se marcan como verificadas**, porque nunca demostraron tener acceso a su correo, y tampoco se bloquean por sorpresa.

- **`VERIFICACION_CUENTAS_ANTIGUAS=permitir`** (por defecto): conservan el acceso como hasta ahora. El campo sigue sin existir, así que se pueden distinguir y contar en cualquier momento.
- **`VERIFICACION_CUENTAS_ANTIGUAS=exigir`**: su sesión deja de valer, y en el siguiente inicio de sesión reciben un código y deben verificar. Al hacerlo pasan a `emailVerificado: true`.
- **Limpieza de pendientes.** Nunca entran en la limpieza de registros abandonados: el TTL solo afecta a `emailVerificado: false` con `pendienteHasta`, y las cuentas antiguas no tienen ese campo.

No hace falta ningún script de migración: la decisión se toma con la variable de entorno y se puede revertir. Para saber cuántas cuentas antiguas quedan: `db.usuarios.countDocuments({ emailVerificado: { $exists: false } })`.

## 8. Dependencias

| Paquete | Versión | Motivo |
|---|---|---|
| `nodemailer` (nueva) | 10.3.1 (fijada) | Envío SMTP. No tiene dependencias propias y su licencia es MIT-0. Es la versión publicada hace más de dos semanas, a 14 de noviembre de 2026. |
| `mongoose` (actualizada) | 8.24.5 → 8.24.7 (parche) | Hoy apareció un aviso **alto** de `npm audit` sobre Mongoose (GHSA-gg4r-jv3p-qx3c y otros, incluido uno sobre `sanitizeFilter`, que este proyecto usa contra la inyección NoSQL). Con 8.24.7, `npm audit --omit=dev` vuelve a 0. |

## 9. Archivos

**Nuevos:**

| Archivo | Contenido |
|---|---|
| `backend/servicios/cuenta/verificacion-correo.js` | Generación y hash del código, token, correo oculto, `puedeEntrar`, configuración acotada, espera y máximo de envíos. |
| `backend/servicios/cuenta/correo.js` | Nodemailer: modos `smtp`, `archivo` y `no_configurado`, comprobación al arrancar y errores sin datos personales. |
| `backend/servicios/cuenta/plantilla-verificacion.js` | Correo HTML y texto plano. |
| `backend/datos/verificacion.js` | Operaciones atómicas: crear pendiente, sustituir código, reservar intento, completar y anular envío. |
| `frontend-react/src/publico/VerificacionCorreo.jsx` | Pantalla de verificación. |
| `tests/utilidades/smtp-falso.js` | Servidor SMTP simulado con el protocolo real y decodificación MIME. |
| `tests/integracion/verificacion-correo.test.js` | 21 pruebas. |
| `tests/unitarias/verificacion-correo.test.js` | 11 pruebas. |
| `frontend-react/src/publico/VerificacionCorreo.test.jsx` | 12 pruebas. |
| Este informe | — |

**Modificados:**

| Archivo | Cambio |
|---|---|
| `backend/modelos/Usuario.js` | `emailVerificado`, `emailVerificadoEn`, subdocumento `verificacionEmail` (`codigoHash`, `expira`, `intentos`, `ultimoEnvio`, `enviosDesde`, `envios`, `tokenHash`, `tokenExpira`), `pendienteHasta`, índice TTL parcial e índice del token. |
| `backend/rutas/auth.rutas.js` | Registro con verificación, `verificar-correo`, `reenviar-codigo`, `verificacion`, y `login` para cuentas sin verificar. |
| `backend/middleware/autenticacion.js` | Cookie temporal `lt_verif`. `cargarSesion` exige `puedeEntrar()`. Las páginas privadas redirigen a `/?acceso=verificar` si hay una verificación en curso. |
| `backend/middleware/limites.js` | Límites por IP `verificacion` y `reenvio`. |
| `backend/datos/usuarios.js` | `SIN_SECRETOS` excluye `verificacionEmail` y `pendienteHasta`. |
| `backend/datos/index.js` | Exporta `verificacion.js`. |
| `server.js` | Indica el modo de correo y comprueba la conexión SMTP al arrancar. |
| `frontend-react/src/publico/acceso.jsx` | Paso de verificación en la misma ventana. |
| `frontend-react/src/publico/ZonaPublica.jsx` | Admite `?acceso=verificar`. |
| `frontend-react/src/api/publico.js` | `verificarCorreo`, `reenviarCodigo`, `estadoVerificacion`. |
| `frontend-react/src/publico/estilos/acceso.css` | Estilos de las casillas, la cuenta atrás y los enlaces; versión móvil. |
| `tests/utilidades/entorno.js` | SMTP simulado y un tarro de cookies con varias cookies. `registrar()` completa la verificación leyendo el código del correo, así que todas las pruebas anteriores pasan por el flujo nuevo. |
| `tests/navegador/prueba-react.js`, `prueba-animaciones.js` | Registro con código en el navegador real: incorrecto y correcto, `/panel` sin verificar, pantalla en móvil. |
| `tests/integracion/seguridad.test.js` | Fecha **fija** para los archivos de prueba (§11). |
| `.env.example`, `.gitignore`, `scripts/generar-zip.js`, `README.md`, `package.json` | Versión 3.10.0, `nodemailer`, `mongoose` 8.24.7. |

## 10. Resultados reales (Linux, Node 22.23, Chromium de Playwright, 14-nov-2026)

| Comando | Resultado |
|---|---|
| `npm run build` | correcto |
| `npm run test:front` | **62/62** (50 anteriores + 12 de verificación) |
| `npm test` | **200/200**, dos ejecuciones (168 anteriores + 11 unitarias + 21 de integración) |
| `npm run test:e2e` | **66/66** (62 anteriores + 4 del registro con código en el navegador) |
| `npm run test:e2e:animaciones` | **43/43** (incluye la pantalla de verificación en escritorio y en móvil de 390 px) |
| `npm audit --omit=dev` | **0** vulnerabilidades en producción. Quedan 10 moderadas o bajas solo en herramientas de desarrollo y compilación (Vitest, Workbox, `archiver`). |

Además, el ZIP entregado se descomprimió en una carpeta vacía y allí se repitieron `npm ci`, `build`, `test:front` y `npm test`.

**Las pruebas también comprueban que detectan los fallos.** Se rompió a propósito la implementación de tres formas y las pruebas lo detectaron:

1. Quitar la comprobación de `emailVerificado` en cada petición hace fallar 2 pruebas.
2. Quitar el límite de intentos de la reserva atómica hace fallar la prueba de fuerza bruta en paralelo. Esa prueba se añadió precisamente porque, sin ella, este caso no se detectaba.
3. Quitar el control de concurrencia del reenvío hace fallar la prueba de reenvíos simultáneos.

Todas las pruebas son reales: el envío pasa por Nodemailer y un servidor SMTP simulado que habla el protocolo SMTP, y el código se lee del correo recibido. **No se probó con un proveedor SMTP real** (Gmail u otro), porque este entorno no tiene credenciales ni salida a esos servidores. Conviene hacer un registro de prueba tras configurar el `.env`.

## 11b. Pendiente

- **Cambio de correo.** Cambiar el correo desde Configuración, que exige la contraseña, todavía no pide un código para el correo nuevo.
- **Correos existentes.** El registro sigue diciendo «Ese correo ya está registrado» para correos con cuenta, como antes de esta versión.
- **Prueba con el proveedor real.** Falta comprobar el envío con el proveedor SMTP real que elijas.

## 11. Prueba que fallaba antes de empezar (no causada por este cambio)

Antes de tocar nada, `npm test` sobre la 3.9.0 dio **167/168**. Falló «inyección de prompt desde un archivo».

La causa es una fecha fija dentro del archivo de prueba: el documento dice «Quiz el 3 de noviembre» y la prueba usaba la fecha real. Desde el 4 de noviembre de 2026 esa fecha queda en el pasado, y la app, correctamente, deja de añadir sola una actividad pasada y la propone para revisar.

Se corrigió **la prueba**, no la app: ahora usa la misma fecha fija que `importar.test.js`. Lo que comprueba (delimitadores, que la inyección no borra nada y que no queda nada en los logs) no cambió.
