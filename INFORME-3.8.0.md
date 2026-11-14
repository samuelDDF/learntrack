# LearnTrack 3.8.0 — Animaciones modernas y dinámicas

Base: `LearnTrack-3.7.0-React-exclusivo`. Se mejoró la interfaz existente sin reconstruirla. Se conservan:

- la arquitectura y las carpetas;
- las rutas de React Router y los endpoints;
- la autenticación;
- MongoDB y Nexo/Ollama;
- la PWA y la seguridad (CSP sin `unsafe-inline`).

Tampoco cambia la identidad visual: mismos colores, tipografía y componentes.

## 1. Decisión técnica: sin bibliotecas nuevas

Todo se hizo con CSS moderno (`@keyframes`, `transition`, `translate`/`scale`, `@property`, `@starting-style`), con `IntersectionObserver` y con la Web Animations API nativa del navegador.

No se añadió Framer Motion. Nada de lo pedido lo necesitaba y habría sumado unos 30–50 kB (gzip) al paquete público, que es el que descarga cualquier visitante.

Coste real medido con `npm run build` (gzip):

| Recurso | 3.7.0 | 3.8.0 | Diferencia |
|---|---|---|---|
| CSS público | 2,75 kB | 4,53 kB | +1,8 kB |
| CSS privado | 4,36 kB | 5,47 kB | +1,1 kB |
| JS principal | 74,41 kB | 75,20 kB | +0,8 kB |

## 2. Sistema reutilizable

| Archivo | Zona | Contenido |
|---|---|---|
| `frontend-react/src/estilos/animaciones.css` | común | Tokens de duración, curvas y distancia; fotogramas; entradas `data-revelar` y escalonado `data-revelar-grupo`; transición de página; botones (transición unificada, elevación, «hundido» al pulsar, `aria-busy`); tarjetas `lt-tarjeta` y `lt-tarjeta-sutil`; esqueletos; contadores; subrayado del menú activo; menú móvil; avisos; ventanas modales; zona pública; impresión |
| `frontend-react/src/privado/estilos/animaciones-privado.css` | privada (solo con sesión) | Panel, Nexo, agenda, proyectos, repaso, desplegable del engranaje, panel lateral (abrir **y** cerrar) y pestañas de Configuración |
| `frontend-react/src/comun/animaciones/revelar.js` | común | Un único `IntersectionObserver` para toda la app; `iniciarAnimaciones()`; registro de `--lt-n`; `animarCambio()` y `esperarSalida()` (Web Animations, solo transform/opacity) |
| `frontend-react/src/comun/animaciones/hooks.js` | común | `useRevelar()` (referencia estable con limpieza de React 19), `useAnimarCambio(clave, tipo)` y `useDestello(firma)` |
| `frontend-react/src/comun/ui/Contador.jsx` | común | Contador animado en CSS puro. El texto real («57%») siempre está en el DOM |
| `frontend-react/src/comun/ui/Esqueleto.jsx` | común | Marcador de carga con brillo, `role="status"` y `aria-busy` |

## 3. Qué se animó y dónde

| Área | Animaciones |
|---|---|
| **Entradas** | Al entrar en pantalla, las secciones aparecen con desvanecido y deslizamiento hacia arriba, desde un lado o con un ligero escalado. Los grupos de tarjetas entran escalonados (70 ms; 50 ms en móvil; máximo 8 pasos). El título y el subtítulo del inicio y de las páginas informativas entran en cascada. |
| **Páginas** | Cada pantalla entra con un desvanecido de 0,32 s. La página ya está pintada e interactiva, así que el enrutador no espera a la animación. |
| **Tarjetas** | Al pasar el ratón, las tarjetas se elevan un poco, ganan sombra y muestran un contorno al recibir el foco del teclado. Al tocarlas en táctil se hunden levemente. |
| **Tarjetas: dónde** | Widgets del panel, historial, tarjetas de proyecto y del Kanban, tarjetas de la vista Día, tarjetas de repaso, beneficios y pasos de las páginas públicas. |
| **Botones** | Transición de color y borde unificada. Los botones principales se elevan 1 px al pasar el ratón. Al pulsar, todos se hunden un poco, excepto los arrastrables. |
| **Botones ocupados** | Muestran una rueda pequeña con `aria-busy`: «Enviar» de Nexo, «Aplicar», guardar actividad, check-in, acceso y registro, contacto, importar festivos, formularios de Configuración y calificar un repaso. |
| **Navegación** | El subrayado del enlace activo crece. El menú móvil se despliega con sus enlaces escalonados. El desplegable del engranaje aparece con escala. |
| **Panel lateral** | El panel lateral del perfil se anima al abrir **y al cerrar**. El cierre necesita Chrome/Edge 117+ o Safari 17.4+; en los demás navegadores se cierra al instante, como antes. |
| **Pestañas y avisos** | Las pestañas de Configuración cambian con un deslizamiento corto. Los avisos («Deshacer») y las ventanas modales entran animados. |
| **Calendario** | Al cambiar de mes, semana o día, el contenido entra desde el lado hacia el que avanzas. El mini calendario también se desliza al cambiar de mes. El día seleccionado y el de hoy se resaltan con un «pop». |
| **Calendario: actividades** | Las actividades aparecen al crearlas y hacen un destello breve al editarlas. Las tarjetas del día entran escalonadas. Mientras la agenda se sincroniza, se ve una línea indeterminada fina. |
| **Panel y Proyectos** | Las actividades del día entran escalonadas. Al eliminar una, se desliza fuera y solo entonces se borra; si el borrado falla, vuelve a su sitio. El consejo de la IA cambia con un desvanecido. Al cambiar de proyecto o de modo (Kanban o línea de tiempo), el detalle entra con un desvanecido. |
| **Nexo** | Los tres puntos de escritura ya existían y ahora aparecen con transición. Tus mensajes entran desde la derecha y los de Nexo desde la izquierda. Las propuestas entran con escala y sus elementos escalonados; la aclaración y el adjunto también aparecen animados. «Enviar» muestra la rueda mientras se consulta. **No se simula ninguna respuesta**: el indicador desaparece cuando llega la respuesta real de Ollama. |
| **Estadísticas** | El porcentaje de carga, el historial y el progreso del proyecto **cuentan hasta el valor real** y animan también los cambios. Las barras (carga, progreso, estado y diagrama de Gantt) crecen al aparecer y cambian con suavidad. |
| **Carga** | Esqueletos con brillo en: tu día, historial, lista de proyectos, repasos de hoy, todos los temas, papelera y Configuración. Aparecen con 160 ms de retraso, así que una carga rápida no parpadea. Al llegar los datos, el contenido sustituye al esqueleto con un desvanecido. Antes, el panel mostraba un falso «No hay actividades» mientras cargaba. |

## 4. Rendimiento y accesibilidad

- Solo se **mueven** `transform`, `translate`, `scale` y `opacity`. Al interactuar también cambian color, borde y sombra, como ya hacía la interfaz.
- Una medición del CLS (desplazamientos inesperados de la página) en la prueba de navegador confirma que no hay saltos de diseño.
- Hay **un solo** `IntersectionObserver` para toda la aplicación. Cada elemento se observa una vez y se deja de observar al aparecer o al desmontarse; las pruebas lo comprueban.
- Las animaciones de Web Animations se cancelan si el componente cambia o se desmonta.
- Solo hay animaciones infinitas mientras algo está ocurriendo: rueda de carga, esqueleto, puntos de Nexo y línea de sincronización.
- **Nada queda oculto si algo falla.** El estado inicial oculto solo existe con `html.lt-js`. Esa clase solo se pone cuando hay `IntersectionObserver` y no se pidió reducir el movimiento. Al imprimir, todo se ve.
- **`prefers-reduced-motion: reduce`:**
  - no hay estado oculto ni movimiento;
  - los contadores muestran el valor final al instante;
  - el cambio de mes es inmediato;
  - la rueda y los esqueletos se convierten en un pulso de opacidad (siguen indicando que algo carga);
  - si la preferencia cambia con la página abierta, se respeta al momento.
- **Contadores accesibles:** el texto real está en el DOM, así que los lectores de pantalla, copiar y pegar y las pruebas leen siempre el valor correcto. Sin soporte de `@property`, se ve el número real sin animar.
- **Táctil y móvil:**
  - el hover solo existe con ratón (`hover: hover` y `pointer: fine`);
  - en táctil hay respuesta al pulsar;
  - en pantallas de hasta 760 px o con puntero táctil, los recorridos son más cortos (10 px) y las duraciones menores.
- **CSP intacta.** No se usa ningún `style` en línea en el HTML. Los valores dinámicos (`--lt-n`, anchuras) se asignan por CSSOM desde React, como ya hacía la app. El servidor no cambió sus cabeceras.

## 5. Correcciones necesarias en la base 3.7.0

La 3.7.0 se entregó con **6 pruebas del backend en rojo**. Su informe dejaba la validación «pendiente». Las seis fallaban por la eliminación del frontend clásico, no por la app:

| Prueba | Causa | Corrección |
|---|---|---|
| `perfil.test.js`: rutas sin sesión | Pedía `/app/configuracion/configuracion.js`, que ya no existe (404). | Ahora comprueba que esas direcciones no sirven código y que el código privado de React (`/r/privado`) da 401. |
| `seguridad.test.js`: recursos privados | Igual, con las rutas `/app/...` del frontend clásico. | Comprueba que no se sirven ni con sesión ni sin ella, y que `/r/privado` da 401. |
| `seguridad.test.js`: 404 | Buscaba «Página no encontrada» en el HTML, pero el servidor enviaba la interfaz sin ese texto. | **Mejora en el servidor** (`paginas-react.rutas.js`): la respuesta 404 lleva el título «Página no encontrada (404)». Así, lectores de pantalla, buscadores y navegadores sin JavaScript lo saben antes de que pinte React. |
| `seguridad.test.js`: CSP sin código en línea | Recorría la carpeta `frontend/` eliminada. | Ahora recorre `frontend-react/` (HTML, `src` y `public`). Además prohíbe `dangerouslySetInnerHTML`. |
| `seguridad.test.js`: endpoints eliminados | Igual. | Recorre `frontend-react/src`. |
| `carga.test.js`: Panel sin reglas propias | La regex confundía el filtro de **festivos** del panel (`f.fecha === fechaHoy`) con un cálculo de carga. | Ignora las líneas de festivos; sigue detectando cualquier cálculo de carga propio. |

## 6. Archivos

**Nuevos:**
- `frontend-react/src/estilos/animaciones.css`
- `frontend-react/src/privado/estilos/animaciones-privado.css`
- `frontend-react/src/comun/animaciones/revelar.js`
- `frontend-react/src/comun/animaciones/hooks.js`
- `frontend-react/src/comun/animaciones/animaciones.test.jsx` (9 pruebas)
- `frontend-react/src/comun/ui/Contador.jsx`
- `frontend-react/src/comun/ui/Esqueleto.jsx`
- `tests/navegador/prueba-animaciones.js` (40 comprobaciones en Chromium real)
- este informe

**Modificados (solo presentación; la lógica, los datos y las llamadas a la API no cambian):**

| Archivo | Cambio |
|---|---|
| `main.jsx` | Inicia el sistema e importa la hoja de animaciones. |
| `ZonaPrivada.jsx` | Importa la hoja privada. |
| `Panel.jsx` | Esqueletos, contadores, salida al eliminar, entradas y consejo animado. |
| `Agenda.jsx` | Cambio de periodo animado e indicador de sincronización. |
| `vistas.jsx` | Destello al editar, mini calendario y componente `TarjetaDia` (la tarjeta del día, extraída sin cambiar su marcado). |
| `Proyectos.jsx` | Esqueleto, contador y detalle animado. |
| `Repaso.jsx` | Esqueletos y entradas. |
| `Papelera.jsx`, `Configuracion.jsx` | Esqueleto. |
| `ChatIA.jsx`, `FormularioActividad.jsx`, `ImportadorFestivos.jsx`, `secciones.jsx`, `acceso.jsx`, `ContactoFlotante.jsx` | `aria-busy` en sus botones de acción. |
| `useActividades.js` | Devuelve además `sincronizando`; el resto no cambia. |
| `Inicio.jsx`, `InfoPlanificador.jsx`, `InfoAsistente.jsx` | Entradas al hacer scroll. |
| `backend/rutas/paginas-react.rutas.js` | Título de la 404. |
| `package.json` | 3.8.0 y el script `test:e2e:animaciones`. |
| `scripts/generar-zip.js` | Excluye `capturas-animaciones`. |
| `README.md` | Sección «Animaciones». |
| Pruebas `perfil`, `seguridad` y `carga` | Ver §5. |

## 7. Comandos

```
npm ci                         # instalar (sin dependencias nuevas)
npm run build                  # compilar React + PWA
npm start                      # http://localhost:3000 (necesita .env con MONGO_URI)
npm run dev                    # desarrollo: API + Vite
npm run test:front             # frontend (Vitest)
npm test                       # backend (unitarias + integración)
npm run test:e2e               # navegador real: recorrido completo
npm run test:e2e:animaciones   # navegador real: animaciones en escritorio, móvil y reducir movimiento
```

Las dos pruebas en navegador necesitan `playwright-core` y Chromium: `npm i -D playwright-core && npx playwright install chromium`.

## 8. Resultados reales (este entorno: Linux, Node 22.22, Chromium 141)

| Comando | Resultado |
|---|---|
| `npm ci` | correcto |
| `npm run build` | correcto, sin errores ni avisos nuevos |
| `npm run test:front` | **40/40** (31 anteriores + 9 nuevas) |
| `npm test` | **160/160**, dos ejecuciones seguidas (en la 3.7.0 recibida: 154/160) |
| `npm run test:e2e` | **56/56**, dos ejecuciones |
| `npm run test:e2e:animaciones` | **40/40**, dos ejecuciones |

Además, el ZIP entregado se descomprimió en una carpeta vacía y allí se repitió todo: `npm ci`, `build`, `test:front` 40/40, `npm test` 160/160, `test:e2e` 56/56 y `test:e2e:animaciones` 40/40.

Qué cubre `test:e2e:animaciones`:
- **Escritorio 1360 px:** inicio, páginas informativas y 404; las 5 rutas privadas; contador y barra; Nexo con un retraso de red; agenda (adelante, atrás, día seleccionado, tarjetas); proyectos; desplegable. Sin errores de consola ni violaciones de CSP, y CLS < 0,05.
- **Móvil 390 px táctil:** 3 páginas públicas y 5 privadas, sin desplazamiento horizontal y con todo visible; menú hamburguesa.
- **Reducir movimiento:** sin estado oculto ni animaciones en marcha; contador inmediato; cambio de mes sin animación.

Las capturas se guardan en `tests/navegador/capturas-animaciones/`.

Hubo un fallo durante el desarrollo. La primera ejecución de `test:e2e` falló en «Kanban: arrastrar y soltar», y **lo causó este cambio**: el «hundido» al pulsar encogía la tarjeta justo al empezar el arrastre nativo. Se corrigió excluyendo los elementos arrastrables (`[draggable="true"]`) de ese efecto.

## 9. Pendientes y límites conocidos

- **Al eliminar,** la salida animada está en las filas de «Tu día de hoy». En la agenda, eliminar se hace desde el formulario: la ventana se cierra animada y el aviso «Deshacer» aparece animado, pero la tarjeta desaparece sin transición propia.
- **El cierre animado del panel lateral y de las ventanas** depende del navegador (§3). En Firefox y Safari anteriores a 17.4 se cierran al instante, como en la 3.7.0.
- **Probado solo en Chromium** (escritorio y emulación móvil). Conviene revisarlo a mano en Safari (iOS) y Firefox.
- **La sincronización del Kanban** al arrastrar sigue siendo la de la 3.7.0. Las tarjetas que cambian de columna entran animadas en su nueva columna.
- **`npm audit`:** las dependencias no cambiaron respecto a la 3.7.0. Hoy, `npm audit --omit=dev` da **0 vulnerabilidades en producción**. Quedan 15 moderadas o bajas en herramientas de desarrollo y compilación (Vitest, Workbox, `archiver`), las mismas explicadas en `INFORME-3.6.1.md`.
