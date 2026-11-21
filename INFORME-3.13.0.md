# LearnTrack 3.13.0: autenticación, administrador único y documentos legales

## Resumen

- **Registro con aceptación obligatoria:** una casilla desmarcada con el texto acordado, validada en el navegador y en el
  servidor. Queda evidencia de cada aceptación: versión, huella SHA-256 del texto, fecha y vía.
- **Edad mínima de 14 años:** entre 14 y 17, el representante legal autoriza la cuenta desde un enlace que recibe por correo.
- **Versión nueva de un documento:** hay que aceptarla antes de seguir usando la app. Mientras tanto se puede cerrar sesión o
  eliminar la cuenta.
- **Administrador único:** se crea solo con un script; la base de datos impide un segundo. Su cuenta solo tiene acceso al
  panel `/admin`, que es invisible para los demás (404).
- **Panel de administración:** buscar, filtrar y paginar cuentas; ver su ficha, solo con conteos de uso; suspender, reactivar,
  cerrar sesiones y eliminar; auditoría de todas las acciones.
- **Documentos legales completos:** Términos y Condiciones (16 secciones) y Política de Tratamiento de Datos (11 secciones).
  Se publican en `/terminos` y `/privacidad` y están en `DOCUMENTOS-LEGALES.md`. Son un borrador para revisión profesional,
  con los datos desconocidos marcados `[PENDIENTE: …]`.

## Inicio de sesión

No cambia: se entra en la ventana de acceso y se va a la página privada pedida o a `/panel`, sin recargar la página. Lo único
que aparece solo es el check-in del primer acceso del día, que ahora es opcional («Ahora no»). Hay tres excepciones:

- la cuenta de administración va a `/admin`;
- un menor sin autorización ve una pantalla de espera;
- si hay documentos nuevos, se muestra la pantalla para aceptarlos.

En las pruebas no apareció ningún otro menú que se abra solo tras iniciar sesión.

## Archivos

**Creados:**
- **Backend:**
  - `compartido/legal.js`
  - `backend/modelos/Auditoria.js`
  - `backend/datos/administracion.js`
  - `backend/datos/legal.js`
  - `backend/rutas/admin.rutas.js`
  - `backend/servicios/cuenta/legal.js`
  - `backend/servicios/cuenta/representante.js`
  - `backend/servicios/cuenta/plantilla-representante.js`
  - `backend/validacion/admin.js`
- **Scripts:**
  - `scripts/admin.js`
  - `scripts/documentos-legales-md.js`
- **Frontend:**
  - `frontend-react/src/features/legal/` (páginas Términos, Privacidad y AutorizacionRepresentante; componentes
    DocumentoLegal y PantallaCuentaPendiente; legal.css; legal.test.jsx)
  - `frontend-react/src/features/admin/` (PanelAdmin, DetalleCuenta, formato, admin.service, admin.css)
  - `frontend-react/src/components/navigation/RutaAdmin.jsx`
- **Pruebas:**
  - `tests/integracion/admin.test.js`
  - `tests/integracion/legal.test.js`
- **Documentación:**
  - `ADMINISTRADOR.md`
  - `DOCUMENTOS-LEGALES.md`
  - este informe

**Modificados:**
- **Backend:**
  - `backend/modelos/Usuario.js`: `rol` inmutable, estado, suspensión, último acceso, aceptaciones, fecha de nacimiento,
    representante e índices.
  - `backend/middleware/autenticacion.js`: suspensión, `requiereAdmin`, cuentas pendientes y sesión de 8 h para el administrador.
  - `backend/middleware/limites.js`: límites `admin` y `oauthGmail`.
  - `backend/rutas/auth.rutas.js`: registro con documentos y edad; login de cuentas suspendidas; rutas del representante y
    `aceptar-documentos`.
  - `backend/rutas/paginas-react.rutas.js`: páginas legales públicas y `/admin` solo para el administrador.
  - `backend/rutas/estudio.rutas.js`: al descartar una sugerencia se borra la frase que la motivó.
  - `backend/app.js`, `backend/datos/{index,usuarios,verificacion}.js` y `backend/servicios/cuenta/correo.js`.
  - `backend/validacion/{cuenta,index}.js`.
- **Frontend:**
  - `DialogoAcceso.jsx`: fecha de nacimiento, campos del representante y casilla de aceptación.
  - `RutaPrivada.jsx` y `LayoutPublico.jsx`.
  - `Cabecera.jsx`: enlaces legales en el pie.
  - `router.jsx` y `rutas.js`.
  - `AuthContext.jsx`, `http.js` y `auth.service.js`.
  - `Checkin.jsx` y `bienestar.css`: check-in opcional.
  - `auth.css` y `base.css`: solo la clase nueva `.pie-legal`.
  - `zonas.config.js`: `features/admin` queda en la zona privada.
- **Configuración:** `package.json` (versión 3.13.0 y scripts `admin:*` y `legal:md`), `.env.example` y `README.md`.
- **Pruebas ajustadas a los campos nuevos obligatorios** (no se eliminó ni debilitó ninguna aserción):
  - `tests/utilidades/entorno.js` (`DATOS_LEGALES`), `frontend-react.test.js` y `verificacion-correo.test.js`: los registros
    incluyen la aceptación y la fecha de nacimiento.
  - `VerificacionCorreo.test.jsx`: rellena la fecha y marca la casilla.
  - `prueba-animaciones.js`.
  - `prueba-react.js`: más comprobaciones (casilla, servidor sin aceptación, flujo completo del administrador). La comprobación
    «el check-in es obligatorio (Escape no lo cierra)» se cambió a «se ofrece y se puede omitir», porque el comportamiento
    cambió a propósito (ver «Vulnerabilidades y riesgos»).
  - `tests/utilidades/mongo-memoria.js`: el simulador de MongoDB respeta ahora los índices únicos parciales y dispersos,
    como MongoDB real.

## Administrador único

- **Creación:** solo `scripts/admin.js` (`npm run admin:crear`), sin ninguna ruta HTTP.
  - El correo viene de `ADMIN_EMAIL`. La contraseña se escribe oculta y dos veces, y se guarda solo su hash (scrypt).
  - La contraseña exige al menos 14 caracteres y 3 tipos de carácter, y no puede contener el correo.
  - No hay credenciales por defecto.
- **Un solo administrador:**
  - el script se niega si ya existe uno;
  - el índice único parcial `administrador_unico` hace que MongoDB rechace un segundo documento con `rol: 'admin'`;
  - `rol` es inmutable;
  - el registro y el perfil descartan cualquier `rol` enviado.
- **Integridad:** `npm run admin:verificar` y el resumen del panel.
- **Autorización en el servidor:** el rol se lee de la base de datos en cada petición. Cualquier otra cuenta recibe 404 en
  `/admin` y en `/api/admin/*`. Las peticiones que cambian algo exigen la cabecera Origin y cuerpo JSON. Límite de 120
  peticiones por 15 min.
- **Cuenta separada:** sin agenda, IA ni demás funciones (la API de usuario le responde 403). Sesión de 8 h.
- **No puede actuar sobre sí mismo:** las acciones filtran por `rol: 'usuario'` y su propio id da 404.
- **Paso a paso** de creación, verificación, recuperación y producción: [ADMINISTRADOR.md](ADMINISTRADOR.md).

## Pruebas ejecutadas

| Suite | Resultado |
|---|---|
| `npm test` (servidor, node:test) | 242 / 242 |
| `npm run test:front` (Vitest) | 159 / 159 (25 archivos; 13 pruebas nuevas en `legal.test.jsx`) |
| `npm run build` | correcto |
| `npm run test:e2e` (Chromium real) | 99 / 99 (incluye registro con casilla, rechazo sin aceptación en el servidor y flujo completo del administrador) |
| `npm run test:e2e:animaciones` | 49 / 49 |

**Cubierto, por la API y por el navegador:**
- **Registro y acceso:**
  - registro sin aceptar, o con `"true"`, `1` o versiones antiguas: 400 o 409;
  - registro aceptando, con la evidencia guardada;
  - edad menor de 14, fechas imposibles o futuras;
  - flujo completo del menor: autoriza, no autoriza (se elimina), enlace de un solo uso y espera para reenviar;
  - inicio de sesión, redirección y acceso privado;
  - versión nueva: 428; el perfil y la baja siguen disponibles.
- **Administrador:**
  - acceso del administrador, y de un usuario normal (404), con y sin sesión;
  - manipulación de `rol` en el registro y el perfil;
  - segundo administrador con el script, con otro correo e insertándolo directamente en la base de datos;
  - suspender (cierra sesiones; el login responde 403 `cuenta_suspendida` solo con la contraseña correcta), reactivar y
    suspensión temporal que vence sola;
  - eliminar (exige reescribir el correo; borra todos los datos; la auditoría no guarda el correo);
  - restablecer la contraseña del administrador.
- **Interfaz:** panel en el móvil sin desplazamiento horizontal.

## Vulnerabilidades y riesgos encontrados y corregidos

1. **El check-in pedía datos sensibles de forma obligatoria.** Ánimo y sueño son datos de salud; la Ley 1581 de 2012
   (art. 6) y el Decreto 1377 de 2013 (art. 6, compilado en el Decreto 1074 de 2015) exigen que su entrega sea facultativa. Ahora es opcional. Si prefieres el comportamiento anterior, es un cambio
   pequeño y reversible.
2. **`/auth/google/start` no tenía límite de peticiones:** ahora tiene 10 por hora por IP.
3. **Escalamiento de privilegios:** `rol` inmutable, forzado a `usuario` al crear la cuenta, e índice único parcial.
4. **Admin oculto:** respuestas 404 idénticas para cualquier otra cuenta; los listados nunca incluyen al administrador.
5. **Token del representante:**
   - va en el fragmento `#t=` de la URL, que no llega a los registros del servidor, y se borra de la barra de direcciones;
   - en la base de datos solo se guarda su hash;
   - caduca a los 7 días y es de un solo uso.
6. **Búsqueda del panel:** el texto se escapa como literal (no admite expresiones regulares del usuario) y se mantiene
   `sanitizeFilter`.
7. **Frase guardada con una sugerencia de estudio:** se borra al descartar la sugerencia (minimización de datos).

**Riesgo residual conocido:** el código JavaScript del panel está en la zona privada, así que cualquier persona con sesión puede
descargarlo (y en GitHub Pages todo es público). No contiene datos ni secretos; la protección real está en la API (404).

## Corrección posterior: «Guardando…» que no terminaba

Con una cuenta creada **antes** de la v3.13, la pantalla «Actualizamos nuestros documentos» se quedaba en «Guardando…».
Causa: el servidor guardaba la aceptación solo en cuentas con `rol: 'usuario'`, pero esas cuentas no tienen el campo `rol`
guardado en MongoDB (Mongoose lo rellena solo al leer). No se guardaba nada, el servidor respondía «ok» igualmente y la pantalla
esperaba para siempre. Lo mismo hacía que esas cuentas no aparecieran en el panel de administración.
- Los filtros usan ahora «rol distinto de admin» (`backend/datos/administracion.js`, `backend/datos/legal.js`).
- `POST /api/auth/aceptar-documentos` ya no responde «ok» si no se guardó nada.
- La pantalla deja de esperar y muestra un mensaje si el servidor sigue pidiendo la aceptación.
- Prueba de regresión con una cuenta sin `rol` (falla con el código anterior, pasa con el nuevo), prueba del navegador, y
  comprobación manual en Chromium: cuenta antigua → aceptar → entra a Mi panel.

## Puntos para revisión de un abogado colombiano

1. Completar **todos** los `[PENDIENTE: …]`: responsable, identificación, domicilio, correo, teléfono, fecha de vigencia,
   gratuidad, titularidad de la marca, ciudad o jurisdicción, plazo de los mensajes de contacto, respaldos de Atlas y área de PQR.
2. **Menores de 14 a 17 años:** si basta la autorización por correo del representante (no se verifica su identidad ni el
   parentesco); la opinión del menor (art. 12 del Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015).
3. **Datos sensibles** (ánimo y sueño): si la autorización explícita, tal como está redactada, es suficiente.
4. **Transferencias internacionales:**
   - región del clúster de MongoDB Atlas;
   - si Railway, Google y Tailscale son encargados o prestadores de infraestructura y si hacen falta contratos de transmisión;
   - la vigencia de la Circular 005 de 2017 para EE. UU.
5. **Registro Nacional de Bases de Datos (RNBD):** probablemente no aplica a personas naturales o empresas pequeñas, pero hay
   que confirmarlo según los activos.
6. **Ley 1480 de 2011 (consumidor):** si aplica a un servicio gratuito, y las cláusulas de limitación de responsabilidad.
7. **Plazos de conservación** y la descripción del asistente (Ollama en un equipo del Responsable, a través de Tailscale).
8. **Suspensión y eliminación por el administrador:** el procedimiento, el aviso a la persona y su derecho de defensa.

## Antes de publicar

- En Railway, definir `URL_PUBLICA_APP`, que se usa en el enlace del correo al representante.
- Crear el administrador con el script (ver ADMINISTRADOR.md).
- Completar los `[PENDIENTE]` en `compartido/legal.js` y ejecutar `npm run legal:md`.
- No se hizo ningún despliegue ni cambio en producción.
