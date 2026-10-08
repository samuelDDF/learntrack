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
import { iniciarMongoMemoria } from '../helpers/mongo-memoria.js';
import { iniciarOllamaFalso } from '../helpers/ollama-falso.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const salida = process.env.E2E_SALIDA || path.join(raiz, 'tests', 'e2e', 'capturas');

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
const puerto = 3400 + Math.floor(Math.random() * 400);
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
    for (const ruta of ['/', '/planificador-info.html', '/asistente-info.html', '/404-no-existe']) {
        await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
        const v = await violaciones();
        comprobar(`CSP sin violaciones en ${ruta}`, v.length === 0, v.join(' | '));
    }
    const sinSesion = await pagina.request.get(`${base}/app/dashboard.js`, { maxRedirects: 0 });
    comprobar('Recursos privados sin sesión → 401', sinSesion.status() === 401, `HTTP ${sinSesion.status()}`);

    // ---------- registro por la interfaz ----------
    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    await pagina.click('[data-auth="registro"]');
    await pagina.fill('#registro-nombre', 'Ana Prueba');
    await pagina.fill('#registro-email', `ana${Date.now()}@prueba.co`);
    await pagina.fill('#registro-password', 'clave1234');
    await Promise.all([pagina.waitForURL('**/app-dashboard.html'), pagina.click('#form-registro button[type="submit"]')]);
    comprobar('Registro y redirección al panel', pagina.url().endsWith('/app-dashboard.html'));

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

    // ---------- regresión 2-d: actividad de rango (ayer → mañana) cuenta igual en panel y agenda ----------
    const hoy = hoyBogota();
    await pagina.request.post(`${base}/api/actividades`, { data: { titulo: 'Informe de rango', tipo: 'trabajo', exigencia: 1, horas: 1, fecha_inicio: sumar(hoy, -1), fecha_fin: sumar(hoy, 1), estado: 'completado' } });
    await pagina.reload({ waitUntil: 'networkidle' });
    await pagina.waitForFunction(() => document.querySelector('#porcentaje-carga')?.textContent !== '0%');
    const pctPanel = (await pagina.textContent('#porcentaje-carga')).trim();
    await pagina.goto(`${base}/calendario.html`, { waitUntil: 'networkidle' });
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
        await pagina.click('#btn-hoy').catch(() => {});
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
    await pagina.setInputFiles('#chat-ia input[type="file"]', path.join(raiz, 'tests', 'fixtures', 'cronograma.pdf'));
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
    const cabeceras = (await pagina.request.get(`${base}/calendario.html`)).headers();
    comprobar('Cabecera Permissions-Policy: microphone=(self)', /microphone=\(self\)/.test(cabeceras['permissions-policy'] ?? ''), cabeceras['permissions-policy']);

    await pagina.screenshot({ path: path.join(salida, 'agenda.png'), fullPage: true });
    await pagina.goto(`${base}/app-dashboard.html`, { waitUntil: 'networkidle' });
    const vPriv = await violaciones();
    await pagina.goto(`${base}/calendario.html`, { waitUntil: 'networkidle' });
    const vPriv2 = await violaciones();
    comprobar('CSP sin violaciones en Mi panel y Mi agenda', vPriv.length === 0 && vPriv2.length === 0, [...vPriv, ...vPriv2].join(' | '));
    // Los 404 esperados (la página /404-no-existe que visitamos a propósito y /favicon.ico, que el proyecto no trae)
    const esperadas = fallidas.filter((f) => /^404 \/(404-no-existe|favicon\.ico)$/.test(f)).length;
    const inesperadas = fallidas.filter((f) => !/^404 \/(404-no-existe|favicon\.ico)$/.test(f));
    // net::ERR_*: fallos de red hacia Google Fonts en entornos sin salida a internet (no es un fallo de la app)
    const errores = consola.filter((c) => !/Failed to load resource: the server responded with a status of 404|net::ERR_/.test(c));
    const de404 = consola.filter((c) => /status of 404/.test(c)).length;
    comprobar('Sin errores ni avisos de CSP en la consola', errores.length === 0 && inesperadas.length === 0 && de404 <= esperadas,
        [...errores, ...inesperadas].slice(0, 5).join(' | ') || `solo los 404 esperados: ${fallidas.join(', ')}`);
} catch (e) {
    comprobar('Ejecución sin excepciones', false, e.message.split('\n')[0]);
    await pagina.screenshot({ path: path.join(salida, 'fallo.png'), fullPage: true }).catch(() => {});
} finally {
    await navegador.close();
    servidor.kill('SIGTERM');
    await ollama.cerrar();
    await mongo?.cerrar();
}

const fallos = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones en navegador correctas. Capturas en ${path.relative(raiz, salida)}`);
process.exit(fallos.length ? 1 : 0);
