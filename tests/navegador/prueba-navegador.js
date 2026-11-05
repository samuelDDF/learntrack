// Prueba en NAVEGADOR REAL (Chromium headless con Playwright). No forma parte de `npm test` porque requiere
// un navegador. Uso:
//   npm i -D playwright-core && npx playwright install chromium      (o define CHROMIUM_PATH)
//   npm run test:e2e
// Arranca una base de datos de pruebas (MONGO_URI_TEST o el servidor en memoria), un Ollama simulado y el
// server.js real, y comprueba: sin violaciones de CSP en consola, check-in en el servidor, el chat crea
// actividades y las vistas se redibujan, propuestas Aplicar/Deshacer, papelera, archivos y la misma carga en
// panel y agenda (regresión del defecto 2-d), barra de navegación (avatar y engranaje), festivos importados sin
// tocar actividades, Configuración (voz, temas, Colormind, fondo, cuentas, baja). Zona horaria: America/Bogota.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { iniciarMongoMemoria } from '../utilidades/mongo-memoria.js';
import { iniciarOllamaFalso } from '../utilidades/ollama-falso.js';
import { iniciarApisExternasFalsas } from '../utilidades/apis-externas-falsas.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const salida = process.env.E2E_SALIDA || path.join(raiz, 'tests', 'navegador', 'capturas');

async function cargarPlaywright() {
    const candidatos = [process.env.PLAYWRIGHT_CORE_PATH && pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href, 'playwright-core', 'playwright'].filter(Boolean);
    for (const c of candidatos) { try { return await import(c); } catch { /* siguiente */ } }
    return null;
}

const pw = await cargarPlaywright();
if (!pw) {
    console.log('OMITIDO: instala playwright-core (npm i -D playwright-core) para la prueba en navegador.');
    process.exit(0);
}
const chromium = pw.chromium ?? pw.default?.chromium;

const resultados = [];
const comprobar = (nombre, ok, detalle = '') => { resultados.push({ nombre, ok: Boolean(ok), detalle }); console.log(`${ok ? '✔' : '✘'} ${nombre}${detalle ? ` — ${detalle}` : ''}`); };

const mongo = process.env.MONGO_URI_TEST ? null : await iniciarMongoMemoria({ replicaSet: true });
const ollama = await iniciarOllamaFalso();
const externas = await iniciarApisExternasFalsas();          // Nager.Date y Colormind simulados (sin internet)
// Chromium bloquea algunos puertos (p. ej. 3659 → ERR_UNSAFE_PORT): se evita ese en el sorteo
const PUERTOS_BLOQUEADOS = new Set([3659]);
let puerto;
do { puerto = 3400 + Math.floor(Math.random() * 400); } while (PUERTOS_BLOQUEADOS.has(puerto));
const base = `http://localhost:${puerto}`;
const servidor = spawn(process.execPath, ['server.js'], {
    cwd: raiz,
    env: { ...process.env, MONGO_URI: process.env.MONGO_URI_TEST || mongo.uri, PORT: String(puerto), OLLAMA_API_BASE: ollama.base, ...externas.variablesEntorno, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
});
let registroServidor = '';
servidor.stdout.on('data', (d) => { registroServidor += d; });
servidor.stderr.on('data', (d) => { registroServidor += d; });
await new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new Error(`el servidor no arrancó:\n${registroServidor}`)), 20000);
    const i = setInterval(() => { if (registroServidor.includes('ejecutándose')) { clearInterval(i); clearTimeout(t); ok(); } }, 100);
});

const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const contexto = await navegador.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 1360, height: 950 } });
await contexto.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile ?? ''}:${e.lineNumber ?? ''}`));
});
const pagina = await contexto.newPage();
const consola = [];
pagina.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) consola.push(`[${m.type()}] ${m.text()}`); });
pagina.on('pageerror', (e) => consola.push(`[pageerror] ${e.message}`));
const fallidas = [];
pagina.on('response', (r) => { if (r.status() >= 400) fallidas.push(`${r.status()} ${new URL(r.url()).pathname}`); });
const violaciones = async () => pagina.evaluate(() => window.__csp ?? []);
const hoyBogota = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const sumar = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
fs.mkdirSync(salida, { recursive: true });

try {
    // ---------- páginas públicas: CSP sin inline ----------
    for (const ruta of ['/', '/planificador', '/asistente', '/404-no-existe']) {
        await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
        const v = await violaciones();
        comprobar(`CSP sin violaciones en ${ruta}`, v.length === 0, v.join(' | '));
    }
    await pagina.goto(`${base}/planificador-info.html`, { waitUntil: 'networkidle' });
    comprobar('Las direcciones antiguas (*.html) llevan a las nuevas', new URL(pagina.url()).pathname === '/planificador', pagina.url());
    // Estilo del inicio igual al del proyecto original (regresión: las tarjetas «¿Qué es?», la sección final y el
    // botón de la cabecera perdieron su estilo al separar el CSS)
    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    const estiloInicio = await pagina.evaluate(() => {
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        return {
            tarjeta: cs('.pilares .beneficio').backgroundColor, rejilla: cs('.pilares').display, final: cs('.cta-final').paddingTop,
            cabecera: cs('.btn-header').paddingTop, icono: document.querySelector('link[rel="icon"]').href
        };
    });
    comprobar('Inicio con el estilo original (tarjetas, sección final y botón de la cabecera)',
        estiloInicio.tarjeta !== 'rgba(0, 0, 0, 0)' && estiloInicio.rejilla === 'grid' && estiloInicio.final === '50px' && estiloInicio.cabecera === '8px', JSON.stringify(estiloInicio));
    const sinSesion = await pagina.request.get(`${base}/app/panel/panel.js`, { maxRedirects: 0 });
    comprobar('Recursos privados sin sesión → 401', sinSesion.status() === 401, `HTTP ${sinSesion.status()}`);

    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    // ---------- contacto: botón flotante (el envío va por la API, nunca a la URL) ----------
    await pagina.click('#btn-flotante');
    await pagina.fill('#nombre-mini', 'Visitante');
    await pagina.fill('#correo-mini', 'visita@prueba.co');
    await pagina.fill('#mensaje-mini', 'Hola, quiero probar LearnTrack');
    await pagina.click('#contacto-form-mini button[type="submit"]');
    await pagina.waitForFunction(() => document.getElementById('form-estado').textContent.includes('enviado'), null, { timeout: 5000 });
    comprobar('El formulario flotante de contacto envía el mensaje sin poner los datos en la URL', !pagina.url().includes('correo='), pagina.url());

    // ---------- registro por la interfaz ----------
    await pagina.click('.nav-acceso [data-auth="login"]');
    await pagina.click('#tab-registro');
    await pagina.fill('#registro-nombre', 'Ana Prueba');
    await pagina.fill('#registro-email', `ana${Date.now()}@prueba.co`);
    await pagina.fill('#registro-password', 'clave1234');
    await Promise.all([pagina.waitForURL('**/panel'), pagina.click('#form-registro button[type="submit"]')]);
    comprobar('Registro y redirección al panel', pagina.url().endsWith('/panel'));

    // ---------- check-in en el servidor ----------
    await pagina.waitForSelector('#modal-encuesta[open]', { timeout: 5000 });
    comprobar('El check-in aparece al entrar', true);
    await pagina.selectOption('#encuesta-animo', 'bajo');
    await pagina.selectOption('#encuesta-sueno', 'regular');
    await pagina.selectOption('#encuesta-enfoque', 'mantener');
    await pagina.click('#form-encuesta button[type="submit"]');
    await pagina.waitForSelector('#modal-encuesta:not([open])', { state: 'attached' });
    const chk = await (await pagina.request.get(`${base}/api/checkin?fecha=${hoyBogota()}`)).json();
    comprobar('Check-in guardado en el servidor con la fecha LOCAL (Bogotá)', chk.checkin?.animo === 'bajo', JSON.stringify(chk));

    // ---------- chat del panel crea una actividad ----------
    await pagina.fill('#chat-ia textarea', 'Hoy estudio cálculo 2 horas, a cualquier hora');
    await pagina.press('#chat-ia textarea', 'Enter');
    await pagina.waitForSelector('#chat-ia .msg.ia >> text=Agendé', { timeout: 15000 });
    await pagina.waitForSelector('#grid-calendario .act-dia');
    const enLista = await pagina.textContent('#grid-calendario');
    comprobar('El chat del panel crea la actividad y la lista del día se redibuja', /c[aá]lculo/i.test(enLista), enLista.slice(0, 80));
    const porcentajePanel1 = await pagina.textContent('#porcentaje-carga');
    comprobar('Medidor con capacidad del check-in (bajo = 70): 2 h × 2 × 10 / 70 = 57 %', porcentajePanel1.trim() === '57%', porcentajePanel1);
    await pagina.screenshot({ path: path.join(salida, 'panel.png'), fullPage: true });

    // ---------- el panel edita con el MISMO formulario que la agenda (componente compartido) ----------
    await pagina.click('#grid-calendario .act-dia button[aria-label^="Editar"]');
    await pagina.waitForSelector('#modal-actividad[open]');
    comprobar('Mi panel abre el formulario compartido completo (fechas, horario, estado)',
        await pagina.isVisible('#f-inicio') && await pagina.isVisible('#f-hora-inicio') && await pagina.isVisible('#f-estado') && /c[aá]lculo/i.test(await pagina.inputValue('#f-titulo')));
    await pagina.fill('#f-horas', '3');
    await pagina.click('#btn-guardar');
    await pagina.waitForSelector('#modal-actividad:not([open])', { state: 'attached' });
    await pagina.waitForFunction(() => document.querySelector('#porcentaje-carga')?.textContent.trim() === '86%');
    comprobar('Guardar desde el panel recalcula la carga: 3 h × 2 × 10 / 70 = 86 %', true);
    await pagina.request.put(`${base}/api/actividades/${(await (await pagina.request.get(`${base}/api/actividades`)).json())[0].id}`, { data: { horas: 2 } });
    await pagina.reload({ waitUntil: 'networkidle' });

    // ---------- regresión 2-d: actividad de rango (ayer → mañana) cuenta igual en panel y agenda ----------
    const hoy = hoyBogota();
    await pagina.request.post(`${base}/api/actividades`, { data: { titulo: 'Informe de rango', tipo: 'trabajo', exigencia: 1, horas: 1, fecha_inicio: sumar(hoy, -1), fecha_fin: sumar(hoy, 1), estado: 'completado' } });
    await pagina.reload({ waitUntil: 'networkidle' });
    await pagina.waitForFunction(() => document.querySelector('#porcentaje-carga')?.textContent !== '0%');
    const pctPanel = (await pagina.textContent('#porcentaje-carga')).trim();
    await pagina.goto(`${base}/calendario`, { waitUntil: 'networkidle' });
    await pagina.selectOption('#selector-vista', 'mes');
    await pagina.waitForSelector('.mes .dia.hoy .carga-dia');
    const pctAgenda = (await pagina.textContent('.mes .dia.hoy .carga-dia')).replace(/\s/g, '');
    comprobar('Misma carga hoy en panel y agenda (rango + completada cuentan)', pctPanel.replace(/\s/g, '') === pctAgenda, `panel ${pctPanel} · agenda ${pctAgenda}`);
    comprobar('Esperado: (2×2×10 + 1×1×10) / 70 = 71 %', pctPanel === '71%', pctPanel);

    // ---------- Mi agenda: solo el diseño Moderno, con desplegable Mes / Semana / Día ----------
    comprobar('Mi agenda: diseño Moderno (mini calendario lateral) y sin pestañas Kanban/Timeline',
        await pagina.locator('.moderno-lateral .mini-vista').count() === 1 && await pagina.locator('[data-vista="kanban"], [data-vista="timeline"]').count() === 0);
    comprobar('El desplegable ofrece exactamente Mes, Semana y Día',
        JSON.stringify(await pagina.$$eval('#selector-vista option', (o) => o.map((x) => x.textContent))) === JSON.stringify(['Mes', 'Semana', 'Día']));
    for (const [v, sel] of [['semana', '.sem-cab .carga-dia'], ['dia', '.moderno-detalle .carga-dia'], ['mes', '.mes .dia.hoy .carga-dia']]) {
        await pagina.selectOption('#selector-vista', v);
        await pagina.click('#btn-hoy').catch(() => { });
        comprobar(`Indicador de carga en la vista ${v}`, await pagina.locator(sel).count() > 0);
    }
    await pagina.selectOption('#selector-vista', 'mes');

    // ---------- liberar mañana: propuesta → Aplicar → Deshacer ----------
    const manana = sumar(hoy, 1);
    await pagina.request.post(`${base}/api/actividades`, { data: { titulo: 'Taller grupal', tipo: 'estudio', exigencia: 2, horas: 2, fecha_inicio: manana, fecha_fin: manana } });
    await pagina.reload({ waitUntil: 'networkidle' });
    await pagina.fill('#chat-ia textarea', 'libera mi agenda de mañana');
    await pagina.press('#chat-ia textarea', 'Enter');
    await pagina.waitForSelector('#chat-ia .chatia-tarjeta', { timeout: 15000 });
    comprobar('Liberar un día devuelve una propuesta con carga antes/después', await pagina.locator('#chat-ia .chatia-tarjeta .chatia-cargas').count() > 0);
    await pagina.locator('.cal-chat').screenshot({ path: path.join(salida, 'propuesta.png') });
    await pagina.click('#chat-ia .chatia-tarjeta button:has-text("Aplicar")');
    await pagina.waitForSelector('#chat-ia .chatia-tarjeta >> text=✓ Aplicada');
    const tallerTrasAplicar = (await (await pagina.request.get(`${base}/api/actividades`)).json()).find((a) => a.titulo === 'Taller grupal');
    comprobar('Aplicar mueve la actividad fuera de mañana', tallerTrasAplicar.fecha_inicio !== manana, tallerTrasAplicar.fecha_inicio);
    const celdaManana = await pagina.locator(`.mes .dia:not(.otro-mes) >> nth=${Number(manana.slice(8)) - 1}`).textContent().catch(() => '');
    comprobar('La vista mensual se redibuja tras aplicar', !celdaManana.includes('Taller grupal'));
    await pagina.click('#chat-ia .chatia-tarjeta button:has-text("Deshacer")');
    await pagina.waitForSelector('#chat-ia .chatia-tarjeta >> text=Deshecho');
    const tallerTrasDeshacer = (await (await pagina.request.get(`${base}/api/actividades`)).json()).find((a) => a.titulo === 'Taller grupal');
    comprobar('Deshacer devuelve la actividad a mañana', tallerTrasDeshacer.fecha_inicio === manana, tallerTrasDeshacer.fecha_inicio);

    // ---------- "sí" sin propuesta pendiente no hace nada ----------
    await pagina.fill('#chat-ia textarea', 'sí');
    await pagina.press('#chat-ia textarea', 'Enter');
    await pagina.waitForSelector('#chat-ia .msg.ia >> text=No hay ningún cambio pendiente');
    comprobar('Un «sí» sin propuesta pendiente no ejecuta nada', true);

    // ---------- borrar desde el modal (borrado lógico) + papelera ----------
    await pagina.selectOption('#selector-vista', 'dia');
    await pagina.click('#btn-hoy');
    await pagina.click('.det-card button:has-text("Editar") >> nth=0');
    await pagina.waitForSelector('#modal-actividad[open]');
    const tituloBorrado = await pagina.inputValue('#f-titulo');
    await pagina.click('#btn-eliminar');
    comprobar('El botón Eliminar pide confirmación en el propio modal', (await pagina.textContent('#btn-eliminar')).includes('Seguro'));
    await pagina.click('#btn-eliminar');
    await pagina.waitForSelector('.aviso-flotante >> text=papelera');
    await pagina.click('#btn-papelera');
    await pagina.waitForSelector('#dlg-papelera[open] .papelera-item');
    comprobar('La papelera lista lo eliminado', (await pagina.textContent('#dlg-papelera')).includes(tituloBorrado), tituloBorrado);
    await pagina.click('#dlg-papelera .papelera-item button:has-text("Restaurar")');
    await pagina.waitForSelector('#dlg-papelera >> text=La papelera está vacía');
    await pagina.click('#dlg-papelera button:has-text("Cerrar")');
    const restaurada = (await (await pagina.request.get(`${base}/api/actividades`)).json()).some((a) => a.titulo === tituloBorrado);
    comprobar('Restaurar desde la papelera devuelve la actividad', restaurada);

    // ---------- archivo + mensaje en el mismo envío: lo comprobado se añade solo; lo opcional, con casillas ----------
    await pagina.setInputFiles('#chat-ia input[type="file"]', path.join(raiz, 'tests', 'archivos-de-prueba', 'cronograma.pdf'));
    await pagina.waitForSelector('#chat-ia .chatia-adjunto:not([hidden])');
    comprobar('Adjuntar NO envía todavía: el archivo queda preparado junto al cuadro de texto',
        (await pagina.textContent('#chat-ia .chatia-adjunto')).includes('cronograma.pdf') && (await (await pagina.request.get(`${base}/api/actividades`)).json()).every((a) => a.titulo !== 'Parcial 1'));
    await pagina.fill('#chat-ia textarea', 'Son de la materia Redes');
    await pagina.locator('.cal-chat').screenshot({ path: path.join(salida, 'chat-archivo-y-mensaje.png') });
    await pagina.click('#chat-ia .chatia-enviar');
    await pagina.waitForSelector('#chat-ia .msg.ia >> text=Añadí', { timeout: 20000 });
    const importados = (await (await pagina.request.get(`${base}/api/actividades`)).json()).filter((a) => a.titulo === 'Parcial 1');
    comprobar('Archivo + mensaje: los eventos del PDF se añaden solos y el mensaje asigna la materia', importados.length === 1 && importados[0].proyecto === 'Redes', JSON.stringify(importados.map((a) => a.proyecto)));
    comprobar('La burbuja del usuario muestra el archivo y su mensaje', (await pagina.locator('#chat-ia .msg.usuario').last().textContent()).includes('cronograma.pdf'));
    comprobar('Lo opcional (preparación) queda en una propuesta con casillas desmarcadas',
        await pagina.locator('#chat-ia .chatia-tarjeta:last-of-type input[type="checkbox"]').count() > 0
        && await pagina.locator('#chat-ia .chatia-tarjeta:last-of-type input[type="checkbox"]:checked').count() === 0);
    await pagina.locator('.cal-chat').screenshot({ path: path.join(salida, 'chat-archivo-resultado.png') });

    // ---------- hora ambigua → 2-3 horarios libres; corrección «No, era a las 5» ----------
    await pagina.fill('#chat-ia textarea', 'Mañana repaso física 1 hora');
    await pagina.press('#chat-ia textarea', 'Enter');
    await pagina.waitForSelector('#chat-ia .chatia-aclaracion .chatia-opcion', { timeout: 15000 });
    const opcionesHora = await pagina.$$eval('#chat-ia .chatia-aclaracion:last-of-type .chatia-opcion', (b) => b.map((x) => x.textContent));
    comprobar('Sin hora, el asistente no inventa una: ofrece 2-3 horarios libres y «Sin hora fija»',
        opcionesHora.filter((t) => /^\d{2}:\d{2}$/.test(t)).length >= 2 && opcionesHora.includes('Sin hora fija'), opcionesHora.join(', '));
    await pagina.click('#chat-ia .chatia-aclaracion:last-of-type .chatia-opcion >> nth=0');
    await pagina.waitForSelector('#chat-ia .msg.ia >> text=Agendé «', { timeout: 15000 });
    const fisica = (await (await pagina.request.get(`${base}/api/actividades`)).json()).filter((a) => /f[ií]sica/i.test(a.titulo));
    comprobar('Elegir un horario crea la actividad a esa hora', fisica.length === 1 && fisica[0].hora_inicio === opcionesHora[0], JSON.stringify(fisica.map((a) => a.hora_inicio)));
    await pagina.fill('#chat-ia textarea', 'No, era a las 5');
    await pagina.press('#chat-ia textarea', 'Enter');
    await pagina.waitForSelector('#chat-ia .msg.ia >> text=Corregido', { timeout: 15000 });
    const fisica2 = (await (await pagina.request.get(`${base}/api/actividades`)).json()).filter((a) => /f[ií]sica/i.test(a.titulo));
    comprobar('Una corrección edita la misma actividad (no crea otra)', fisica2.length === 1 && fisica2[0].id === fisica[0].id && fisica2[0].hora_inicio === '17:00', JSON.stringify(fisica2.map((a) => a.hora_inicio)));

    // ---------- voz ----------
    const mic = await pagina.$eval('#chat-ia .chatia-mic', (b) => ({ disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), soporte: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) }));
    comprobar('Botón de micrófono con aria-pressed / aria-label y estado coherente con el soporte del navegador', mic.pressed === 'false' && Boolean(mic.label) && (mic.soporte ? !mic.disabled : mic.disabled), JSON.stringify(mic));
    // ---------- Barra de navegación: avatar (perfil + festivos) y engranaje (Configuración) ----------
    const colorFondo = () => pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const temaActivo = () => pagina.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const variable = (nombre) => pagina.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), nombre);
    await pagina.setViewportSize({ width: 1360, height: 950 });
    await pagina.goto(`${base}/panel`, { waitUntil: 'networkidle' });
    const posicion = await pagina.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        return { avatar: r('#btn-perfil'), engranaje: r('#btn-configuracion'), marca: r('.site-header .brand') };
    });
    comprobar('Navbar: avatar y engranaje en la esquina superior izquierda, antes del logo',
        posicion.avatar.left < 80 && posicion.avatar.right <= posicion.engranaje.left && posicion.engranaje.right <= posicion.marca.left, JSON.stringify({ a: posicion.avatar.left, e: posicion.engranaje.left, m: posicion.marca.left }));
    comprobar('«Mi perfil» ya no es un enlace del menú', (await pagina.locator('.site-header nav a', { hasText: 'Mi perfil' }).count()) === 0);

    await pagina.click('#btn-configuracion');
    comprobar('El engranaje despliega el menú de Configuración', await pagina.isVisible('#menu-configuracion') && (await pagina.getAttribute('#btn-configuracion', 'aria-expanded')) === 'true');
    await pagina.screenshot({ path: path.join(salida, 'navbar-configuracion.png') });
    await pagina.keyboard.press('Escape');
    comprobar('Escape cierra el menú y devuelve el foco al engranaje', !(await pagina.isVisible('#menu-configuracion')) && await pagina.evaluate(() => document.activeElement.id === 'btn-configuracion'));

    await pagina.click('#btn-perfil');
    await pagina.waitForFunction(() => document.getElementById('menu-perfil').open);
    comprobar('El avatar abre el panel lateral con «Cambiar de cuenta» y «Cerrar sesión»',
        await pagina.isVisible('#btn-cambiar-cuenta') && await pagina.isVisible('#btn-salir') && (await pagina.textContent('#offcanvas-titulo')) === 'Ana Prueba');
    await pagina.waitForFunction(() => document.querySelector('#festivo-pais option[value="CO"]'));
    comprobar('Festivos: la lista de países llega del servidor (nombres en español) y sugiere el país del navegador (es-CO)',
        (await pagina.inputValue('#festivo-pais')) === 'CO' && (await pagina.textContent('#festivo-pais option[value="ES"]')) === 'España');
    const antesFestivos = await (await pagina.request.get(`${base}/api/actividades`)).json();
    await pagina.click('.festivos-form button[type="submit"]');
    await pagina.waitForFunction(() => /añadieron/.test(document.querySelector('.festivos-form .mensaje').textContent));
    const despuesFestivos = await (await pagina.request.get(`${base}/api/actividades`)).json();
    comprobar('Importar festivos los SUMA y no toca ninguna actividad', JSON.stringify(antesFestivos) === JSON.stringify(despuesFestivos) && /no se tocaron/.test(await pagina.textContent('.festivos-form .mensaje')),
        await pagina.textContent('.festivos-form .mensaje'));
    await pagina.screenshot({ path: path.join(salida, 'perfil-offcanvas-festivos.png') });
    await pagina.click('.festivos-form button[type="submit"]');
    await pagina.waitForFunction(() => /No había festivos nuevos/.test(document.querySelector('.festivos-form .mensaje').textContent));
    comprobar('Importar dos veces no duplica', /ya estaban/.test(await pagina.textContent('.festivos-form .mensaje')));
    await pagina.keyboard.press('Escape');

    await pagina.goto(`${base}/calendario`, { waitUntil: 'networkidle' });
    await pagina.selectOption('#selector-vista', 'mes').catch(() => { });
    await pagina.click('#btn-hoy');
    await pagina.click('#btn-next');                         // noviembre: Todos los Santos (2 nov) en los datos de prueba
    await pagina.waitForSelector('.chip-festivo');
    const festivoTexto = await pagina.textContent('.chip-festivo');
    comprobar('Mi agenda muestra el festivo importado (y llega sin HTML)', festivoTexto.trim() === '🎉 Todos los Santos', festivoTexto);
    await pagina.screenshot({ path: path.join(salida, 'agenda-festivos.png'), fullPage: true });

    // ---------- Configuración: pestañas, voz, temas, Colormind, fondo, cuentas, notificaciones y baja ----------
    await pagina.goto(`${base}/perfil`, { waitUntil: 'networkidle' });
    comprobar('La dirección antigua /perfil lleva a /configuracion', new URL(pagina.url()).pathname === '/configuracion', pagina.url());
    comprobar('Configuración carga los datos del servidor', (await pagina.inputValue('#perfil-nombre')) === 'Ana Prueba' && (await pagina.inputValue('#perfil-email')).includes('@prueba.co'));
    comprobar('Tema por defecto (Tema Base): fondo #F0F4F8', (await temaActivo()) === 'tech-focus' && (await colorFondo()) === 'rgb(240, 244, 248)', await colorFondo());
    await pagina.screenshot({ path: path.join(salida, 'configuracion-informacion.png'), fullPage: true });

    await pagina.focus('#tab-informacion');
    await pagina.keyboard.press('ArrowDown');
    comprobar('Las flechas del teclado mueven entre pestañas laterales (ARIA tabs)', (await pagina.getAttribute('#tab-voz', 'aria-selected')) === 'true' && await pagina.isVisible('#panel-voz') && !(await pagina.isVisible('#panel-informacion')));
    // Voz: en Chromium headless puede no haber voces; el selector sigue funcionando con «Automática»
    await pagina.waitForTimeout(1700);
    const opcionesVoz = await pagina.locator('#voz-select option').count();
    await pagina.click('#btn-voz-guardar');
    await pagina.waitForFunction(() => /Voz guardada/.test(document.getElementById('voz-estado').textContent));
    comprobar('Voz de la IA: el selector lista las voces del sistema y guarda la elección', opcionesVoz >= 1, `${opcionesVoz} opciones`);
    await pagina.screenshot({ path: path.join(salida, 'configuracion-voz.png'), fullPage: true });

    await pagina.click('#tab-estetica');
    const pruebasTema = [['moderno', 'rgb(247, 247, 251)'], ['oscuro-profundo', 'rgb(0, 0, 0)'], ['futurista', 'rgb(10, 14, 39)']];
    for (const [tema, fondo] of pruebasTema) {
        await pagina.click(`[data-tema="${tema}"] .tema-tarjeta`);
        await pagina.waitForFunction((f) => getComputedStyle(document.body).backgroundColor === f, fondo, { timeout: 3000 }).catch(() => { });
        await pagina.waitForFunction(() => document.getElementById('tema-estado').textContent.includes('guardado'));
        comprobar(`Tema ${tema} se aplica al instante y se guarda`, (await temaActivo()) === tema && (await colorFondo()) === fondo, await colorFondo());
        await pagina.screenshot({ path: path.join(salida, `configuracion-${tema}.png`), fullPage: true });
    }
    await pagina.click('[data-tema="oscuro"] .tema-tarjeta');
    await pagina.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(15, 23, 42)', null, { timeout: 3000 }).catch(() => { });
    await pagina.waitForFunction(() => document.getElementById('tema-estado').textContent.includes('guardado'));
    await pagina.reload({ waitUntil: 'networkidle' });
    comprobar('El tema elegido sobrevive a recargar (viene de la cuenta)', (await temaActivo()) === 'oscuro');
    await pagina.evaluate(() => localStorage.clear());
    await pagina.goto(`${base}/panel`, { waitUntil: 'networkidle' });
    await pagina.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'oscuro');
    comprobar('Sin caché local, Mi panel recupera el tema desde el servidor', (await colorFondo()) === 'rgb(15, 23, 42)');
    await pagina.screenshot({ path: path.join(salida, 'panel-oscuro.png'), fullPage: true });

    // Paleta con Colormind (simulado): vista previa en toda la página → guardar → tema «Mi paleta»
    await pagina.goto(`${base}/configuracion#estetica`, { waitUntil: 'networkidle' });
    await pagina.fill('#color-semilla', '#e11d48');
    await pagina.click('#btn-paleta-generar');
    await pagina.waitForSelector('#paleta-colores li');
    comprobar('Colormind devuelve 5 colores y la vista previa cambia las variables CSS', (await pagina.locator('#paleta-colores li').count()) === 5 && (await temaActivo()) === 'personalizado' && (await variable('--color-primario')) !== '', await variable('--color-primario'));
    await pagina.screenshot({ path: path.join(salida, 'configuracion-paleta.png'), fullPage: true });
    await pagina.click('#btn-paleta-guardar');
    await pagina.waitForFunction(() => /Paleta guardada/.test(document.getElementById('paleta-estado').textContent));
    await pagina.evaluate(() => localStorage.clear());
    await pagina.goto(`${base}/calendario`, { waitUntil: 'networkidle' });
    await pagina.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'personalizado');
    comprobar('La paleta guardada se aplica en las demás páginas (desde la cuenta)', (await variable('--color-fondo')).startsWith('#'), await variable('--color-fondo'));

    // Fondo personalizado (multipart → multer)
    await pagina.goto(`${base}/configuracion#estetica`, { waitUntil: 'networkidle' });
    const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await pagina.setInputFiles('#fondo-archivo', { name: 'fondo.png', mimeType: 'image/png', buffer: png1x1 });
    await pagina.waitForFunction(() => /Fondo aplicado/.test(document.getElementById('fondo-estado').textContent));
    const fondoBody = await pagina.evaluate(() => getComputedStyle(document.body).backgroundImage);
    comprobar('El fondo subido se aplica como background-image', /\/api\/perfil\/fondo\?v=\d+/.test(fondoBody), fondoBody.slice(0, 120));
    await pagina.screenshot({ path: path.join(salida, 'configuracion-fondo.png'), fullPage: true });
    await pagina.click('#btn-fondo-quitar');
    await pagina.waitForFunction(() => !document.documentElement.classList.contains('con-fondo'));
    await pagina.click('[data-tema="tech-focus"] .tema-tarjeta');
    await pagina.waitForFunction(() => document.getElementById('tema-estado').textContent.includes('guardado'));

    await pagina.goto(`${base}/configuracion#cuentas`, { waitUntil: 'networkidle' });
    comprobar('El hash de la URL abre la pestaña (#cuentas)', await pagina.isVisible('#panel-cuentas'));
    comprobar('Cuentas: YouTube, GitHub, Discord, Spotify, Steam y Xbox', (await pagina.locator('.cuenta').count()) === 6 && await pagina.isVisible('[data-servicio="github"]') && await pagina.isVisible('[data-servicio="xbox"]'));
    comprobar('Se ve la nota de modo demostración de las integraciones', (await pagina.textContent('#nota-modo')).includes('demostración'));
    await pagina.click('[data-servicio="github"] [data-accion]');
    await pagina.waitForFunction(() => document.querySelector('[data-servicio="github"] [data-estado]').textContent === 'Conectado');
    comprobar('Conectar GitHub → «Conectado» y el botón cambia a Desconectar', (await pagina.textContent('[data-servicio="github"] [data-accion]')) === 'Desconectar' && (await pagina.textContent('[data-servicio="youtube"] [data-estado]')) === 'Desconectado');
    await pagina.screenshot({ path: path.join(salida, 'configuracion-cuentas.png'), fullPage: true });
    await pagina.reload({ waitUntil: 'networkidle' });
    comprobar('La cuenta conectada persiste tras recargar', (await pagina.textContent('[data-servicio="github"] [data-estado]')) === 'Conectado');
    await pagina.click('[data-servicio="github"] [data-accion]');
    await pagina.waitForFunction(() => document.querySelector('[data-servicio="github"] [data-estado]').textContent === 'Desconectado');
    comprobar('Desconectar vuelve a «Desconectado»', true);

    await pagina.click('#tab-notificaciones');
    await pagina.click('#sw-general');
    await pagina.waitForFunction(() => document.getElementById('notif-estado').textContent.includes('guardadas'));
    comprobar('Apagar las notificaciones desactiva las preferencias finas', await pagina.isDisabled('#sw-alertas') && await pagina.isDisabled('#sw-ia'));
    const prefs = await (await pagina.request.get(`${base}/api/perfil`)).json();
    comprobar('La preferencia de notificaciones se guarda en el servidor', prefs.perfil.notificacionesActivas === false);
    await pagina.click('#sw-general');
    await pagina.waitForFunction(() => !document.getElementById('sw-alertas').disabled);

    await pagina.click('#tab-informacion');
    await pagina.fill('#perfil-nombre', 'Ana Renombrada');
    await pagina.click('#btn-guardar-perfil');
    await pagina.waitForFunction(() => document.getElementById('resumen-nombre').textContent === 'Ana Renombrada');
    await pagina.waitForFunction(() => document.getElementById('saludo-usuario').textContent === 'Hola, Ana');
    comprobar('Editar el nombre actualiza el resumen lateral y la barra', (await pagina.getAttribute('#btn-perfil', 'title')).includes('Ana Renombrada'));

    await pagina.click('#tab-privacidad');
    await pagina.fill('#pw-nueva', 'otraClave55');
    await pagina.fill('#pw-confirma', 'otraClave55');
    await pagina.click('#btn-cambiar-password');
    comprobar('Cambiar la contraseña sin la actual muestra un error claro', (await pagina.textContent('#password-estado')).includes('contraseña actual'));
    await pagina.fill('#pw-actual-cambio', 'incorrecta1');
    await pagina.click('#btn-cambiar-password');
    await pagina.waitForFunction(() => document.getElementById('password-estado').textContent.includes('no es correcta'));
    comprobar('Una contraseña actual incorrecta se rechaza', true);
    for (const id of ['#pw-actual-cambio', '#pw-confirma', '#pw-nueva']) await pagina.fill(id, '');

    // PNG real de 1×1 (tests/archivos-de-prueba/imagen.png es una firma falsa solo para probar rechazos y no se puede decodificar)
    await pagina.click('#tab-informacion');
    await pagina.setInputFiles('#avatar-archivo', { name: 'foto.png', mimeType: 'image/png', buffer: png1x1 });
    await pagina.waitForFunction(() => !document.getElementById('avatar-img').hidden);
    const srcAvatar = await pagina.getAttribute('#avatar-img', 'src');
    comprobar('Subir una foto la reduce, la guarda y la muestra', /^\/api\/perfil\/avatar\?v=\d+$/.test(srcAvatar), srcAvatar);
    await pagina.waitForFunction(() => { const i = document.getElementById('avatar-img'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => { });
    const cargada = await pagina.evaluate(() => document.getElementById('avatar-img').naturalWidth === 256);
    comprobar('La foto servida mide 256×256', cargada);
    comprobar('La foto también aparece en el avatar de la barra', /^\/api\/perfil\/avatar\?v=\d+$/.test(await pagina.getAttribute('#btn-perfil img', 'src') ?? ''));
    await pagina.click('#btn-avatar-quitar');
    await pagina.waitForFunction(() => document.getElementById('avatar-img').hidden);
    comprobar('Quitar la foto vuelve a la inicial', true);

    await pagina.setViewportSize({ width: 390, height: 800 });
    await pagina.reload({ waitUntil: 'networkidle' });
    for (const t of ['#tab-informacion', '#tab-voz', '#tab-estetica', '#tab-cuentas', '#tab-notificaciones', '#tab-privacidad']) {
        await pagina.click(t);
        const ancho = await pagina.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
        comprobar(`Móvil (390 px): sin desplazamiento horizontal en ${t}`, ancho.s <= ancho.w, `${ancho.s} ≤ ${ancho.w}`);
    }
    await pagina.click('#tab-estetica');
    await pagina.screenshot({ path: path.join(salida, 'configuracion-movil.png'), fullPage: true });
    await pagina.click('#btn-perfil');
    await pagina.waitForFunction(() => document.getElementById('menu-perfil').open);
    await pagina.waitForTimeout(400);                         // fin de la animación de entrada
    await pagina.screenshot({ path: path.join(salida, 'perfil-offcanvas-movil.png') });
    await pagina.keyboard.press('Escape');
    await pagina.setViewportSize({ width: 1360, height: 950 });

    // Eliminar cuenta (doble confirmación) y «Cambiar de cuenta», con un usuario aparte
    {
        const ctx2 = await navegador.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota' });
        const p2 = await ctx2.newPage();
        const email2 = `baja${Date.now()}@prueba.co`;
        const reg = await p2.request.post(`${base}/api/auth/registro`, { data: { nombre: 'Baja Prueba', email: email2, password: 'clave1234' }, headers: { origin: base } });
        await p2.goto(`${base}/configuracion#privacidad`, { waitUntil: 'networkidle' });
        await p2.click('#btn-eliminar-cuenta');
        await p2.fill('#eliminar-password', 'clave1234');
        await p2.fill('#eliminar-confirmacion', 'eliminar');
        await p2.click('#btn-eliminar-confirmar');
        comprobar('Eliminar cuenta exige escribir ELIMINAR en mayúsculas', (await p2.textContent('#eliminar-error')).includes('ELIMINAR') && p2.url().includes('/configuracion'));
        await p2.fill('#eliminar-confirmacion', 'ELIMINAR');
        await Promise.all([p2.waitForURL(`${base}/`), p2.click('#btn-eliminar-confirmar')]);
        const intento = await ctx2.request.post(`${base}/api/auth/login`, { data: { email: email2, password: 'clave1234' }, headers: { origin: base } });
        comprobar('Cuenta eliminada: redirige al inicio y ya no se puede entrar', reg.status() === 201 && intento.status() === 401, `registro ${reg.status()}, login ${intento.status()}`);

        const email3 = `cambio${Date.now()}@prueba.co`;
        await p2.request.post(`${base}/api/auth/registro`, { data: { nombre: 'Otra Cuenta', email: email3, password: 'clave1234' }, headers: { origin: base } });
        await p2.goto(`${base}/calendario`, { waitUntil: 'networkidle' });     // (Mi panel abriría primero el check-in)
        await p2.click('#btn-perfil');
        await Promise.all([p2.waitForURL(/\/\?acceso=login|\/$/), p2.click('#btn-cambiar-cuenta')]);
        await p2.waitForSelector('#modal-acceso[open], dialog[open]', { timeout: 5000 }).catch(() => { });
        const sigue = await (await ctx2.request.get(`${base}/api/auth/me`)).json();
        comprobar('«Cambiar de cuenta» cierra la sesión y abre el acceso', sigue.usuario === null && await p2.evaluate(() => Boolean(document.querySelector('dialog[open]'))), JSON.stringify(sigue));
        await p2.screenshot({ path: path.join(salida, 'cambiar-cuenta.png') });
        await ctx2.close();
    }

    // ---------- Proyectos: lista, Kanban y Línea de tiempo del proyecto elegido ----------
    {
        const hoyP = hoyBogota();
        const nueva = (datos) => pagina.request.post(`${base}/api/actividades`, { data: { tipo: 'estudio', exigencia: 2, horas: 2, proyecto: 'Robótica', ...datos } });
        await nueva({ titulo: 'Diseñar el brazo', fecha_inicio: sumar(hoyP, -2), fecha_fin: sumar(hoyP, -2), estado: 'completado' });
        await nueva({ titulo: 'Programar sensores', fecha_inicio: sumar(hoyP, 1), fecha_fin: sumar(hoyP, 2), fecha_vencimiento: sumar(hoyP, 3) });
        await nueva({ titulo: 'Entrega del robot', fecha_inicio: sumar(hoyP, 4), fecha_fin: sumar(hoyP, 4), exigencia: 3, horas: 1, fecha_vencimiento: sumar(hoyP, 4) });
        await pagina.goto(`${base}/proyectos#Rob%C3%B3tica`, { waitUntil: 'networkidle' });
        await pagina.waitForSelector('.proyecto-tarjeta.activo');
        comprobar('Proyectos: la lista muestra el proyecto con su progreso (1 de 3)', (await pagina.textContent('.proyecto-tarjeta.activo')).includes('33 %'), await pagina.textContent('.proyecto-tarjeta.activo'));
        await pagina.click('[data-modo="kanban"]');
        comprobar('Kanban del proyecto: 3 columnas y sus 3 subtareas', await pagina.locator('.kb-col').count() === 3 && await pagina.locator('.kb-tarjeta').count() === 3);
        await pagina.screenshot({ path: path.join(salida, 'proyectos-kanban.png'), fullPage: true });
        await pagina.click('.kb-col[data-estado="pendiente"] .kb-tarjeta:has-text("Programar sensores") button[aria-label^="Mover"]:not([disabled])');
        await pagina.waitForSelector('.kb-col[data-estado="en_proceso"] .kb-tarjeta:has-text("Programar sensores")');
        const enProceso = (await (await pagina.request.get(`${base}/api/actividades`)).json()).find((a) => a.titulo === 'Programar sensores');
        comprobar('Mover una tarjeta del Kanban cambia su estado en el servidor', enProceso.estado === 'en_proceso');
        await pagina.click('[data-modo="timeline"]');
        await pagina.waitForSelector('.gantt-marco .g-barra');
        comprobar('Línea de tiempo del proyecto: una barra por subtarea y marca de vencimiento', await pagina.locator('.g-barra').count() === 3 && await pagina.locator('.g-vence').count() >= 2);
        await pagina.screenshot({ path: path.join(salida, 'proyectos-timeline.png'), fullPage: true });
        const vProy = await violaciones();
        comprobar('CSP sin violaciones en Proyectos', vProy.length === 0, vProy.join(' | '));
        await pagina.goto(`${base}/calendario`, { waitUntil: 'networkidle' });
        await pagina.waitForSelector('.linea-academica .linea-fila');
        comprobar('Agenda: la línea de tiempo académica muestra el proyecto y las entregas', (await pagina.textContent('.linea-academica')).includes('Robótica'));
        comprobar('Agenda: «Próximas entregas» incluye lo que vence pronto', (await pagina.textContent('.proximas')).includes('Programar sensores'));
        await pagina.screenshot({ path: path.join(salida, 'agenda-moderno.png'), fullPage: true });
    }

    // ---------- nombre del asistente (Prompt Maestro) ----------
    await pagina.goto(`${base}/configuracion#voz`, { waitUntil: 'networkidle' });
    await pagina.fill('#nombre-ia', 'Luna');
    await pagina.click('#btn-nombre-ia');
    await pagina.waitForFunction(() => /Luna/.test(document.getElementById('nombre-ia-estado').textContent));
    await pagina.goto(`${base}/calendario`, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('#chat-ia .msg.ia >> text=Soy Luna');
    comprobar('El chat se presenta con el nombre elegido para el asistente', true);

    const cabeceras = (await pagina.request.get(`${base}/calendario`)).headers();
    comprobar('Cabecera Permissions-Policy: microphone=(self)', /microphone=\(self\)/.test(cabeceras['permissions-policy'] ?? ''), cabeceras['permissions-policy']);

    await pagina.screenshot({ path: path.join(salida, 'agenda.png'), fullPage: true });
    await pagina.goto(`${base}/panel`, { waitUntil: 'networkidle' });
    const vPriv = await violaciones();
    await pagina.goto(`${base}/calendario`, { waitUntil: 'networkidle' });
    const vPriv2 = await violaciones();
    comprobar('CSP sin violaciones en Mi panel y Mi agenda', vPriv.length === 0 && vPriv2.length === 0, [...vPriv, ...vPriv2].join(' | '));
    // Los 404 esperados: la página /404-no-existe que visitamos a propósito
    const esperadas = fallidas.filter((f) => /^(404 \/404-no-existe|403 \/api\/perfil)$/.test(f)).length;
    const inesperadas = fallidas.filter((f) => !/^(404 \/404-no-existe|403 \/api\/perfil)$/.test(f));   // 403 /api/perfil: la contraseña incorrecta que probamos a propósito
    // net::ERR_*: fallos de red hacia Google Fonts en entornos sin salida a internet (no es un fallo de la app)
    const errores = consola.filter((c) => !/Failed to load resource: the server responded with a status of (404|403)|net::ERR_/.test(c));
    const de404 = consola.filter((c) => /status of (404|403)/.test(c)).length;
    comprobar('Sin errores ni avisos de CSP en la consola', errores.length === 0 && inesperadas.length === 0 && de404 <= esperadas,
        [...errores, ...inesperadas].slice(0, 5).join(' | ') || `solo los 404 esperados: ${fallidas.join(', ')}`);
} catch (e) {
    comprobar('Ejecución sin excepciones', false, e.message.split('\n')[0]);
    await pagina.screenshot({ path: path.join(salida, 'fallo.png'), fullPage: true }).catch(() => { });
} finally {
    await navegador.close();
    servidor.kill('SIGTERM');
    await ollama.cerrar();
    await externas.cerrar();
    await mongo?.cerrar();
}

const fallos = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones en navegador correctas. Capturas en ${path.relative(raiz, salida)}`);
process.exit(fallos.length ? 1 : 0);
