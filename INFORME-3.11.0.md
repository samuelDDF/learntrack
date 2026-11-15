# LearnTrack 3.11.0 · Reestructuración del frontend como SPA de React

Partiendo de **LearnTrack 3.10.0**, el frontend pasa a ser una **aplicación de una sola página (SPA)** con una arquitectura
basada en componentes y organizada por funcionalidad. Se mantienen el sistema de autenticación, la verificación del correo, la
seguridad del servidor (CSP, CSRF, sesión, autorización y validación) y la identidad visual de LearnTrack.

Decisiones tomadas contigo antes de empezar:

| Pregunta | Respuesta | Resultado |
|---|---|---|
| Nombres de las rutas privadas | Mantener los actuales | `/panel`, `/calendario`, `/proyectos`, `/repaso` y `/configuracion` no cambian (marcadores y PWA siguen valiendo) |
| Acceso | Ventana con su propia URL | `/login`, `/registro` y `/verificar-correo` son rutas reales que muestran la misma ventana encima de la página |
| Páginas que el ejemplo pedía y no existían | Convertir partes existentes en rutas | `/papelera`, `/perfil` y `/bienestar` se construyen con piezas que ya existían; **no** se creó recuperación de contraseña (no existe en el backend) |

---

## 1. Qué cambió (resumen)

**Antes (3.10):**
- React tenía dos «zonas» y pasar de una a otra **recargaba el documento** (`window.location`). Le pasaba a «Mi panel», al iniciar sesión, al verificar el correo, al cerrar sesión y al pulsar el logo desde la zona privada.
- El motivo de esas recargas era que los estilos de los temas privados redefinían variables en `:root` y se habrían quedado aplicados en la parte pública.
- El acceso se abría con `/?acceso=login`.

**Ahora (3.11):**
- **Arquitectura.** Hay un solo `createRoot`, un solo `BrowserRouter` y un **enrutador central** (`src/app/router.jsx`) con `Routes`, `Route`, `Outlet` y `Navigate`. La navegación usa `Link` y `NavLink`.
- **Sin recargas.** Ninguna navegación interna recarga el documento: entrar, verificar el correo, salir, cambiar de cuenta, ir de la portada al panel y volver. Lo comprueba el navegador real con una marca en `window`.
- **Estilos aislados.** Los estilos privados solo actúan bajo `html.zona-privada`, una clase que pone el diseño privado mientras está montado. La parte pública conserva su aspecto aunque esos estilos ya estén cargados, y una prueba con mutación demuestra que el control detecta la fuga si se deshace este cambio.
- **Estado global.** Lo gestionan tres **contextos**:
  - `AuthContext`: sesión y acciones de acceso.
  - `TemaContext`: apariencia de la cuenta y zona visual.
  - `NotificacionesContext`: avisos flotantes.
- **Guardias.** `RutaPrivada` y `RutaPublica` deciden qué pintar, y hay una página **404** propia.
- **Organización.** El código se divide en `features/`, `components/`, `hooks/`, `contexts/`, `services/`, `styles/` y `utils/`.
- **Peticiones HTTP.** Solo las hace `services/http.js`, a través de un servicio por funcionalidad. Los errores se tratan en un único sitio (`services/errores.js`).
- **Sesión caducada.** Antes se recargaba la página. Ahora `http.js` emite un evento, `AuthContext` olvida el usuario y `RutaPrivada` lleva a `/login`, recordando la página pedida.

---

## 2. Estructura nueva de `frontend-react/src`

```
frontend-react/
├── zonas.config.js               carpetas cuyo código es PRIVADO (r/privado, solo con sesión). La usan Vite y las pruebas
├── vite.config.js
└── src/
    ├── main.jsx                  punto de entrada: un solo createRoot y un solo BrowserRouter
    ├── app/
    │   ├── App.jsx               Proveedores + Suspense + Enrutador
    │   ├── providers.jsx         LimiteErrores › ProveedorAuth › ProveedorTema › ProveedorAvisos
    │   ├── router.jsx            ENRUTADOR CENTRAL (todas las rutas, carga diferida de las privadas)
    │   ├── rutas.js              mapa de rutas: títulos, clases, menús y destino seguro tras entrar
    │   ├── ActualizacionPWA.jsx · pwa.js
    │   └── router.test.jsx
    ├── components/
    │   ├── common/               BotonConfirmar · Cargando · Contador · Dialogo · Esqueleto · LimiteErrores · Mensaje
    │   ├── layout/               Cabecera (y Pie) · LayoutPublico
    │   │   └── privado/          LayoutPrivado · BarraCuenta · Avatar · MenuConfiguracion · PaginaConPestanas ·
    │   │                         seccionesCuenta.js · barra-navegacion.css
    │   └── navigation/           RutaPrivada · RutaPublica · GestorNavegacion
    ├── contexts/                 AuthContext · TemaContext · NotificacionesContext (+ notificaciones.css)
    ├── hooks/                    useAuth · useTema · useAvisos · useAnimaciones
    ├── services/                 http.js · errores.js · sesion.js · tema.js
    ├── styles/                   base.css · app.css · animaciones.css
    │   └── privado/              temas.css · privado.css · animaciones-privado.css
    ├── utils/                    fechas.js · animaciones.js · eventos.js
    ├── pruebas/                  preparar.js · utilidades.jsx (pintar la app con el enrutador en memoria)
    └── features/
        ├── landing/      pages (Inicio, InfoPlanificador, InfoAsistente, NoEncontrada) · components (ContactoFlotante) · services
        ├── auth/         components (DialogoAcceso, VerificacionCorreo, CapaAcceso, BotonAcceso) · hooks (useAcceso) · services
        ├── dashboard/    pages (Panel) · components (FilaActividad)
        ├── calendar/     pages (Agenda) · components (vistas, ImportadorFestivos) · services (festivos)
        ├── activities/   components (FormularioActividad) · hooks (useActividades, useEliminarActividad) · services
        ├── projects/     pages (Proyectos) · services
        ├── review/       pages (Repaso) · services
        ├── wellness/     pages (Bienestar) · components (Checkin, CargaMental, ConsejoIA, Historial) ·
        │                 hooks (useCheckin, useBienestarDelDia) · services
        ├── trash/        pages (Papelera) · components (BarraPapelera, ElementoPapelera, ConfirmacionPapelera) ·
        │                 hooks (usePapelera) · services
        ├── profile/      pages (Perfil) · components (SeccionInformacion, SeccionPrivacidad) · hooks (usePerfil) · services
        ├── settings/     pages (Configuracion) · components (secciones: Voz, Estética, Cuentas, Notificaciones) · utils
        └── ai-assistant/ components (ChatIA) · utils (dictado, voz) · services
```

No hay carpetas vacías ni archivos sin usar: una comprobación automática confirmó que cada archivo se importa desde otro. Tampoco
quedan dos versiones de la misma página. En total hay 125 archivos en `src/`.

### Responsabilidad de cada carpeta

| Carpeta | Responsabilidad | Qué NO hace |
|---|---|---|
| `app/` | Montar la aplicación: proveedores, enrutador central y mapa de rutas | Lógica de negocio |
| `components/common/` | Piezas de interfaz reutilizables y genéricas (diálogo accesible, carga, esqueleto, confirmación en dos clics…) | Llamar a la API |
| `components/layout/` | Estructura de cada zona: cabecera, pie y `Outlet` | Decidir quién entra (eso lo hacen los guardias) |
| `components/navigation/` | Guardias de rutas y lo que el navegador ya no hace solo en una SPA: título, desplazamiento y foco | Pintar contenido |
| `contexts/` | Estado global compartido: sesión, apariencia y avisos | Peticiones fuera de su servicio |
| `hooks/` | Acceso a los contextos (`useAuth`, `useTema`, `useAvisos`) y animaciones reutilizables | — |
| `services/` | Comunicación con Express (`http.js`), errores comunes, almacén del usuario y puente con `tema-inicial.js` | Pintar interfaz |
| `styles/` | Estilos globales; `styles/privado/` para temas y base de la zona privada (solo bajo `.zona-privada`) | Estilos de una sola funcionalidad |
| `utils/` | Funciones puras (fechas locales, animaciones, eventos) | Estado de React |
| `features/<x>/` | Todo lo de una funcionalidad: `pages`, `components`, `hooks`, `services` y su CSS | Importar otra funcionalidad salvo piezas concretas (p. ej. el Panel usa las tarjetas de `wellness`) |
| `pruebas/` | Preparación de Vitest y utilidades para pintar la app completa en memoria | — |

**Zona pública y zona privada.** Las carpetas privadas están listadas en `zonas.config.js`:
- `dashboard`, `calendar`, `activities`, `trash`, `projects`, `review`, `ai-assistant`, `wellness`, `profile` y `settings`;
- `components/layout/privado` y `styles/privado`.

Vite compila esas carpetas en `dist/r/privado/`, y Express solo entrega esos archivos con sesión (401 sin ella).
Una prueba de integración comprueba que ningún módulo público importe código privado. La única excepción son las
cargas diferidas `lazy(() => import(...))` del enrutador central.

---

## 3. Rutas

| Ruta | Acceso | Diseño | Página / componente |
|---|---|---|---|
| `/` | público | LayoutPublico | `landing/pages/Inicio` |
| `/planificador` | público | LayoutPublico | `landing/pages/InfoPlanificador` (diferida) |
| `/asistente` | público | LayoutPublico | `landing/pages/InfoAsistente` (diferida) |
| `/login` | solo sin sesión (`RutaPublica`) | ventana encima de la página de fondo | `auth/components/DialogoAcceso` (pestaña «Iniciar sesión») |
| `/registro` | solo sin sesión | ventana | `DialogoAcceso` (pestaña «Crear cuenta») |
| `/verificar-correo` | solo sin sesión | ventana | `DialogoAcceso` → `VerificacionCorreo` |
| `/panel` | privado (`RutaPrivada`) | LayoutPrivado | `dashboard/pages/Panel` |
| `/calendario` | privado | LayoutPrivado | `calendar/pages/Agenda` |
| `/proyectos` | privado | LayoutPrivado | `projects/pages/Proyectos` |
| `/repaso` | privado | LayoutPrivado | `review/pages/Repaso` |
| `/bienestar` | privado | LayoutPrivado | `wellness/pages/Bienestar` **(nueva, con piezas existentes)** |
| `/papelera` | privado | LayoutPrivado | `trash/pages/Papelera` **(antes ventana)** |
| `/perfil` | privado | LayoutPrivado | `profile/pages/Perfil` **(antes dos pestañas de Configuración)** |
| `/configuracion` | privado | LayoutPrivado | `settings/pages/Configuracion` |
| `*` | público | LayoutPublico | `landing/pages/NoEncontrada` (el servidor responde 404) |

**Ventana de acceso con su propia URL.**
- Al pulsar «Iniciar sesión / Registro», la app va a `/login` y la página desde la que se abrió («fondo») sigue visible debajo. Es el patrón de *modal route* de React Router: el fondo viaja en el estado del historial.
- Cambiar de pestaña reemplaza la entrada del historial, así que «Atrás» o «Cerrar» vuelven a la página de fondo sin recargar.
- Si se entra directamente a `/login` (por ejemplo, porque el servidor redirige desde una página privada), el fondo es la portada.

**Después de entrar:**
- Se va a la página privada que se quería ver. `RutaPrivada` la guarda en el estado del historial, no en la URL.
- Solo se acepta una ruta privada **conocida** (`destinoTrasEntrar`); cualquier otra cosa lleva a `/panel`. Así se evita una redirección abierta, y hay una prueba que lo comprueba.

**Compatibilidad.** Los enlaces de versiones anteriores siguen funcionando:

| Enlace antiguo | Lleva a |
|---|---|
| `/?acceso=login`, `/?acceso=registro`, `/?acceso=verificar` | la ruta nueva |
| `/configuracion#informacion`, `/configuracion#privacidad` | `/perfil#…` |
| `/configuracion#perfil`, `#apariencia`, `#general` | su pestaña nueva |
| `/perfil.html` | `/perfil` |

**Servidor** (`backend/rutas/paginas-react.rutas.js`):
- Las listas de páginas públicas y privadas coinciden con `app/rutas.js`, y una prueba lo comprueba.
- Una página privada sin sesión responde **302 a `/login`**, o a **`/verificar-correo`** si el navegador tiene una verificación a medias. Antes eran `/?acceso=…`.

---

## 4. Componentes reutilizables

| Componente | Dónde se usa |
|---|---|
| `Dialogo` | Acceso, check-in, formulario de actividad, confirmaciones de la papelera, baja de cuenta, panel lateral del perfil |
| `Cargando`, `Esqueleto`, `Contador`, `Mensaje`, `BotonConfirmar`, `LimiteErrores` | Todas las pantallas |
| `Cabecera` / `Pie` | Los dos diseños (menú hamburguesa accesible, `NavLink` con `aria-current`) |
| `LayoutPublico`, `LayoutPrivado` | Estructura de cada zona con `<Outlet />` y `Suspense` |
| `PaginaConPestanas` (nuevo) | Mi perfil y Configuración: resumen de la cuenta + pestañas ARIA con teclado; redirige anclas antiguas |
| `RutaPrivada`, `RutaPublica` (nuevos) | Guardias del enrutador |
| `GestorNavegacion` (nuevo) | Título del documento, `noindex` en la 404, desplazamiento arriba o al ancla y foco en `<main>` al cambiar de página |
| `CargaMental`, `ConsejoIA`, `Historial`, `DialogoCheckin` (extraídos de Panel) | Mi panel y Bienestar (mismas piezas, misma regla de carga) |
| `BarraPapelera`, `ElementoPapelera`, `ConfirmacionPapelera` (extraídos de la Papelera) | Página de la papelera |
| `SeccionInformacion`, `SeccionPrivacidad` (movidos desde Configuración) | Mi perfil |
| `FilaActividad` (extraída de Panel) | «Tu día de hoy» del panel |
| `BotonAcceso`, `CapaAcceso` | Botones «Iniciar sesión» de las páginas públicas y la capa que pinta la ventana de acceso |

---

## 5. Hooks y contextos

| Pieza | Qué ofrece |
|---|---|
| **`AuthContext`** / `useAuth()` | `usuario`, `cargando`, `autenticado`, `iniciarSesion`, `registrar`, `verificarCorreo`, `reenviarCodigo`, `estadoVerificacion`, `cerrarSesion({ destino })`, `olvidarSesion`, `refrescar`, `actualizarUsuario`. Una sola petición `/api/auth/me` por carga (reutiliza la de `tema-inicial.js`). Escucha el evento de sesión caducada |
| **`TemaContext`** / `useTema()` | `aplicar(apariencia)` y `usarZonaPrivada(clase)`. Aplica el tema de la cuenta al entrar y lo olvida al salir (la siguiente persona no hereda los colores) |
| **`NotificacionesContext`** / `useAvisos()` | Avisos flotantes accesibles con acción opcional («Deshacer»). Ahora es global: sirve en las dos zonas |
| `useAcceso()` | Abrir la ventana de acceso encima de la página, cambiar de paso y cerrarla |
| `useActividades()`, `useEliminarActividad()` | Lista normalizada de actividades y borrado lógico con «Deshacer» |
| `useCheckin()` | Check-in del día (servidor primero; copia local por cuenta y día) y ventana obligatoria si falta |
| `useBienestarDelDia()` | Carga mental, historial y consejo de la IA (regla común `compartido/carga.js`) |
| `usePapelera()` | Estado y operaciones de la papelera (selección, restaurar, eliminar, vaciar, sin peticiones dobles) |
| `usePerfil()` | Datos de la cuenta para Mi perfil y Configuración; tras guardar actualiza cabecera y apariencia sin recargar |
| `useRevelar`, `useAnimarCambio`, `useDestello` | Animaciones de la 3.8 (sin cambios) |

---

## 6. Cómo se comunica React con Express

```
Componente ──► hook / contexto ──► features/<x>/services/<x>.service.js ──► services/http.js ──► Express (/api/…)
                                                                                     │
                                         ErrorConexion / mensajeDeError ◄────────────┘ (services/errores.js)
```

1. **Un único cliente HTTP** (`services/http.js`), con estas reglas:
   - Solo admite rutas propias `/api/…` (nunca otro origen).
   - Usa `credentials: 'same-origin'`: la cookie de sesión es HttpOnly y JavaScript no la ve.
   - Envía la cabecera `X-Zona-Horaria`.
   - Tiene un tiempo máximo por petición.
   - Devuelve siempre `{ ok, status, data }`.
2. **Un servicio por funcionalidad:** `auth`, `actividades`, `papelera`, `bienestar`, `festivos`, `perfil`, `proyectos`, `repaso`, `asistente` y `contacto`. Ningún componente llama a `fetch`.
3. **Errores centralizados** en `services/errores.js`: `ErrorConexion` (sin red, tiempo agotado o sesión terminada) y `mensajeDeError()` (convierte la respuesta del servidor en un texto legible).
4. **Sesión caducada:**
   - Un 401 en una petición privada lanza el evento `learntrack:sesion-caducada`.
   - `AuthContext` pone el usuario a `null`.
   - `RutaPrivada` lleva a `/login` **sin recargar**.
   - Las peticiones del acceso (`login`, `registro`…) no lo disparan: su 401/403 es una respuesta normal del formulario.
5. **La seguridad sigue en el servidor.** Los guardias de React solo deciden qué pintar. La protección real no cambió:
   - **Páginas privadas:** `requiereSesionPagina`.
   - **Código privado:** `/r/privado` con `requiereSesionRecurso`.
   - **API:** `requiereAuthApi` en cada petición.
   - **Además:** CSP estricta sin `unsafe-inline`, comprobación de `Origin` (CSRF) y la validación de toda entrada.
   - La validación de los formularios en React es solo una ayuda: el servidor vuelve a validar.

---

## 7. Archivos

Rutas relativas a `frontend-react/src/` salvo que se indique.

### Creados
- **Aplicación:**
  - `app/router.jsx` (enrutador central)
  - `app/providers.jsx`
  - `app/router.test.jsx`
  - `../zonas.config.js`
- **Navegación:** `components/navigation/RutaPrivada.jsx`, `RutaPublica.jsx`, `GestorNavegacion.jsx`.
- **Contextos y hooks:**
  - `contexts/AuthContext.jsx`, `contexts/TemaContext.jsx`, `contexts/notificaciones.css`
  - `hooks/useAuth.js`, `hooks/useTema.js`, `hooks/useAvisos.js`
- **Servicios:**
  - `services/errores.js`
  - Un archivo `*.service.js` por funcionalidad, a partir de los antiguos `api/publico.js` y `privado/api.js`: `auth`, `contacto`, `actividades`, `asistente`, `bienestar`, `festivos`, `papelera`, `perfil`, `proyectos` y `repaso`.
- **Acceso:**
  - `features/auth/components/CapaAcceso.jsx`
  - `features/auth/components/BotonAcceso.jsx`
  - `features/auth/hooks/useAcceso.js`
- **Bienestar:**
  - `features/wellness/pages/Bienestar.jsx`
  - `features/wellness/components/` (`Checkin`, `CargaMental`, `ConsejoIA`, `Historial`)
  - `features/wellness/hooks/` (`useCheckin`, `useBienestarDelDia`)
  - `features/wellness/bienestar.css` (estilos movidos desde `panel.css` + diseño de la página)
- **Papelera:**
  - `features/trash/hooks/usePapelera.js`
  - `features/trash/components/` (`BarraPapelera`, `ElementoPapelera`, `ConfirmacionPapelera`)
- **Mi perfil:**
  - `features/profile/pages/Perfil.jsx`
  - `features/profile/hooks/usePerfil.js`
  - `features/profile/components/SeccionInformacion.jsx`, `SeccionPrivacidad.jsx`
- **Diseño y panel:**
  - `components/layout/privado/PaginaConPestanas.jsx`
  - `components/layout/privado/seccionesCuenta.js`
  - `features/dashboard/components/FilaActividad.jsx`
- **Documentación:** `INFORME-3.11.0.md`.

### Movidos y reorganizados
Cambia la ubicación; el contenido no cambia o solo cambian las rutas de importación.

| Antes (3.10) | Ahora |
|---|---|
| `comun/ui/*` | `components/common/*` |
| `comun/Cabecera.jsx` | `components/layout/Cabecera.jsx` |
| `comun/animaciones/hooks.js`, `revelar.js` | `hooks/useAnimaciones.js`, `utils/animaciones.js` |
| `comun/fechas-locales.js`, `privado/eventos.js` | `utils/fechas.js`, `utils/eventos.js` |
| `comun/tema.js` | `services/tema.js` |
| `comun/pwa.js`, `comun/ActualizacionPWA.jsx` | `app/` |
| `estilos/*`, `privado/estilos/*` | `styles/*`, `styles/privado/*` |
| `publico/paginas/*`, `publico/ContactoFlotante.jsx`, `publico/estilos/inicio.css`, `paginas-info.css` | `features/landing/…` |
| `publico/acceso.jsx`, `publico/VerificacionCorreo.jsx`, `publico/estilos/acceso.css` | `features/auth/…` (`DialogoAcceso.jsx`, `auth.css`) |
| `privado/paginas/<pantalla>/…` | `features/{dashboard,calendar,projects,review,settings}/…` |
| `privado/actividades/*` | `features/activities/…` y `features/trash/…` |
| `privado/asistente/*` | `features/ai-assistant/{components,utils}/…` |
| `privado/barra/*` | `components/layout/privado/*` (el importador de festivos, en `features/calendar/components/`) |
| `api/cliente.js` (+ prueba) | `services/http.js` (+ prueba) |
| `comun/ui/Avisos.jsx` | `contexts/NotificacionesContext.jsx` |

### Modificados (contenido)

**Frontend:**
- `main.jsx`: rutas de importación.
- `app/App.jsx`: ahora solo proveedores y enrutador.
- `app/rutas.js`: mapa completo de rutas, títulos, menús y destino seguro.
- `LayoutPublico.jsx` y `LayoutPrivado.jsx`: reescritos con `Outlet`, sin `window.location`. `LayoutPrivado` marca la zona privada antes de pintar.
- `Cabecera.jsx`: el logo es siempre un `Link`.
- `BarraCuenta.jsx`: sale con `useAuth` sin recargar; «Editar mi perfil» va a `/perfil`.
- `MenuConfiguracion.jsx`: enlaces a `/perfil#…` y `/configuracion#…`.
- `DialogoAcceso.jsx` y `VerificacionCorreo.jsx`: usan `useAuth`; al entrar, el guardia lleva al panel sin recargar.
- `Panel.jsx`: usa las piezas de `wellness`; «🗑 Papelera» es un enlace.
- `Agenda.jsx`: «🗑 Papelera» es un enlace.
- `Papelera.jsx`: es una página.
- `Configuracion.jsx`: 4 pestañas con `PaginaConPestanas`.
- `settings/components/secciones.jsx`: sin Información ni Privacidad; usa `useAuth` y `useTema`.
- `ChatIA.jsx`: usa `useAuth`.
- `services/http.js`: emite el evento de sesión caducada en vez de recargar.
- `services/sesion.js`: almacén del usuario sin recargas.
- `InfoPlanificador`, `InfoAsistente`, `Inicio`: el botón de acceso viene de su propio archivo.

**Estilos:**
- `styles/privado/temas.css`: todo bajo `:root.zona-privada`.
- `barra-navegacion.css`: `.header-grupo-izquierdo` limitado a la zona privada.
- `paginas-info.css`: `.nota` limitado a `.info-section`.
- `privado.css`:
  - avisos movidos a `contexts/notificaciones.css`;
  - `.btn-icono` movido aquí desde `panel.css`;
  - `a.boton` sin subrayado;
  - eliminado el CSS del contacto flotante, que estaba duplicado y nunca se usaba.
- `panel.css`: sin las tarjetas de bienestar, que pasaron a `bienestar.css`.
- `papelera.css`: diseño de página.
- `styles/app.css`: `main#contenido:focus` sin anillo (recibe el foco al navegar).

**Configuración:** `vite.config.js` lee las carpetas privadas de `zonas.config.js`.

**Backend:**
- `rutas/paginas-react.rutas.js`: listas de páginas nuevas.
- `middleware/autenticacion.js`: redirige a `/login` o `/verificar-correo`.
- `rutas/direcciones-antiguas.js`: `/perfil` ya no es un alias porque vuelve a ser una página; `/perfil.html` lleva a `/perfil`.

**Pruebas:**
- `src/pruebas/utilidades.jsx`: `pintar` con los proveedores reales y `pintarApp` con el enrutador en memoria.
- `src/pruebas/preparar.js`: reinicia la sesión entre pruebas.
- Pruebas de `LayoutPublico`, `LayoutPrivado`, `VerificacionCorreo`, `Papelera`, `ChatIA` y `http`.
- `tests/integracion/frontend-react.test.js`, `seguridad.test.js`, `perfil.test.js`, `verificacion-correo.test.js`, `tests/unitarias/carga.test.js`.
- `tests/navegador/prueba-react.js` y `prueba-animaciones.js`.

**Documentación y versión:** `README.md`, `package.json` y `package-lock.json` (3.11.0).

> Las pruebas que se cambiaron codificaban **comportamiento que el encargo pedía cambiar**:
> - antes: `/?acceso=login`; ahora: `/login`;
> - antes: el alias `/perfil` → `/configuracion`; ahora: `/perfil` es una página;
> - antes: la papelera era una ventana; ahora es una página;
> - antes: `navegador.irA` recargaba; ahora se navega sin recargar.
>
> No se relajó ninguna comprobación de seguridad. Varias son ahora **más estrictas**:
> - todas las pantallas privadas deben estar en `r/privado`;
> - ningún módulo público puede importar código privado de forma estática;
> - el destino tras entrar solo puede ser una página privada conocida;
> - una verificación a medias redirige a `/verificar-correo`.

### Eliminados (con justificación)

| Archivo (3.10) | Motivo |
|---|---|
| `src/App.jsx` | Sustituido por `app/App.jsx` + `app/router.jsx` (enrutador central) |
| `src/rutas.js` | Sustituido por `app/rutas.js` (con títulos, menús y destino seguro) |
| `publico/ZonaPublica.jsx` (+ prueba) | Sustituido por `components/layout/LayoutPublico.jsx` con `Outlet` (+ prueba nueva) |
| `privado/ZonaPrivada.jsx` (+ prueba) | Sustituido por `components/layout/privado/LayoutPrivado.jsx` + `RutaPrivada` (+ prueba nueva) |
| `comun/useUsuario.js` | Duplicaba el estado de la sesión: ahora es `AuthContext` / `useAuth` |
| `comun/sesion.js` | Reescrito como `services/sesion.js` (sin `cerrarSesion` con recarga) |
| `privado/api.js`, `api/publico.js` | Repartidos en un servicio por funcionalidad (`features/*/services/*.service.js`) |
| `privado/actividades/Papelera.jsx` | La papelera ya no es una ventana: `features/trash/pages/Papelera.jsx` + componentes + `usePapelera` |
| `privado/paginas/panel/Panel.jsx`, `configuracion/Configuracion.jsx` | Reescritos en `features/dashboard/pages/Panel.jsx` y `features/settings/pages/Configuracion.jsx` (con piezas extraídas) |
| `navegador.irA`, `RUTA_ACCESO` (dentro de `http.js`) | Provocaban recargas completas; ya no hacen falta |
| CSS del contacto flotante en `privado.css` | Duplicado y muerto: el contacto solo existe en la parte pública (`styles/base.css`) |

No se borró ningún archivo de configuración, ninguna base de datos de ejemplo, ningún `.env.example` y ningún archivo del backend.

---

## 8. Funcionalidades: nada nuevo inventado, nada perdido

- **`/bienestar`** junta piezas que ya existían en el lateral de Mi panel: el check-in del día (con su ventana obligatoria si falta), la carga mental con la explicación del cálculo, el consejo de la IA y el historial reciente. La regla de cálculo es la misma porque el hook es el mismo. La única pieza de interfaz añadida es el **resumen de las respuestas del check-in**, que muestra datos que ya se guardaban.
- **`/papelera`** tiene las mismas funciones de la 3.9 (selección, restaurar, eliminar para siempre, vaciar, confirmaciones y sin peticiones dobles). Como ahora es una página, «Cerrar» pasa a ser «← Volver a mi panel / mi agenda».
- **`/perfil`** reúne las dos pestañas de la persona (Información básica y Privacidad y seguridad). **`/configuracion`** conserva Voz, Estética, Cuentas vinculadas y Notificaciones. El menú del engranaje sigue mostrando las seis secciones y cada una lleva a su página.
- **Menú principal privado:** se añadió «Bienestar» para que la página nueva sea alcanzable. La papelera se abre desde sus botones de siempre y Mi perfil desde el avatar y el engranaje.
- **Sin cambios:** autenticación, verificación del correo (6 dígitos, cuenta atrás, reenvío y bloqueo de doble envío), chat, dictado, voz, agenda, festivos, proyectos, repaso, temas, paleta, fondo, foto, cuentas vinculadas, notificaciones, contraseña, baja de cuenta, PWA y animaciones.
- **Login de las cuentas existentes:** no se tocó nada del servidor de autenticación ni de la base de datos. La prueba de navegador crea una cuenta, la verifica, cambia la contraseña, sale y **vuelve a entrar con esa cuenta ya existente** (sin recargar).

---

## 9. Seguridad

- **CSP:**
  - Sigue sin `unsafe-inline` ni `unsafe-eval`, y no hay `innerHTML` ni estilos en línea.
  - Los colores se ponen con CSSOM. `GestorNavegacion` solo añade `tabindex="-1"` a `<main>` con `setAttribute`.
  - La prueba de navegador recorre todo sin ninguna violación.
- **Sin secretos en el frontend:** la compilación se revisa en busca de direcciones internas, `MONGO_URI`, `SESSION_SECRET`, `passwordHash` y mapas de código fuente.
- **El destino tras iniciar sesión se valida con una lista blanca**: no hay redirección abierta.
- **Código privado:**
  - Solo se descarga tras pasar `RutaPrivada` y, en el servidor, solo con sesión.
  - Al cerrar sesión, `/r/privado` vuelve a responder 401 (comprobado en el navegador).
- **Nota honesta sobre los nombres de los archivos:** el JavaScript público contiene ahora los **nombres** de los archivos privados (`Panel-xxxx.js`, …), porque el enrutador central los carga de forma diferida. Son solo nombres: el **contenido** sigue protegido por el servidor (401 sin sesión). Lo mismo ocurría ya con `ZonaPrivada-xxxx.js` en la 3.10.

---

## 10. Resultados reales

Todo se ejecutó en este entorno el 14/11/2026, primero sobre la carpeta de trabajo y después **sobre una copia limpia descomprimida del
ZIP entregado** (`npm ci` → `npm run build` → pruebas). Ninguna prueba se dio por buena sin ejecutarla.

| Orden | Resultado |
|---|---|
| `npm run build` | ✔ compilación correcta (Vite 6.4.5, PWA con 27 entradas precacheadas, ninguna de `r/privado`) |
| `npm run test:front` (Vitest) | ✔ **76 / 76** pruebas, 12 archivos (antes 62) |
| `npm test` (unitarias + integración) | ✔ **201 / 201** |
| `npm run test:e2e` (Chromium real) | ✔ **78 / 78** comprobaciones |
| `npm run test:e2e:animaciones` (escritorio, móvil 390 px, «reducir movimiento») | ✔ **49 / 49** comprobaciones |

**Pruebas nuevas destacadas:**
- **Vitest:**
  - Cada guardia redirige bien (sin sesión → `/login` recordando la página; con sesión `/login` → `/panel`).
  - Tras entrar se vuelve a la página pedida.
  - Una sesión caducada lleva a `/login` sin recargar.
  - Al salir de la zona privada desaparece `zona-privada`.
  - La ventana de acceso tiene su URL, se abre encima de la página y al cerrarse vuelve a ella.
  - Funcionan las direcciones antiguas.
  - `/perfil` y `/configuracion` tienen sus pestañas.
  - En `/bienestar`, el check-in es obligatorio y se ve el resumen.
  - Se navega del panel a la papelera y de vuelta.
- **Navegador real:**
  - Una marca en `window` comprueba que **no hay recarga** al abrir y cerrar el acceso, verificar el correo, ir a la papelera y volver, ir a Bienestar, al engranaje → Mi perfil, del logo a la portada y de vuelta, y al cerrar sesión.
  - La portada tiene **exactamente el mismo aspecto** (colores calculados) entrando directamente o navegando desde la zona privada con un tema personalizado.
- **Comprobación de que esa prueba sirve:** volví a poner `temas.css` sin `.zona-privada`. La prueba **falló** (fondo `rgb(244,246,249)` frente a `rgb(251,251,249)`; 76 de 77 comprobaciones en esa ejecución) y, al restaurar el archivo, volvió a pasar.

**Avisos de las herramientas que no son errores:**
- `npm ci` y `npm audit` informan de 10 vulnerabilidades conocidas (2 bajas y 8 moderadas) en dependencias de desarrollo y de pruebas (p. ej. `glob`, `minimatch` y `@vitest/mocker`). Son exactamente las mismas que en la 3.10 (comprobado en las dos carpetas), porque esta versión no añade ni actualiza dependencias. No se ejecutó `npm audit fix --force`.
- La prueba de navegador usa Playwright desde `PLAYWRIGHT_CORE_PATH`, porque no forma parte de `npm test`.

---

## 11. Ejecutar en local

```bash
# Node.js 20.19 o superior
npm install                 # o npm ci
cp .env.example .env        # Windows: copy .env.example .env
#  edita .env: MONGO_URI, SESSION_SECRET y el servidor de correo (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM)
#  Gmail: puerto 587 con SMTP_SECURE=false (o 465 con SMTP_SECURE=true) y una contraseña de aplicación SIN espacios
npm run build               # compila el frontend React en frontend-react/dist
npm start                   # http://localhost:3000
```

**Desarrollo con recarga en caliente:** `npm run dev` y abre http://localhost:5173. Vite redirige `/api` a Express.

**Pruebas:**

```bash
npm run test:front          # 76 pruebas del frontend (Vitest)
npm test                    # 201 pruebas de backend e integración (necesita la compilación)
npm run test:todo           # compila y ejecuta las dos anteriores
npm run test:e2e            # navegador real (requiere playwright-core y Chromium)
npm run test:e2e:animaciones
```

**Empaquetar:** `npm run zip`. El paquete no incluye `node_modules`, `.env`, `frontend-react/dist`, capturas ni correos de desarrollo.
