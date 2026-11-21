// Prueba en NAVEGADOR REAL del frontend REACT + PWA (Chromium headless con Playwright). No forma parte de `npm test`.
// Uso:  npm run build  &&  npm i -D playwright-core && npx playwright install chromium  (o CHROMIUM_PATH)  &&  npm run test:e2e
// Arranca MongoDB de pruebas (en memoria), Ollama y APIs externas simulados y el server.js REAL con React como único frontend.
// Comprueba: CSP sin violaciones, 404, acceso, check-in, chat (crear, propuesta, aclaración), dictado simulado,
// formulario y papelera, agenda (vistas y festivos), proyectos (Kanban), repaso espaciado, bienestar, perfil,
// configuración, cierre de sesión (y que el código privado deja de descargarse), menú móvil, teclado y PWA.
// v3.11 (SPA): entrar, salir y moverse entre la zona pública y la privada NO recargan el documento (una marca en
// window sobrevive a la navegación) y los estilos privados no se quedan pegados en la parte pública.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { iniciarMongoMemoria } from '../utilidades/mongo-memoria.js';
import { iniciarOllamaFalso } from '../utilidades/ollama-falso.js';
import { iniciarApisExternasFalsas } from '../utilidades/apis-externas-falsas.js';
import { iniciarSmtpFalso } from '../utilidades/smtp-falso.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const salida = process.env.E2E_SALIDA || path.join(raiz, 'tests', 'navegador', 'capturas-react');
if (!fs.existsSync(path.join(raiz, 'frontend-react', 'dist', 'index.html'))) {
    console.log('OMITIDO: compila primero el frontend React con «npm run build».');
    process.exit(0);
}

async function cargarPlaywright() {
    const candidatos = [process.env.PLAYWRIGHT_CORE_PATH && pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href, 'playwright-core', 'playwright'].filter(Boolean);
    for (const c of candidatos) { try { return await import(c); } catch { /* siguiente */ } }
    return null;
}
const pw = await cargarPlaywright();
if (!pw) { console.log('OMITIDO: instala playwright-core (npm i -D playwright-core) para la prueba en navegador.'); process.exit(0); }
const chromium = pw.chromium ?? pw.default?.chromium;

const resultados = [];
const comprobar = (nombre, ok, detalle = '') => { resultados.push({ nombre, ok: Boolean(ok), detalle }); console.log(`${ok ? '✔' : '✘'} ${nombre}${detalle && !ok ? ` — ${detalle}` : ''}`); };
async function paso(nombre, fn) {
    try { await fn(); } catch (e) { comprobar(nombre, false, e.message.split('\n')[0]); }
}

const mongo = process.env.MONGO_URI_TEST ? null : await iniciarMongoMemoria({ replicaSet: true });
const ollama = await iniciarOllamaFalso();
const externas = await iniciarApisExternasFalsas();
const smtp = await iniciarSmtpFalso();                 // v3.10: el código de verificación llega a este SMTP simulado
let puerto;
do { puerto = 3400 + Math.floor(Math.random() * 400); } while (puerto === 3659);
const base = `http://localhost:${puerto}`;
const servidor = spawn(process.execPath, ['server.js'], {
    cwd: raiz,
    env: { ...process.env, MONGO_URI: process.env.MONGO_URI_TEST || mongo.uri, PORT: String(puerto), OLLAMA_API_BASE: ollama.base, ...externas.variablesEntorno, ...smtp.variablesEntorno, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
});
let registro = '';
servidor.stdout.on('data', (d) => { registro += d; });
servidor.stderr.on('data', (d) => { registro += d; });
await new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new Error(`el servidor no arrancó:\n${registro}`)), 20000);
    const i = setInterval(() => { if (registro.includes('ejecutándose')) { clearInterval(i); clearTimeout(t); ok(); } }, 100);
});

const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const contexto = await navegador.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 1360, height: 950 } });
// Las fuentes de Google no son necesarias para la prueba (y sin internet fallarían)
await contexto.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await contexto.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    // Reconocimiento de voz simulado (Chromium headless no tiene micrófono): «dice» lo que pida la prueba
    window.__decir = null;
    // Chromium trae SpeechRecognition (con y sin prefijo): se sustituyen los dos
    const Falso = class {
        start() { this.onstart?.(); window.__decir = (t) => { this.onresult?.({ results: [[{ transcript: t }]] }); this.onend?.(); }; }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
    };
    window.SpeechRecognition = Falso;
    window.webkitSpeechRecognition = Falso;
});
const pagina = await contexto.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
// El 400 del código incorrecto escrito A PROPÓSITO (verificar-correo) es esperado; cualquier otro 400 sí cuenta
const esperado = (m) => /status of 400/.test(m.text()) && m.location().url.endsWith('/api/auth/verificar-correo');
pagina.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 404/.test(m.text()) && !esperado(m)) errores.push(`[console] ${m.text()}`); });
const violaciones = () => pagina.evaluate(() => window.__csp ?? []);
const hoyBogota = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const api = async (ruta) => (await pagina.request.get(base + ruta)).json();
fs.mkdirSync(salida, { recursive: true });
const foto2 = (p, nombre) => p.screenshot({ path: path.join(salida, `${nombre}.png`), fullPage: true });
const foto = (nombre, completa = true) => pagina.screenshot({ path: path.join(salida, `${nombre}.png`), fullPage: completa });
/** Marca en window: si la página se recarga, desaparece (así se comprueba que la SPA navega sin recargar) */
const marcar = () => pagina.evaluate(() => { window.__sinRecarga = true; });
const sinRecargar = () => pagina.evaluate(() => window.__sinRecarga === true);

try {
    // ================================================================ zona pública
    await paso('páginas públicas', async () => {
        for (const ruta of ['/', '/planificador', '/asistente', '/terminos', '/privacidad']) {
            const r = await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
            comprobar(`${ruta}: 200, React pintado y sin violaciones de CSP`, r.status() === 200 && await pagina.locator('main#contenido h1').count() === 1 && (await violaciones()).length === 0, `${r.status()} ${(await violaciones()).join(' | ')}`);
        }
        const r = await pagina.goto(`${base}/no-existe`, { waitUntil: 'networkidle' });
        comprobar('Ruta desconocida: estado 404 y «Página no encontrada»', r.status() === 404 && (await pagina.textContent('h1')).includes('Página no encontrada'));
        await pagina.goto(`${base}/planificador-info.html`, { waitUntil: 'networkidle' });
        comprobar('Direcciones antiguas (*.html) redirigen', new URL(pagina.url()).pathname === '/planificador');
        await foto('publico-inicio');
    });

    await paso('inicio en el móvil', async () => {
        // v3.12: el contenedor del botón de contacto (fijo abajo a la derecha) tapaba las tarjetas del inicio en móviles
        const movil = await navegador.newContext({ locale: 'es-CO', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await movil.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        const m = await movil.newPage();
        try {
            for (const ruta of ['/planificador', '/asistente']) {
                await m.goto(base + '/', { waitUntil: 'networkidle' });
                const enlace = m.locator(`main a[href="${ruta}"]`).first();
                await enlace.scrollIntoViewIfNeeded();
                await m.waitForTimeout(600);
                await enlace.tap({ timeout: 4000 });
                await m.waitForURL(`**${ruta}`, { timeout: 4000 });
                comprobar(`Móvil: la tarjeta «${ruta.slice(1)}» del inicio se puede pulsar`, new URL(m.url()).pathname === ruta);
            }
        } finally { await movil.close(); }
    });

    await paso('navegación interna sin recarga', async () => {
        await pagina.goto(base + '/', { waitUntil: 'networkidle' });
        await pagina.evaluate(() => { window.__sinRecarga = true; });
        await pagina.click('nav a[href="/asistente"]');
        await pagina.waitForSelector('h1:has-text("Asistente con IA Local")');
        comprobar('El menú público navega sin recargar (SPA) y marca la página actual',
            await pagina.evaluate(() => window.__sinRecarga === true) && await pagina.getAttribute('nav a[href="/asistente"]', 'aria-current') === 'page');
    });

    await paso('teclado', async () => {
        await pagina.goto(base + '/', { waitUntil: 'networkidle' });
        await pagina.keyboard.press('Tab');
        comprobar('El primer Tab enfoca «Saltar al contenido»', (await pagina.evaluate(() => document.activeElement?.textContent)) === 'Saltar al contenido');
    });

    await paso('contacto', async () => {
        await pagina.goto(base + '/asistente', { waitUntil: 'networkidle' });
        await pagina.click('#btn-flotante');
        await pagina.fill('#nombre-mini', 'Visitante');
        await pagina.fill('#correo-mini', 'visita@prueba.co');
        await pagina.fill('#mensaje-mini', 'Hola, quiero probar LearnTrack');
        await pagina.click('#contacto-form-mini button[type="submit"]');
        await pagina.waitForFunction(() => document.getElementById('form-estado').textContent.includes('enviado'), null, { timeout: 5000 });
        comprobar('Contacto flotante también en las páginas informativas y sin datos en la URL', !pagina.url().includes('correo='));
    });

    const sinSesion = await pagina.request.get(`${base}/panel`, { maxRedirects: 0 });
    comprobar('Página privada sin sesión → 302 a /login', sinSesion.status() === 302 && sinSesion.headers().location === '/login');
    const privados = fs.readdirSync(path.join(raiz, 'frontend-react', 'dist', 'r', 'privado'));
    const chunkPanel = privados.find((f) => f.startsWith('Panel-') && f.endsWith('.js'));
    comprobar('Código privado sin sesión → 401', (await pagina.request.get(`${base}/r/privado/${chunkPanel}`)).status() === 401);

    // ================================================================ acceso y check-in
    const email = `ana${Date.now()}@prueba.co`;
    await paso('ventana de acceso con dirección propia', async () => {
        await pagina.goto(`${base}/?acceso=login`, { waitUntil: 'networkidle' });
        await pagina.waitForSelector('.auth-dialog[open]');
        comprobar('Enlaces antiguos /?acceso=login abren /login', new URL(pagina.url()).pathname === '/login' && new URL(pagina.url()).search === '');
        await pagina.goto(`${base}/planificador`, { waitUntil: 'networkidle' });
        await marcar();
        await pagina.click('#nav-acceso button');
        await pagina.waitForSelector('.auth-dialog[open]');
        comprobar('Abrir el acceso: /login encima de la página, sin recargar', new URL(pagina.url()).pathname === '/login'
            && (await pagina.textContent('main#contenido h1')).includes('Planificador') && await sinRecargar() && (await pagina.title()) === 'Iniciar sesión | LearnTrack');
        await pagina.click('#tab-registro');
        comprobar('Pestaña «Crear cuenta» → /registro', new URL(pagina.url()).pathname === '/registro');
        await pagina.keyboard.press('Escape');
        await pagina.waitForURL('**/planificador');
        comprobar('Cerrar (Escape) vuelve a la página de fondo sin recargar', await pagina.locator('.auth-dialog[open]').count() === 0 && await sinRecargar());
    });

    await paso('registro', async () => {
        await pagina.goto(`${base}/registro`, { waitUntil: 'networkidle' });
        await pagina.waitForSelector('.auth-dialog[open]');
        await marcar();
        await pagina.fill('#registro-nombre', 'Ana Prueba');
        await pagina.fill('#registro-email', email);
        await pagina.fill('#registro-password', 'clave1234');
        // v3.13: sin marcar la casilla de los documentos legales no se envía nada (y el servidor también lo exige)
        await pagina.fill('#registro-nacimiento', '1995-05-20');
        comprobar('Registro: la casilla de aceptación empieza desmarcada', !(await pagina.isChecked('#registro-acepto')));
        let intentos = 0;
        const contar = (r) => { if (r.url().endsWith('/api/auth/registro')) intentos++; };
        pagina.on('request', contar);
        await pagina.click('#form-registro button[type="submit"]');
        await pagina.waitForTimeout(300);
        comprobar('Registro sin aceptar: mensaje y ninguna petición al servidor',
            intentos === 0 && /debes aceptar los Términos/.test(await pagina.textContent('#form-registro [role="alert"], .auth-dialog [role="alert"]') ?? ''));
        pagina.off('request', contar);
        const sinAceptar = await pagina.request.post(`${base}/api/auth/registro`, { data: { nombre: 'X Y', email: `x${email}`, password: 'clave1234', fechaNacimiento: '1995-05-20' }, headers: { Origin: base } });
        comprobar('El servidor rechaza un registro sin aceptación aunque se salte el navegador', sinAceptar.status() === 400 && (await sinAceptar.json()).codigo === 'aceptacion_requerida');
        await pagina.check('#registro-acepto');
        await foto('registro-aceptacion', false);
        await pagina.click('#form-registro button[type="submit"]');
        // v3.10: crear la cuenta NO entra: pide el código enviado al correo
        await pagina.waitForSelector('#form-verificacion');
        const oculto = await pagina.textContent('#verif-email');
        comprobar('Registro → /verificar-correo «Verifica tu correo electrónico» con el correo oculto (sin entrar al panel)',
            (await pagina.textContent('#auth-titulo')) === 'Verifica tu correo electrónico' && oculto === `${email.slice(0, 4)}***@prueba.co` && new URL(pagina.url()).pathname === '/verificar-correo', oculto);
        const sinVerificar = await pagina.request.get(`${base}/panel`, { maxRedirects: 0 });
        comprobar('Sin verificar no hay acceso: /panel → /verificar-correo y la API privada da 401',
            sinVerificar.status() === 302 && sinVerificar.headers().location === '/verificar-correo' && (await pagina.request.get(`${base}/api/actividades`)).status() === 401);
        const codigo = smtp.codigoPara(email);
        comprobar('El correo llegó al SMTP con el código de 6 dígitos', /^\d{6}$/.test(codigo ?? ''));
        await foto('verificacion-correo', false);
        await pagina.locator('#otp-0').pressSequentially(codigo === '000000' ? '111111' : '000000');
        await pagina.click('#btn-verificar');
        await pagina.waitForFunction(() => /Código incorrecto/.test(document.getElementById('verif-error').textContent));
        comprobar('Código incorrecto: mensaje claro y casillas vacías', (await pagina.inputValue('#otp-0')) === '' && /quedan 4 intentos/.test(await pagina.textContent('#verif-error')));
        await pagina.locator('#otp-0').pressSequentially(codigo);
        await Promise.all([pagina.waitForURL('**/panel'), pagina.click('#btn-verificar')]);
        await pagina.waitForSelector('#titulo-bienvenida');
        comprobar('Código correcto → Mi panel SIN recargar la página (SPA)', pagina.url().endsWith('/panel') && await sinRecargar());
        comprobar('Con sesión el código privado se descarga', (await pagina.request.get(`${base}/r/privado/${chunkPanel}`)).status() === 200);
    });

    await paso('check-in', async () => {
        await pagina.waitForSelector('#modal-encuesta[open]', { timeout: 8000 });
        // v3.13: el check-in (ánimo y sueño pueden ser datos de salud) es OPCIONAL: se ofrece, con «Ahora no»
        comprobar('El check-in del día se ofrece al entrar y se puede omitir («Ahora no»)', await pagina.locator('#modal-encuesta[open] button:has-text("Ahora no")').count() === 1);
        await pagina.selectOption('#encuesta-animo', 'bajo');
        await pagina.selectOption('#encuesta-sueno', 'regular');
        await pagina.selectOption('#encuesta-enfoque', 'mantener');
        await pagina.click('#form-encuesta button[type="submit"]');
        await pagina.waitForSelector('#modal-encuesta:not([open])', { state: 'attached' });
        const chk = await api(`/api/checkin?fecha=${hoyBogota()}`);
        comprobar('Check-in guardado en el servidor con la fecha LOCAL', chk.checkin?.animo === 'bajo', JSON.stringify(chk));
    });

    // ================================================================ chat del panel
    await paso('chat crea', async () => {
        await pagina.fill('#chat-ia textarea', 'Hoy estudio cálculo 2 horas, a cualquier hora');
        await pagina.press('#chat-ia textarea', 'Enter');
        await pagina.waitForSelector('#chat-ia .msg.ia >> text=Agendé', { timeout: 15000 });
        await pagina.waitForSelector('#grid-calendario .act-dia');
        const pct = (await pagina.textContent('#porcentaje-carga')).trim();
        comprobar('El chat crea la actividad y el panel se actualiza (lista y carga, capacidad 70)', (await pagina.textContent('#grid-calendario')).includes('cálculo') && pct === '57%', pct);
        await foto('panel');
    });

    await paso('dictado', async () => {
        await pagina.click('#chat-ia .chatia-mic');
        await pagina.evaluate(() => window.__decir('mañana estudio y luego entreno <img src=x onerror=alert(1)>'));
        await pagina.waitForFunction(() => document.querySelector('#chat-ia textarea').value !== '', null, { timeout: 3000 });
        const valor = await pagina.inputValue('#chat-ia textarea');
        comprobar('Dictado: el texto reconocido llega al cuadro (sin HTML) y separa conectores', valor === 'mañana estudio, luego entreno <img src=x onerror=alert(1)>' && await pagina.locator('#chat-ia img').count() === 0, valor);
        await pagina.fill('#chat-ia textarea', '');
    });

    await paso('editar y borrar con deshacer', async () => {
        await pagina.click('#grid-calendario button[aria-label^="Editar"]');
        await pagina.waitForSelector('#modal-actividad[open]');
        await pagina.fill('#f-titulo', 'Cálculo integral');
        await pagina.click('#btn-guardar');
        await pagina.waitForSelector('#grid-calendario >> text=Cálculo integral');
        comprobar('Editar desde el panel guarda en el servidor', (await api('/api/actividades')).some((a) => a.titulo === 'Cálculo integral'));
        await pagina.click('#grid-calendario button[aria-label^="Eliminar"]');
        await pagina.click('#grid-calendario button[aria-label^="¿Seguro?"]');
        await pagina.waitForSelector('.aviso-flotante >> text=papelera');
        comprobar('Eliminar pide confirmación y va a la papelera', (await api('/api/actividades')).length === 0);
        await pagina.click('.aviso-flotante .aviso-accion');
        await pagina.waitForSelector('#grid-calendario >> text=Cálculo integral');
        comprobar('«Deshacer» la restaura', (await api('/api/actividades')).length === 1);
    });

    await paso('papelera: selección, eliminar para siempre y vaciar', async () => {
        const titulos = ['Papelera 1', 'Papelera 2', 'Papelera 3'];
        for (const titulo of titulos) {
            const lista = await (await pagina.request.post(`${base}/api/actividades`, { data: { titulo, tipo: 'estudio', exigencia: 2, horas: 1, fecha_inicio: hoyBogota(), fecha_fin: hoyBogota() } })).json();
            await pagina.request.delete(`${base}/api/actividades/${lista.find((a) => a.titulo === titulo).id}`);
        }
        const activas = (await api('/api/actividades')).map((a) => a.id).sort().join();
        await marcar();
        await pagina.click('#btn-papelera');
        await pagina.waitForSelector('.papelera-pagina .papelera-item');
        comprobar('«🗑 Papelera» abre la página /papelera sin recargar', new URL(pagina.url()).pathname === '/papelera' && await sinRecargar() && (await pagina.title()) === 'Papelera | LearnTrack');
        comprobar('Papelera sin selección: Restaurar/Eliminar ocultos y «Vaciar papelera» visible',
            await pagina.locator('#btn-restaurar-seleccion, #btn-eliminar-seleccion').count() === 0 && await pagina.isEnabled('#btn-vaciar-papelera'));
        await pagina.click('.papelera-pagina label:has-text("Papelera 1")');
        await pagina.click('.papelera-pagina label:has-text("Papelera 2")');
        comprobar('Papelera: selección múltiple con contador y acciones visibles',
            (await pagina.textContent('#papelera-contador')) === '2 seleccionadas' && await pagina.locator('.papelera-item.seleccionada').count() === 2 && await pagina.isVisible('#btn-eliminar-seleccion'));
        await foto('papelera-seleccion', false);
        await pagina.click('#btn-eliminar-seleccion');
        await pagina.waitForSelector('#dlg-confirmar-papelera[open]');
        await pagina.waitForTimeout(350);
        await foto('papelera-confirmar', false);
        comprobar('Eliminar permanentemente pide confirmación indicando cuántas', (await pagina.textContent('#dlg-confirmar-papelera')).includes('2 actividades'));
        await pagina.click('#btn-confirmar-papelera');
        await pagina.waitForFunction(() => /eliminadas para siempre/.test(document.getElementById('papelera-estado').textContent));
        const papelera = (await api('/api/papelera')).actividades.map((a) => a.titulo);
        comprobar('Se eliminan para siempre SOLO las seleccionadas, sin recargar y sin salir de la papelera',
            new URL(pagina.url()).pathname === '/papelera' && await sinRecargar() && papelera.join() === 'Papelera 3' && await pagina.locator('.papelera-item').count() === 1, papelera.join());
        await pagina.click('#btn-vaciar-papelera');
        await pagina.waitForSelector('#dlg-confirmar-papelera[open]');
        comprobar('Vaciar papelera confirma que se borra todo y no se puede deshacer', /TODAS.*no se puede deshacer/s.test(await pagina.textContent('#dlg-confirmar-papelera')));
        await pagina.click('#btn-confirmar-papelera');
        await pagina.waitForFunction(() => /Papelera vaciada: se eliminaron 1 actividad/.test(document.getElementById('papelera-estado').textContent));
        await foto('papelera-vaciada', false);
        comprobar('Vaciar: papelera vacía, actividades activas intactas y el botón queda deshabilitado',
            (await api('/api/papelera')).actividades.length === 0 && (await api('/api/actividades')).map((a) => a.id).sort().join() === activas && !(await pagina.isEnabled('#btn-vaciar-papelera')));
        await pagina.click('#btn-volver-papelera');
        await pagina.waitForSelector('#chat-ia textarea');
        comprobar('«← Volver» regresa a Mi panel sin recargar', new URL(pagina.url()).pathname === '/panel' && await sinRecargar());
    });

    // ================================================================ bienestar
    await paso('bienestar', async () => {
        await marcar();
        await pagina.click('nav a[href="/bienestar"]');
        await pagina.waitForSelector('.bienestar-app #porcentaje-carga');
        await pagina.waitForFunction(() => document.getElementById('checkin-resumen'));
        const pct = (await pagina.textContent('#porcentaje-carga')).trim();
        comprobar('Bienestar: check-in de hoy, carga (la MISMA del panel), consejo e historial, sin recargar',
            await sinRecargar() && (await pagina.textContent('#checkin-resumen')).includes('Cansado') && pct === '57%'
            && await pagina.locator('#consejo-ia').count() === 1 && await pagina.locator('#resumen-semanal').count() === 1, pct);
        await foto('bienestar');
        await pagina.click('nav a[href="/panel"]');
        await pagina.waitForSelector('#chat-ia textarea');
    });

    await paso('propuesta y deshacer', async () => {
        const manana = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(Date.now() + 86400000));
        await pagina.request.post(`${base}/api/actividades`, { data: { titulo: 'Taller grupal', tipo: 'estudio', exigencia: 2, horas: 2, fecha_inicio: manana, fecha_fin: manana } });
        await pagina.fill('#chat-ia textarea', 'libera mi agenda de mañana');
        await pagina.press('#chat-ia textarea', 'Enter');
        await pagina.waitForSelector('#chat-ia .chatia-tarjeta', { timeout: 15000 });
        comprobar('Liberar un día devuelve una propuesta con carga antes/después', await pagina.locator('#chat-ia .chatia-tarjeta .chatia-cargas').count() > 0);
        await pagina.click('#chat-ia .chatia-tarjeta button:has-text("Aplicar")');
        await pagina.waitForSelector('#chat-ia .chatia-tarjeta >> text=✓ Aplicada');
        const movida = (await api('/api/actividades')).find((a) => a.titulo === 'Taller grupal');
        comprobar('Aplicar mueve la actividad', movida && movida.fecha_inicio !== manana, JSON.stringify(movida));
        await pagina.click('#chat-ia .chatia-tarjeta button:has-text("Deshacer")');
        await pagina.waitForSelector('#chat-ia .chatia-tarjeta >> text=Deshecho');
        comprobar('Deshacer la devuelve a su día', (await api('/api/actividades')).find((a) => a.titulo === 'Taller grupal').fecha_inicio === manana);
    });

    // ================================================================ agenda
    await paso('agenda', async () => {
        await pagina.click('nav a[href="/calendario"]');
        await pagina.waitForSelector('.cal-vista .mes');
        comprobar('Mi agenda: vista Mes con la carga del día', await pagina.locator('.cal-vista .dia.hoy .carga-dia').count() === 1);
        const pctPanel = '57%';
        const pctAgenda = (await pagina.textContent('.cal-vista .dia.hoy .carga-dia')).replace(/\s/g, '');
        comprobar('Panel y agenda muestran la MISMA carga de hoy', `${pctAgenda}` === pctPanel.replace('%', '%'), `${pctAgenda} vs ${pctPanel}`);
        await pagina.selectOption('#selector-vista', 'semana');
        await pagina.waitForSelector('.cal-vista .sem');
        await pagina.selectOption('#selector-vista', 'dia');
        await pagina.waitForSelector('.cal-vista .moderno-detalle');
        comprobar('Vistas Semana y Día', await pagina.locator('.det-card').count() >= 1);
        await pagina.reload({ waitUntil: 'networkidle' });
        comprobar('La vista elegida se recuerda', await pagina.inputValue('#selector-vista') === 'dia');
        await pagina.selectOption('#selector-vista', 'mes');
        await foto('agenda');
    });

    await paso('festivos', async () => {
        await pagina.click('#btn-perfil');
        await pagina.waitForSelector('#menu-perfil[open]');
        await pagina.waitForFunction(() => document.querySelector('#festivo-pais option[value="CO"]'));
        await pagina.selectOption('#festivo-pais', 'CO');
        const antes = (await api('/api/actividades')).length;
        await pagina.click('.festivos-form button[type="submit"]');
        await pagina.waitForFunction(() => /añadieron/.test(document.querySelector('.festivos-form .mensaje').textContent));
        comprobar('Importar festivos no toca las actividades', (await api('/api/actividades')).length === antes);
        await pagina.keyboard.press('Escape');
        const festivos = (await api('/api/festivos')).festivos;
        await pagina.waitForTimeout(300);
        comprobar('La agenda se entera de los festivos importados SIN recargar (arreglo del evento de la 3.4.2)',
            festivos.length > 0 && await pagina.locator('.cal-vista .chip-festivo, .mini-vista .dia.festivo').count() > 0);
    });

    // ================================================================ proyectos
    await paso('proyectos', async () => {
        for (const [titulo, estado] of [['Diseño', 'completado'], ['Sensores', 'pendiente'], ['Informe', 'pendiente']]) {
            await pagina.request.post(`${base}/api/actividades`, { data: { titulo, tipo: 'estudio', exigencia: 2, horas: 2, proyecto: 'Robótica', estado, fecha_inicio: hoyBogota(), fecha_fin: hoyBogota(), fecha_vencimiento: hoyBogota() } });
        }
        await pagina.click('nav a[href="/proyectos"]');
        await pagina.waitForSelector('.proyecto-tarjeta.activo');
        comprobar('Proyectos: progreso 1 de 3', (await pagina.textContent('.proyecto-tarjeta.activo')).includes('33 %'));
        await pagina.click('[data-modo="kanban"]');
        await pagina.click('.kb-col[data-estado="pendiente"] .kb-tarjeta:has-text("Sensores") button[aria-label^="Mover"]:not([disabled])');
        await pagina.waitForSelector('.kb-col[data-estado="en_proceso"] .kb-tarjeta:has-text("Sensores")');
        comprobar('Kanban: mover una tarjeta cambia su estado en el servidor', (await api('/api/actividades')).find((a) => a.titulo === 'Sensores').estado === 'en_proceso');
        await pagina.dragAndDrop('.kb-col[data-estado="pendiente"] .kb-tarjeta:has-text("Informe")', '.kb-col[data-estado="completado"]');
        await pagina.waitForSelector('.kb-col[data-estado="completado"] .kb-tarjeta:has-text("Informe")', { timeout: 5000 });
        comprobar('Kanban: arrastrar y soltar', (await api('/api/actividades')).find((a) => a.titulo === 'Informe').estado === 'completado');
        await pagina.click('[data-modo="timeline"]');
        await pagina.waitForSelector('.gantt-marco .g-barra');
        comprobar('Línea de tiempo: una barra por subtarea y marca de vencimiento', await pagina.locator('.g-barra').count() === 3 && await pagina.locator('.g-vence').count() === 3);
        await foto('proyectos');
    });

    // ================================================================ repaso espaciado
    await paso('repaso', async () => {
        await pagina.click('nav a[href="/estudio"]');
        await pagina.waitForSelector('#repaso-actividad option:has-text("Diseño")', { state: 'attached' });
        const id = (await api('/api/actividades')).find((a) => a.titulo === 'Diseño').id;
        await pagina.selectOption('#repaso-actividad', id);
        await pagina.click('button:has-text("Activar repaso espaciado")');
        await pagina.waitForSelector('.repaso-tarjeta:has-text("Diseño")');
        comprobar('Repaso: activar un tema lo deja para repasar hoy', true);
        await pagina.click('.repaso-tarjeta:has-text("Diseño") button.nota-5');
        await pagina.waitForSelector('.repaso-hechos >> text=Diseño: 5/5');
        const r = (await api('/api/repaso')).actividades.find((a) => a.id === id).repaso;
        comprobar('Repaso: calificar 5 lo programa para mañana (SM-2 en el servidor)', r.repeticiones === 1 && r.intervalo === 1 && (await api('/api/repaso/pendientes')).pendientes === 0, JSON.stringify(r));
        await foto('repaso');
    });

    // ================================================================ configuración
    await paso('configuracion', async () => {
        await pagina.click('#btn-configuracion');
        await pagina.click('#menu-configuracion a[data-seccion="estetica"]');
        await pagina.waitForSelector('#panel-estetica:not([hidden])');
        await pagina.click('.tema-opcion[data-tema="oscuro"]');
        await pagina.waitForFunction(() => document.getElementById('tema-estado').textContent.includes('guardado'));
        comprobar('Tema: se aplica al instante y se guarda en la cuenta',
            await pagina.evaluate(() => document.documentElement.dataset.theme) === 'oscuro' && (await api('/api/perfil')).perfil.temaSeleccionado === 'oscuro');
        await pagina.reload({ waitUntil: 'networkidle' });
        comprobar('El tema se mantiene al recargar', await pagina.evaluate(() => document.documentElement.dataset.theme) === 'oscuro');
        await pagina.click('#btn-paleta-generar');
        await pagina.waitForSelector('#paleta-resultado');
        await pagina.click('#btn-paleta-guardar');
        await pagina.waitForFunction(() => document.getElementById('paleta-estado').textContent.includes('Mi paleta'));
        comprobar('Paleta con Colormind (simulado) guardada como tema personalizado', (await api('/api/perfil')).perfil.temaSeleccionado === 'personalizado');
        await pagina.click('#tab-voz');
        await pagina.fill('#nombre-ia', 'Luna');
        await pagina.click('#btn-nombre-ia');
        await pagina.waitForFunction(() => document.getElementById('nombre-ia-estado').textContent.includes('Luna'));
        await pagina.click('#tab-notificaciones');
        await pagina.keyboard.press('ArrowDown');
        const enfocada = await pagina.waitForFunction(() => document.activeElement?.id === 'tab-voz' && !document.getElementById('panel-voz').hidden, null, { timeout: 3000 }).then(() => true, () => false);
        comprobar('Pestañas con teclado (flechas, vuelve al principio)', enfocada);
        // Privacidad y seguridad vive ahora en Mi perfil (/perfil); el engranaje lleva allí sin recargar
        await marcar();
        await pagina.click('#btn-configuracion');
        await pagina.click('#menu-configuracion a[data-seccion="privacidad"]');
        await pagina.waitForSelector('#panel-privacidad:not([hidden]) #form-password');
        comprobar('El engranaje lleva a /perfil#privacidad (Mi perfil) sin recargar',
            `${new URL(pagina.url()).pathname}${new URL(pagina.url()).hash}` === '/perfil#privacidad' && await sinRecargar() && (await pagina.textContent('h1.perfil-titulo')) === 'Mi perfil');
        await pagina.fill('#pw-actual-cambio', 'clave1234');
        await pagina.fill('#pw-nueva', 'clave5678');
        await pagina.fill('#pw-confirma', 'clave5678');
        await pagina.click('#btn-cambiar-password');
        await pagina.waitForFunction(() => document.getElementById('password-estado').textContent.includes('cambiada'));
        comprobar('Cambio de contraseña', true);
        await pagina.goto(`${base}/configuracion#informacion`, { waitUntil: 'networkidle' });
        await pagina.waitForSelector('#form-perfil');
        comprobar('Dirección antigua /configuracion#informacion → /perfil#informacion', `${new URL(pagina.url()).pathname}${new URL(pagina.url()).hash}` === '/perfil#informacion');
        // Los estilos privados (tema «personalizado») NO se quedan en la parte pública al navegar sin recargar
        await pagina.goto(`${base}/`, { waitUntil: 'networkidle' });
        const estiloPublico = () => pagina.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.site-header')).backgroundColor, getComputedStyle(document.querySelector('.hero h1')).color].join(' | '));
        const directo = await estiloPublico();
        await pagina.goto(`${base}/configuracion#estetica`, { waitUntil: 'networkidle' });
        await pagina.waitForSelector('#panel-estetica:not([hidden])');
        await marcar();
        await pagina.click('.site-header a.brand');
        await pagina.waitForSelector('.hero h1');
        const trasNavegar = await estiloPublico();
        comprobar('Zona privada → logo → inicio sin recargar, con el MISMO aspecto público que al entrar directamente',
            await sinRecargar() && trasNavegar === directo && !(await pagina.evaluate(() => document.documentElement.classList.contains('zona-privada'))), `${directo} ≠ ${trasNavegar}`);
        await pagina.click('#nav-acceso a[href="/panel"]');
        await pagina.waitForSelector('#chat-ia textarea');
        comprobar('«Mi panel» desde la portada vuelve a la zona privada sin recargar', await sinRecargar());
        await pagina.waitForSelector('#chat-ia .msg.ia');
        comprobar('El chat se presenta con el nuevo nombre del asistente', (await pagina.textContent('#chat-ia .msg.ia')).includes('Soy Luna'));
        await foto('configuracion-panel');
    });

    // ================================================================ móvil
    await paso('movil', async () => {
        await pagina.setViewportSize({ width: 390, height: 844 });
        await pagina.goto(base + '/calendario', { waitUntil: 'networkidle' });
        const boton = pagina.locator('.menu-movil-boton');
        comprobar('Móvil: la navegación se esconde tras el botón de menú', await boton.isVisible() && !(await pagina.locator('.navegacion-principal').isVisible()));
        await boton.click();
        comprobar('Móvil: el menú se abre (aria-expanded)', await boton.getAttribute('aria-expanded') === 'true' && await pagina.locator('.navegacion-principal').isVisible());
        await pagina.click('.navegacion-principal a[href="/proyectos"]');
        await pagina.waitForSelector('.proyectos-app');
        comprobar('Móvil: al navegar el menú se cierra', !(await pagina.locator('.navegacion-principal').isVisible()));
        const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth);
        comprobar('Móvil: sin desplazamiento horizontal de la página', ancho <= 392, `${ancho}px`);
        await foto('movil-proyectos', false);
        await pagina.setViewportSize({ width: 1360, height: 950 });
    });

    // ================================================================ PWA
    await paso('pwa', async () => {
        await pagina.goto(base + '/panel', { waitUntil: 'networkidle' });
        const listo = await pagina.evaluate(async () => {
            const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(() => ok(null), 8000))]);
            return reg ? { scope: reg.scope, activo: Boolean(reg.active) } : null;
        });
        comprobar('PWA: service worker registrado y activo con alcance «/»', listo?.activo && listo.scope === `${base}/`, JSON.stringify(listo));
        const manifiesto = await pagina.evaluate(() => document.querySelector('link[rel="manifest"]')?.href);
        comprobar('PWA: manifiesto enlazado', manifiesto === `${base}/manifest.webmanifest`);
        const cacheado = await pagina.evaluate(async () => {
            const nombres = await caches.keys();
            const urls = [];
            for (const n of nombres) for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
            return urls;
        });
        comprobar('PWA: la caché no guarda la API, el código privado ni el HTML',
            cacheado.length > 0 && !cacheado.some((u) => u.startsWith('/api/') || u.startsWith('/r/privado/') || u === '/' || u === '/panel' || u.endsWith('index.html')), cacheado.join(' '));
        await pagina.reload({ waitUntil: 'networkidle' });                // ahora la página está controlada por el SW
        comprobar('PWA: tras recargar, el service worker controla la página', await pagina.evaluate(() => Boolean(navigator.serviceWorker.controller)));
    });

    // ================================================================ cierre de sesión
    await paso('salir', async () => {
        await pagina.goto(base + '/panel', { waitUntil: 'networkidle' });
        await pagina.click('#btn-perfil');
        await marcar();
        await Promise.all([pagina.waitForURL(`${base}/`), pagina.click('#btn-salir')]);
        await pagina.waitForSelector('#nav-acceso button[data-auth="login"]');
        comprobar('Cerrar sesión lleva a la portada sin recargar', await sinRecargar() && !(await pagina.evaluate(() => document.documentElement.classList.contains('zona-privada'))));
        const me = await api('/api/auth/me');
        comprobar('Cerrar sesión invalida la sesión en el servidor', me.usuario === null);
        comprobar('Tras cerrar sesión el código privado vuelve a dar 401', (await pagina.request.get(`${base}/r/privado/${chunkPanel}`)).status() === 401);
        const tema = await pagina.evaluate(() => localStorage.getItem('learntrack_apariencia'));
        comprobar('Al salir se olvida la apariencia en este navegador', tema === null);
        await pagina.goto(base + '/panel', { waitUntil: 'networkidle' });
        comprobar('Volver a /panel tras salir lleva a /login', new URL(pagina.url()).pathname === '/login' && await pagina.locator('.auth-dialog[open]').count() === 1);
        // Una cuenta YA EXISTENTE (verificada antes) vuelve a entrar con su contraseña (la nueva), sin recargar
        await marcar();
        await pagina.fill('#login-email', email);
        await pagina.fill('#login-password', 'clave5678');
        await Promise.all([pagina.waitForURL('**/panel'), pagina.click('#form-login button[type="submit"]')]);
        await pagina.waitForSelector('#titulo-bienvenida');
        comprobar('Una cuenta existente vuelve a iniciar sesión y entra a Mi panel sin recargar', await sinRecargar() && (await api('/api/auth/me')).usuario?.email === email);
    });

    // ================================================================ administración (v3.13)
    await paso('administracion', async () => {
        const normal = await pagina.goto(`${base}/admin`, { waitUntil: 'networkidle' });
        comprobar('Una cuenta normal en /admin: 404 «Página no encontrada»', normal.status() === 404 && (await pagina.textContent('h1')).includes('Página no encontrada'));
        comprobar('Una cuenta normal en /api/admin: 404', (await pagina.request.get(`${base}/api/admin/cuentas`)).status() === 404);
        // El administrador se crea SOLO con el script (contraseña de prueba generada al azar, nunca una real)
        const emailAdmin = `admin${Date.now()}@prueba.co`;
        const clave = `Prueba-${Math.random().toString(36).slice(2)}-${Date.now()}`;
        const correr = (accion) => new Promise((ok) => {
            const h = spawn(process.execPath, ['scripts/admin.js', accion], { cwd: raiz, env: { ...process.env, MONGO_URI: process.env.MONGO_URI_TEST || mongo.uri, ADMIN_EMAIL: emailAdmin }, stdio: ['pipe', 'pipe', 'pipe'] });
            let texto = '';
            h.stdout.on('data', (d) => { texto += d; }); h.stderr.on('data', (d) => { texto += d; });
            h.stdin.end(`${clave}\n${clave}\n`);
            h.on('exit', (codigo) => ok({ codigo, texto }));
        });
        const creado = await correr('crear');
        comprobar('Script: crea el administrador', creado.codigo === 0, creado.texto);
        const otro = await correr('crear');
        comprobar('Script: un segundo administrador es imposible', otro.codigo === 2, otro.texto);
        comprobar('Script: la verificación de integridad es correcta', (await correr('verificar')).codigo === 0);

        const ctx = await navegador.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 1360, height: 950 } });
        await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        const a = await ctx.newPage();
        a.on('pageerror', (e) => errores.push(`[admin pageerror] ${e.message}`));
        try {
            await a.goto(`${base}/login`, { waitUntil: 'networkidle' });
            await a.fill('#login-email', emailAdmin);
            await a.fill('#login-password', clave);
            await Promise.all([a.waitForURL('**/admin'), a.click('#form-login button[type="submit"]')]);
            await a.waitForSelector('text=Panel de administración');
            comprobar('El administrador entra directamente a /admin', new URL(a.url()).pathname === '/admin');
            comprobar('Integridad visible en el panel', /exactamente un administrador/.test(await a.textContent('.adm-integridad')));
            comprobar('La cuenta de administración no usa la API de usuario (403)', (await a.request.get(`${base}/api/actividades`)).status() === 403);
            await a.fill('#adm-buscar', email);
            await a.click('.adm-filtros button[type="submit"]');
            await a.waitForSelector('.adm-fila');
            comprobar('Buscar una cuenta por correo', (await a.locator('.adm-fila').count()) === 1 && (await a.textContent('.adm-fila')).includes(email));
            await foto2(a, 'admin-panel');
            await a.click('.adm-fila');
            await a.waitForSelector('.adm-datos');
            await a.click('button:has-text("Suspender…")');
            await a.fill('#adm-motivo', 'Prueba automática de suspensión');
            await a.click('.adm-form button[type="submit"]');
            await a.waitForSelector('.adm-ok');
            comprobar('Suspender: la persona pierde su sesión al instante', (await pagina.request.get(`${base}/api/actividades`)).status() === 401);
            const login = await pagina.request.post(`${base}/api/auth/login`, { data: { email, password: 'clave5678' }, headers: { Origin: base } });
            comprobar('Una cuenta suspendida no puede iniciar sesión', login.status() === 403 && (await login.json()).codigo === 'cuenta_suspendida');
            await foto2(a, 'admin-detalle');
            await a.click('button:has-text("Reactivar")');
            await a.waitForSelector('.adm-ok:has-text("reactivada")');
            const otraVez = await pagina.request.post(`${base}/api/auth/login`, { data: { email, password: 'clave5678' }, headers: { Origin: base } });
            comprobar('Reactivada: vuelve a iniciar sesión', otraVez.status() === 200);
            await a.keyboard.press('Escape');
            await a.click('.adm-pestana:has-text("Auditoría")');
            await a.waitForSelector('.adm-auditoria li');
            const lineas = await a.textContent('.adm-auditoria');
            comprobar('La auditoría registra creación, inicio de sesión, suspensión y reactivación',
                ['Administrador creado', 'Inicio de sesión del administrador', 'Cuenta suspendida', 'Cuenta reactivada'].every((t) => lineas.includes(t)));
            const movil = await navegador.newContext({ locale: 'es-CO', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() });
            const m = await movil.newPage();
            await m.goto(`${base}/admin`, { waitUntil: 'networkidle' });
            await m.waitForSelector('.adm-fila');
            comprobar('Panel en el móvil: sin desplazamiento horizontal', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
            await m.screenshot({ path: path.join(salida, 'admin-movil.png'), fullPage: true });
            await movil.close();
        } finally { await ctx.close(); }
        await pagina.goto(`${base}/panel`, { waitUntil: 'networkidle' });
    });

    // ---- Sin servidor (la emulación «offline» de Playwright no alcanza al service worker: se apaga el servidor) ----
    await paso('sin conexion', async () => {
        servidor.kill();
        await new Promise((ok) => servidor.once('exit', ok));
        await pagina.goto(base + '/panel').catch(() => {});
        await pagina.waitForSelector('h1', { timeout: 8000 });
        comprobar('PWA: sin servidor se muestra «Sin conexión» (no hay datos privados guardados en el dispositivo)', (await pagina.textContent('h1')).includes('Sin conexión'));
        await foto('sin-conexion', false);
    });

    const v = await violaciones();
    comprobar('Sin violaciones de CSP en todo el recorrido', v.length === 0, v.join(' | '));
    comprobar('Sin errores de JavaScript en la consola', errores.length === 0, errores.slice(0, 5).join(' | '));
} finally {
    await navegador.close();
    servidor.kill();
    await ollama.cerrar();
    await externas.cerrar();
    await smtp.cerrar();
    await mongo?.cerrar?.();
}
const fallos = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones en navegador (React) correctas. Capturas en ${path.relative(process.cwd(), salida)}`);
process.exit(fallos.length ? 1 : 0);
