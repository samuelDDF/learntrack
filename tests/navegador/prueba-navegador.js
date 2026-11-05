// Prueba en NAVEGADOR REAL (Chromium headless con Playwright). No forma parte de `npm test` porque requiere
// un navegador. Uso:
//   npm i -D playwright-core && npx playwright install chromium      (o define CHROMIUM_PATH)
//   npm run test:e2e
// Arranca una base de datos de pruebas (MONGO_URI_TEST o el servidor en memoria), un Ollama simulado y el
// server.js real, y comprueba: sin violaciones de CSP en consola, check-in en el servidor, el chat crea
// actividades y las vistas se redibujan, propuestas Aplicar/Deshacer, papelera, archivos y la misma carga en
// panel y agenda (regresión del defecto 2-d). Zona horaria del navegador: America/Bogota.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { iniciarMongoMemoria } from '../utilidades/mongo-memoria.js';
import { iniciarOllamaFalso } from '../utilidades/ollama-falso.js';

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
// Chromium bloquea algunos puertos (p. ej. 3659 → ERR_UNSAFE_PORT): se evita ese en el sorteo
const PUERTOS_BLOQUEADOS = new Set([3659]);
let puerto;
do { puerto = 3400 + Math.floor(Math.random() * 400); } while (PUERTOS_BLOQUEADOS.has(puerto));
const base = `http://localhost:${puerto}`;
const servidor = spawn(process.execPath, ['server.js'], {
    cwd: raiz,
    env: { ...process.env, MONGO_URI: process.env.MONGO_URI_TEST || mongo.uri, PORT: String(puerto), OLLAMA_API_BASE: ollama.base, NODE_ENV: 'development' },
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

    // ---------- registro por la interfaz ----------
    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    await pagina.click('[data-auth="registro"]');
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
    await pagina.fill('#chat-ia textarea', 'Hoy estudio cálculo 2 horas');
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
    await pagina.click('#selector-vistas button[data-vista="mensual"]');
    await pagina.waitForSelector('.mes .dia.hoy .carga-dia');
    const pctAgenda = (await pagina.textContent('.mes .dia.hoy .carga-dia')).replace(/\s/g, '');
    comprobar('Misma carga hoy en panel y agenda (rango + completada cuentan)', pctPanel.replace(/\s/g, '') === pctAgenda, `panel ${pctPanel} · agenda ${pctAgenda}`);
    comprobar('Esperado: (2×2×10 + 1×1×10) / 70 = 71 %', pctPanel === '71%', pctPanel);

    // ---------- 8 vistas sin errores e indicador por día ----------
    for (const v of ['mensual', 'semanal', 'diario', 'kanban', 'timeline', 'minimalista', 'eventos', 'moderno']) {
        await pagina.click(`#selector-vistas button[data-vista="${v}"]`);
        await pagina.waitForTimeout(150);
    }
    for (const [v, sel] of [['semanal', '.sem-cab .carga-dia'], ['diario', '.diario-cab .carga-dia'], ['moderno', '.moderno-detalle .carga-dia']]) {
        await pagina.click(`#selector-vistas button[data-vista="${v}"]`);
        await pagina.click('#btn-hoy').catch(() => { });
        comprobar(`Indicador de carga en la vista ${v}`, await pagina.locator(sel).count() > 0);
    }
    await pagina.click('#selector-vistas button[data-vista="mensual"]');

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
    await pagina.click('#selector-vistas button[data-vista="diario"]');
    await pagina.click('#btn-hoy');
    await pagina.click('.fila-dia button:has-text("Editar") >> nth=0');
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

    // ---------- archivo: propuesta con casillas ----------
    await pagina.setInputFiles('#chat-ia input[type="file"]', path.join(raiz, 'tests', 'archivos-de-prueba', 'cronograma.pdf'));
    await pagina.waitForSelector('#chat-ia .chatia-tarjeta[data-propuesta] input[type="checkbox"]', { timeout: 20000 });
    const casillas = await pagina.locator('#chat-ia .chatia-tarjeta:last-of-type input[type="checkbox"]').count();
    comprobar('Un PDF produce una propuesta con casillas (nunca se aplica solo)', casillas >= 2, `${casillas} casillas`);
    await pagina.click('#chat-ia .chatia-tarjeta:last-of-type button:has-text("Añadir seleccionadas")');
    await pagina.waitForSelector('#chat-ia .chatia-tarjeta:last-of-type >> text=✓ Aplicada');
    const conParcial = (await (await pagina.request.get(`${base}/api/actividades`)).json()).some((a) => a.titulo === 'Parcial 1');
    comprobar('Las casillas marcadas se añaden a la agenda', conParcial);

    // ---------- voz ----------
    const mic = await pagina.$eval('#chat-ia .chatia-mic', (b) => ({ disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), soporte: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) }));
    comprobar('Botón de micrófono con aria-pressed / aria-label y estado coherente con el soporte del navegador', mic.pressed === 'false' && Boolean(mic.label) && (mic.soporte ? !mic.disabled : mic.disabled), JSON.stringify(mic));
    // ---------- Mi perfil: pestañas, temas, foto, cuentas, notificaciones y baja ----------
    const colorFondo = () => pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const temaActivo = () => pagina.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await pagina.setViewportSize({ width: 1360, height: 950 });
    await pagina.goto(`${base}/perfil`, { waitUntil: 'networkidle' });
    comprobar('Mi perfil carga los datos del servidor', (await pagina.inputValue('#perfil-nombre')) === 'Ana Prueba' && (await pagina.inputValue('#perfil-email')).includes('@prueba.co'));
    comprobar('Tema por defecto Tech & Focus: fondo #F0F4F8', (await temaActivo()) === 'tech-focus' && (await colorFondo()) === 'rgb(240, 244, 248)', await colorFondo());
    await pagina.screenshot({ path: path.join(salida, 'perfil-tech.png'), fullPage: true });

    await pagina.focus('#tab-perfil');
    await pagina.keyboard.press('ArrowDown');
    comprobar('Las flechas del teclado mueven entre pestañas (ARIA tabs)', (await pagina.getAttribute('#tab-apariencia', 'aria-selected')) === 'true' && await pagina.isVisible('#panel-apariencia') && !(await pagina.isVisible('#panel-perfil')));

    await pagina.click('[data-tema="zen-calm"] .tema-tarjeta');
    // el fondo tiene una transición suave de .25 s: se espera a que termine antes de medirlo
    await pagina.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(250, 250, 250)', null, { timeout: 3000 }).catch(() => { });
    comprobar('Zen & Calm se aplica al instante: fondo #FAFAFA', (await temaActivo()) === 'zen-calm' && (await colorFondo()) === 'rgb(250, 250, 250)', await colorFondo());
    await pagina.screenshot({ path: path.join(salida, 'perfil-zen.png'), fullPage: true });
    await pagina.click('[data-tema="oscuro"] .tema-tarjeta');
    await pagina.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(15, 23, 42)', null, { timeout: 3000 }).catch(() => { });
    comprobar('Modo oscuro se aplica al instante: fondo #0F172A', (await temaActivo()) === 'oscuro' && (await colorFondo()) === 'rgb(15, 23, 42)', await colorFondo());
    await pagina.waitForFunction(() => document.getElementById('tema-estado').textContent.includes('guardado'));
    await pagina.screenshot({ path: path.join(salida, 'perfil-oscuro.png'), fullPage: true });

    await pagina.reload({ waitUntil: 'networkidle' });
    comprobar('El tema elegido sobrevive a recargar (viene de la cuenta)', (await temaActivo()) === 'oscuro');
    await pagina.evaluate(() => localStorage.clear());
    await pagina.goto(`${base}/panel`, { waitUntil: 'networkidle' });
    await pagina.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'oscuro');
    comprobar('Sin caché local, Mi panel recupera el tema desde el servidor', (await colorFondo()) === 'rgb(15, 23, 42)');
    await pagina.screenshot({ path: path.join(salida, 'panel-oscuro.png'), fullPage: true });
    await pagina.goto(`${base}/calendario`, { waitUntil: 'networkidle' });
    await pagina.waitForTimeout(400);
    comprobar('Mi agenda también usa el tema oscuro', (await temaActivo()) === 'oscuro' && (await colorFondo()) === 'rgb(15, 23, 42)');
    await pagina.screenshot({ path: path.join(salida, 'agenda-oscuro.png'), fullPage: true });

    await pagina.goto(`${base}/perfil#cuentas`, { waitUntil: 'networkidle' });
    comprobar('El hash de la URL abre la pestaña (#cuentas)', await pagina.isVisible('#panel-cuentas'));
    comprobar('Se ve la nota de modo demostración de las integraciones', (await pagina.textContent('#nota-modo')).includes('demostración'));
    await pagina.click('[data-servicio="spotify"] [data-accion]');
    await pagina.waitForFunction(() => document.querySelector('[data-servicio="spotify"] [data-estado]').textContent === 'Conectado');
    comprobar('Vincular Spotify → «Conectado» y el botón cambia a Desconectar', (await pagina.textContent('[data-servicio="spotify"] [data-accion]')) === 'Desconectar' && (await pagina.textContent('[data-servicio="youtube"] [data-estado]')) === 'Sin vincular');
    await pagina.screenshot({ path: path.join(salida, 'perfil-cuentas.png'), fullPage: true });
    await pagina.reload({ waitUntil: 'networkidle' });
    comprobar('La cuenta vinculada persiste tras recargar', (await pagina.textContent('[data-servicio="spotify"] [data-estado]')) === 'Conectado');
    await pagina.click('[data-servicio="spotify"] [data-accion]');
    await pagina.waitForFunction(() => document.querySelector('[data-servicio="spotify"] [data-estado]').textContent === 'Sin vincular');
    comprobar('Desconectar vuelve a «Sin vincular»', true);

    await pagina.click('#tab-general');
    await pagina.click('#sw-general');
    await pagina.waitForFunction(() => document.getElementById('notif-estado').textContent.includes('guardadas'));
    comprobar('Apagar las notificaciones desactiva las preferencias finas', await pagina.isDisabled('#sw-alertas') && await pagina.isDisabled('#sw-ia'));
    const prefs = await (await pagina.request.get(`${base}/api/perfil`)).json();
    comprobar('La preferencia de notificaciones se guarda en el servidor', prefs.perfil.notificacionesActivas === false);
    await pagina.click('#sw-general');
    await pagina.waitForFunction(() => !document.getElementById('sw-alertas').disabled);

    await pagina.click('#tab-perfil');
    await pagina.fill('#perfil-nombre', 'Ana Renombrada');
    await pagina.click('#btn-guardar-perfil');
    await pagina.waitForFunction(() => document.getElementById('resumen-nombre').textContent === 'Ana Renombrada');
    comprobar('Editar el nombre actualiza el resumen lateral', true);
    await pagina.fill('#pw-nueva', 'otraClave55');
    await pagina.fill('#pw-confirma', 'otraClave55');
    await pagina.click('#btn-guardar-perfil');
    comprobar('Cambiar la contraseña sin la actual muestra un error claro', (await pagina.textContent('#perfil-estado')).includes('contraseña actual'));
    await pagina.fill('#pw-actual', 'incorrecta1');
    await pagina.click('#btn-guardar-perfil');
    await pagina.waitForFunction(() => document.getElementById('perfil-estado').textContent.includes('no es correcta'));
    comprobar('Una contraseña actual incorrecta se rechaza', true);
    for (const id of ['#pw-actual', '#pw-confirma', '#pw-nueva']) await pagina.fill(id, '');   // la contraseña actual primero: al vaciar la nueva ese campo se oculta

    // PNG real de 1×1 (tests/archivos-de-prueba/imagen.png es una firma falsa solo para probar rechazos y no se puede decodificar)
    const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await pagina.setInputFiles('#avatar-archivo', { name: 'foto.png', mimeType: 'image/png', buffer: png1x1 });
    await pagina.waitForFunction(() => !document.getElementById('avatar-img').hidden);
    const srcAvatar = await pagina.getAttribute('#avatar-img', 'src');
    comprobar('Subir una foto la reduce, la guarda y la muestra', /^\/api\/perfil\/avatar\?v=\d+$/.test(srcAvatar), srcAvatar);
    // se espera a que el navegador termine de descargar la imagen antes de medirla
    await pagina.waitForFunction(() => { const i = document.getElementById('avatar-img'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => { });
    const cargada = await pagina.evaluate(() => document.getElementById('avatar-img').naturalWidth === 256);
    comprobar('La foto servida mide 256×256', cargada);
    await pagina.click('#btn-avatar-quitar');
    await pagina.waitForFunction(() => document.getElementById('avatar-img').hidden);
    comprobar('Quitar la foto vuelve a la inicial', true);

    await pagina.setViewportSize({ width: 390, height: 800 });
    await pagina.reload({ waitUntil: 'networkidle' });
    for (const t of ['#tab-perfil', '#tab-apariencia', '#tab-cuentas', '#tab-general']) {
        await pagina.click(t);
        const ancho = await pagina.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
        comprobar(`Móvil (390 px): sin desplazamiento horizontal en ${t}`, ancho.s <= ancho.w, `${ancho.s} ≤ ${ancho.w}`);
    }
    await pagina.click('#tab-apariencia');
    await pagina.screenshot({ path: path.join(salida, 'perfil-movil.png'), fullPage: true });
    await pagina.setViewportSize({ width: 1360, height: 950 });

    // Eliminar cuenta con un usuario aparte (la sesión principal se sigue usando después)
    {
        const ctx2 = await navegador.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota' });
        const p2 = await ctx2.newPage();
        const email2 = `baja${Date.now()}@prueba.co`;
        const reg = await p2.request.post(`${base}/api/auth/registro`, { data: { nombre: 'Baja Prueba', email: email2, password: 'clave1234' }, headers: { origin: base } });
        await p2.goto(`${base}/perfil#general`, { waitUntil: 'networkidle' });
        await p2.click('#btn-eliminar-cuenta');
        await p2.fill('#eliminar-password', 'clave1234');
        await p2.fill('#eliminar-confirmacion', 'eliminar');
        await p2.click('#btn-eliminar-confirmar');
        comprobar('Eliminar cuenta exige escribir ELIMINAR en mayúsculas', (await p2.textContent('#eliminar-error')).includes('ELIMINAR') && p2.url().includes('/perfil'));
        await p2.fill('#eliminar-confirmacion', 'ELIMINAR');
        await Promise.all([p2.waitForURL(`${base}/`), p2.click('#btn-eliminar-confirmar')]);
        const intento = await ctx2.request.post(`${base}/api/auth/login`, { data: { email: email2, password: 'clave1234' }, headers: { origin: base } });
        comprobar('Cuenta eliminada: redirige al inicio y ya no se puede entrar', reg.status() === 201 && intento.status() === 401, `registro ${reg.status()}, login ${intento.status()}`);
        await ctx2.close();
    }

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
    await mongo?.cerrar();
}

const fallos = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones en navegador correctas. Capturas en ${path.relative(raiz, salida)}`);
process.exit(fallos.length ? 1 : 0);
