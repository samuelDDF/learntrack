// Prueba en NAVEGADOR REAL del sistema de animaciones (v3.8). No forma parte de `npm test`.
// Uso:  npm run build  &&  npm run test:e2e:animaciones   (requiere playwright-core + Chromium, como test:e2e)
// Comprueba en escritorio, en móvil (390 px, táctil) y con «reducir movimiento»:
//   · las entradas se revelan al hacer scroll y NADA queda oculto al final; sin saltos de diseño (CLS)
//   · todas las rutas cargan; transición de página; contadores que llegan al valor REAL; barras animadas
//   · esqueletos solo durante la carga; agenda (cambio de mes animado), Nexo (indicador de escritura, aparición de
//     mensajes, botón ocupado), menú móvil y desplegable; sin errores de consola ni violaciones de CSP
//   · con prefers-reduced-motion: reduce no hay estado oculto ni animaciones de movimiento en marcha
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { iniciarMongoMemoria } from '../utilidades/mongo-memoria.js';
import { iniciarOllamaFalso } from '../utilidades/ollama-falso.js';
import { iniciarApisExternasFalsas } from '../utilidades/apis-externas-falsas.js';
import { iniciarSmtpFalso } from '../utilidades/smtp-falso.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const salida = process.env.E2E_SALIDA || path.join(raiz, 'tests', 'navegador', 'capturas-animaciones');
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
async function paso(nombre, fn) { try { await fn(); } catch (e) { comprobar(nombre, false, e.message.split('\n')[0]); } }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const mongo = process.env.MONGO_URI_TEST ? null : await iniciarMongoMemoria({ replicaSet: true });
const ollama = await iniciarOllamaFalso();
const externas = await iniciarApisExternasFalsas();
const smtp = await iniciarSmtpFalso();
const puerto = 3900 + Math.floor(Math.random() * 300);
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
fs.mkdirSync(salida, { recursive: true });
const hoyBogota = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

/** Contexto con vigilancia de errores, CSP y saltos de diseño (layout shift) */
async function nuevoContexto(opciones = {}) {
    const ctx = await navegador.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 1360, height: 900 }, ...opciones });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(() => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
        window.__cls = 0;
        try {
            new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
        } catch { /* sin soporte */ }
    });
    const pagina = await ctx.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
    pagina.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 40[14]/.test(m.text())) errores.push(`[console] ${m.text()}`); });
    return { ctx, pagina, errores };
}

/** Recorre la página hasta abajo (como una persona) y devuelve los elementos revelables que siguen ocultos */
async function recorrerYContarOcultos(pagina) {
    await pagina.evaluate(async () => {
        const paso = Math.max(200, window.innerHeight * 0.6);
        for (let y = 0; y <= document.documentElement.scrollHeight; y += paso) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await esperar(1200);                                     // termina la última animación (≤ 0,56 s + escalonado)
    return pagina.evaluate(() => [...document.querySelectorAll('[data-revelar], [data-revelar-grupo] > *')]
        .filter((el) => el.offsetParent !== null && Number(getComputedStyle(el).opacity) < 0.99)
        .map((el) => el.className || el.tagName));
}

/** Registro completo (v3.10: con el código del correo). Devuelve medidas de la pantalla de verificación. */
async function registrar(pagina, email, captura) {
    await pagina.goto(`${base}/registro`, { waitUntil: 'networkidle' });
    await pagina.waitForSelector('.auth-dialog[open]');
    await pagina.click('#tab-registro');
    await pagina.fill('#registro-nombre', 'Ana Animada');
    await pagina.fill('#registro-email', email);
    await pagina.fill('#registro-password', 'clave1234');
    await pagina.click('#form-registro button[type="submit"]');
    await pagina.waitForSelector('#form-verificacion');
    await esperar(350);
    const medidas = await pagina.evaluate(() => {
        const d = document.querySelector('.auth-dialog').getBoundingClientRect();
        const cajas = [...document.querySelectorAll('.otp-casilla')].map((c) => c.getBoundingClientRect());
        return {
            dentro: cajas.every((r) => r.left >= d.left && r.right <= d.right),
            ancho: Math.round(cajas[0].width), alto: Math.round(cajas[0].height),
            sinScroll: document.documentElement.scrollWidth <= window.innerWidth
        };
    });
    if (captura) await pagina.screenshot({ path: path.join(salida, captura) });
    await pagina.locator('#otp-0').pressSequentially(smtp.codigoPara(email));
    await Promise.all([pagina.waitForURL('**/panel'), pagina.click('#btn-verificar')]);
    await pagina.waitForSelector('#modal-encuesta[open]', { timeout: 8000 });
    await pagina.selectOption('#encuesta-animo', 'bajo');
    await pagina.selectOption('#encuesta-sueno', 'regular');
    await pagina.selectOption('#encuesta-enfoque', 'mantener');
    await pagina.click('#form-encuesta button[type="submit"]');
    await pagina.waitForSelector('#modal-encuesta:not([open])', { state: 'attached' });
    return medidas;
}
const crearActividad = (pagina, datos) => pagina.request.post(`${base}/api/actividades`, {
    data: { tipo: 'estudio', exigencia: 2, horas: 2, estado: 'pendiente', fecha_inicio: hoyBogota(), fecha_fin: hoyBogota(), ...datos }
});

const RUTAS_PRIVADAS = ['/panel', '/calendario', '/proyectos', '/repaso', '/bienestar', '/papelera', '/perfil', '/configuracion'];
const MAIN_DE = { '/panel': 'chat-layout-container', '/calendario': 'cal-app', '/proyectos': 'proyectos-app', '/repaso': 'repaso-app', '/bienestar': 'bienestar-app', '/papelera': 'papelera-pagina', '/perfil': 'perfil-app', '/configuracion': 'perfil-app' };

try {
    // ================================================================ ESCRITORIO
    {
        const { ctx, pagina, errores } = await nuevoContexto();
        await paso('escritorio · zona pública', async () => {
            await pagina.goto(base + '/', { waitUntil: 'networkidle' });
            const clases = await pagina.evaluate(() => document.documentElement.className);
            comprobar('Escritorio: el sistema se activa (html.lt-js y contadores CSS registrados)', /lt-js/.test(clases) && /lt-contadores/.test(clases), clases);
            const fueraDeVista = await pagina.evaluate(() => [...document.querySelectorAll('[data-revelar]')]
                .filter((el) => el.getBoundingClientRect().top > window.innerHeight).every((el) => !el.classList.contains('lt-visible')));
            comprobar('Las secciones bajo el pliegue esperan a entrar en pantalla (IntersectionObserver)', fueraDeVista);
            const animHero = await pagina.evaluate(() => getComputedStyle(document.querySelector('.hero-content h1')).animationName);
            comprobar('El título principal entra animado', animHero.includes('lt-entrar'), animHero);
            const ocultos = await recorrerYContarOcultos(pagina);
            comprobar('Tras recorrer la página no queda NINGÚN elemento oculto', ocultos.length === 0, ocultos.join(', '));
            const cls = await pagina.evaluate(() => window.__cls);
            comprobar('Sin saltos de diseño por las animaciones (CLS < 0,05)', cls < 0.05, String(cls));
            await pagina.screenshot({ path: path.join(salida, 'escritorio-inicio.png'), fullPage: true });
            for (const ruta of ['/planificador', '/asistente']) {
                await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
                const o = await recorrerYContarOcultos(pagina);
                comprobar(`${ruta}: carga y todo queda visible tras recorrerla`, o.length === 0 && await pagina.locator('main#contenido h1').count() === 1, o.join(', '));
            }
            const r = await pagina.goto(base + '/no-existe', { waitUntil: 'networkidle' });
            comprobar('404: estado 404, título de la 404 desde el servidor y página «no encontrada»', r.status() === 404 && (await pagina.textContent('h1')).includes('Página no encontrada'));
        });

        await paso('escritorio · panel', async () => {
            const m = await registrar(pagina, `anim${Date.now()}@prueba.co`, 'escritorio-verificacion.png');
            comprobar('Escritorio: verificación del correo con seis casillas dentro de la ventana', m.dentro && m.sinScroll, JSON.stringify(m));
            await crearActividad(pagina, { titulo: 'Cálculo integral', horas: 2, exigencia: 2 });
            await pagina.goto(base + '/panel', { waitUntil: 'domcontentloaded' });
            await pagina.waitForSelector('#grid-calendario .act-dia');
            // El contador anima la propiedad --lt-n de 0 al valor real; el texto real está en el DOM desde el principio
            const muestras = [];
            for (let i = 0; i < 12; i++) {
                muestras.push(await pagina.evaluate(() => Number(getComputedStyle(document.querySelector('#porcentaje-carga .lt-contador')).getPropertyValue('--lt-n'))));
                await esperar(60);
            }
            await esperar(900);
            const real = (await pagina.textContent('#porcentaje-carga')).trim();
            const final = await pagina.evaluate(() => Number(getComputedStyle(document.querySelector('#porcentaje-carga .lt-contador')).getPropertyValue('--lt-n')));
            comprobar('Contador de carga: sube progresivamente y termina EXACTAMENTE en el valor real', real === `${final}%` && muestras.some((m) => m < final) && muestras.every((m) => m <= final), `${real} final=${final} muestras=${muestras.join(',')}`);
            comprobar('Barra de carga con animación de crecimiento', (await pagina.evaluate(() => getComputedStyle(document.getElementById('barra-progreso-carga')).animationName)).includes('lt-barra-crecer'));
            comprobar('Sin esqueletos cuando los datos ya están', await pagina.locator('.lt-esqueleto').count() === 0);
            await pagina.screenshot({ path: path.join(salida, 'escritorio-panel.png'), fullPage: true });

            // Nexo: indicador de escritura (tres puntos) durante la espera, botón ocupado y aparición del mensaje
            await pagina.route('**/api/ia/chat', async (r) => { await esperar(1200); await r.continue(); });
            await pagina.fill('#chat-ia textarea', 'Hoy estudio física 1 hora');
            await pagina.press('#chat-ia textarea', 'Enter');
            await pagina.waitForSelector('#chat-ia .chatia-escribiendo:not([hidden])');
            const espera = await pagina.evaluate(() => ({
                puntos: document.querySelectorAll('#chat-ia .chatia-escribiendo .puntos i').length,
                anim: getComputedStyle(document.querySelector('#chat-ia .chatia-escribiendo .puntos i')).animationName,
                ocupado: document.querySelector('#chat-ia .chatia-enviar').getAttribute('aria-busy'),
                usuario: getComputedStyle([...document.querySelectorAll('#chat-ia .msg.usuario')].at(-1)).animationName
            }));
            await pagina.screenshot({ path: path.join(salida, 'escritorio-nexo-escribiendo.png') });
            comprobar('Nexo: tres puntos animados, botón «Enviar» ocupado y el mensaje enviado aparece animado',
                espera.puntos === 3 && espera.anim.includes('chatia-salto') && espera.ocupado === 'true' && espera.usuario.includes('lt-mensaje-usuario'), JSON.stringify(espera));
            await pagina.waitForSelector('#chat-ia .chatia-escribiendo[hidden]', { state: 'attached', timeout: 15000 });
            const tras = await pagina.evaluate(() => ({ ocupado: document.querySelector('#chat-ia .chatia-enviar').getAttribute('aria-busy'), ia: getComputedStyle([...document.querySelectorAll('#chat-ia .msg.ia')].at(-1)).animationName }));
            comprobar('Nexo: al llegar la respuesta REAL del servidor desaparece el indicador y el mensaje entra animado', tras.ocupado === 'false' && tras.ia.includes('lt-mensaje-ia'), JSON.stringify(tras));
            await pagina.unroute('**/api/ia/chat');
        });

        await paso('escritorio · agenda', async () => {
            await pagina.click('nav a[href="/calendario"]');
            await pagina.waitForSelector('.cal-vista .mes');
            await esperar(400);
            const tituloAntes = await pagina.textContent('#cal-titulo');
            await pagina.click('#btn-next');
            const anim = await pagina.evaluate(() => document.getElementById('cal-vista').getAnimations().map((a) => a.effect.getKeyframes()[0].transform));
            comprobar('Agenda: al pasar al mes siguiente el contenido entra desde la derecha (Web Animations)', anim.includes('translateX(18px)') && (await pagina.textContent('#cal-titulo')) !== tituloAntes, JSON.stringify(anim));
            await pagina.click('#btn-prev');
            const anim2 = await pagina.evaluate(() => document.getElementById('cal-vista').getAnimations().map((a) => a.effect.getKeyframes()[0].transform));
            comprobar('Agenda: al volver, entra desde la izquierda', anim2.includes('translateX(-18px)'), JSON.stringify(anim2));
            comprobar('Agenda: el día seleccionado del mini calendario se resalta con animación', (await pagina.evaluate(() => getComputedStyle(document.querySelector('.mini-vista .dia.sel .num')).animationName)).includes('lt-pop'));
            await pagina.click('#btn-hoy');
            await pagina.selectOption('#selector-vista', 'dia');
            await pagina.waitForSelector('.det-card');
            await esperar(700);
            comprobar('Agenda: las tarjetas del día aparecen con animación y quedan visibles', await pagina.evaluate(() => [...document.querySelectorAll('.det-card')].every((c) => getComputedStyle(c).animationName.includes('lt-entrar') && Number(getComputedStyle(c).opacity) === 1)));
            await pagina.selectOption('#selector-vista', 'mes');
            await pagina.screenshot({ path: path.join(salida, 'escritorio-agenda.png'), fullPage: true });
        });

        await paso('escritorio · rutas privadas y transición de página', async () => {
            for (const ruta of RUTAS_PRIVADAS) {
                // Las del menú se recorren con su enlace (navegación SPA); las demás, entrando por su dirección
                if (await pagina.locator(`nav a[href="${ruta}"]`).count()) await pagina.click(`nav a[href="${ruta}"]`);
                else await pagina.goto(base + ruta);
                await pagina.waitForURL(`**${ruta}`);
                const selector = `main#contenido.${MAIN_DE[ruta]}`;
                await pagina.waitForSelector(selector);
                const anim = await pagina.evaluate((sel) => getComputedStyle(document.querySelector(sel)).animationName, selector);
                await esperar(500);
                const o = await recorrerYContarOcultos(pagina);
                comprobar(`${ruta}: transición de página y todo visible tras recorrerla`, anim.includes('lt-pagina') && o.length === 0, `${anim} ${o.join(', ')}`);
            }
            await pagina.goto(base + '/proyectos', { waitUntil: 'networkidle' });
            await crearActividad(pagina, { titulo: 'Diseño', proyecto: 'Robótica', estado: 'completado' });
            await crearActividad(pagina, { titulo: 'Montaje', proyecto: 'Robótica' });
            await pagina.reload({ waitUntil: 'networkidle' });
            await pagina.waitForSelector('.proyecto-tarjeta.activo');
            await esperar(1100);
            const p = await pagina.evaluate(() => ({ texto: document.getElementById('proyecto-progreso-texto').textContent, n: getComputedStyle(document.querySelector('#proyecto-progreso-texto .lt-contador')).getPropertyValue('--lt-n') }));
            comprobar('Proyectos: el contador de progreso termina en el valor real (50 %)', p.texto === '50 %' && p.n.trim() === '50', JSON.stringify(p));
            await pagina.screenshot({ path: path.join(salida, 'escritorio-proyectos.png'), fullPage: true });
            // Desplegable del engranaje
            await pagina.click('#btn-configuracion');
            comprobar('Desplegable de configuración con animación de apertura', (await pagina.evaluate(() => getComputedStyle(document.getElementById('menu-configuracion')).animationName)).includes('lt-desplegar'));
            await pagina.keyboard.press('Escape');
        });

        comprobar('Escritorio: sin errores de JavaScript en la consola', errores.length === 0, errores.join(' | '));
        comprobar('Escritorio: sin violaciones de CSP', (await pagina.evaluate(() => window.__csp)).length === 0, (await pagina.evaluate(() => window.__csp)).join(' | '));
        await ctx.close();
    }

    // ================================================================ MÓVIL (390 px, táctil)
    {
        const { ctx, pagina, errores } = await nuevoContexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await paso('móvil', async () => {
            for (const ruta of ['/', '/planificador', '/asistente']) {
                await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
                const o = await recorrerYContarOcultos(pagina);
                const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
                comprobar(`Móvil ${ruta}: sin desplazamiento horizontal y todo visible tras recorrerla`, ancho && o.length === 0, o.join(', '));
            }
            await pagina.goto(base + '/', { waitUntil: 'networkidle' });
            await pagina.tap('.menu-movil-boton');
            const menu = await pagina.evaluate(() => getComputedStyle(document.querySelector('.navegacion-principal')).animationName);
            await esperar(400);
            await pagina.screenshot({ path: path.join(salida, 'movil-menu.png') });
            comprobar('Móvil: el menú hamburguesa se despliega con animación', menu.includes('lt-desplegar'), menu);
            const mv = await registrar(pagina, `movil${Date.now()}@prueba.co`, 'movil-verificacion.png');
            comprobar('Móvil: las seis casillas del código caben, son cómodas de tocar y no hay desplazamiento horizontal',
                mv.dentro && mv.sinScroll && mv.ancho >= 36 && mv.alto >= 44, JSON.stringify(mv));
            for (const ruta of RUTAS_PRIVADAS) {
                await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
                const o = await recorrerYContarOcultos(pagina);
                const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
                comprobar(`Móvil ${ruta}: carga, sin desplazamiento horizontal y nada oculto`, ancho && o.length === 0, o.join(', '));
            }
            await pagina.goto(base + '/panel', { waitUntil: 'networkidle' });
            await pagina.screenshot({ path: path.join(salida, 'movil-panel.png'), fullPage: true });
            // Papelera en móvil (v3.9): controles dentro de la pantalla, casillas cómodas y acciones a todo el ancho
            for (const titulo of ['Móvil A', 'Móvil B']) {
                const lista = await (await crearActividad(pagina, { titulo })).json();
                await pagina.request.delete(`${base}/api/actividades/${lista.find((x) => x.titulo === titulo).id}`);
            }
            await pagina.tap('#btn-papelera');
            await pagina.waitForSelector('.papelera-pagina .papelera-item');
            await pagina.tap('.papelera-pagina label:has-text("Móvil A")');
            await esperar(400);
            const m = await pagina.evaluate(() => {
                const d = document.querySelector('.papelera-cuerpo').getBoundingClientRect();
                const dentro = [...document.querySelectorAll('.papelera-cuerpo button, .papelera-cuerpo input, .papelera-cuerpo a')].every((el) => { const r = el.getBoundingClientRect(); return r.left >= d.left - 1 && r.right <= d.right + 1; });
                const casilla = document.querySelector('.papelera-casilla').getBoundingClientRect();
                return { dentro, casilla: casilla.width, ancho: d.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth, acciones: !!document.getElementById('btn-eliminar-seleccion') };
            });
            await pagina.screenshot({ path: path.join(salida, 'movil-papelera.png') });
            comprobar('Móvil: página de la papelera usable (controles dentro de la tarjeta, sin desplazamiento horizontal, casillas de 22 px, acciones al seleccionar)', m.dentro && m.ancho && m.casilla >= 22 && m.acciones, JSON.stringify(m));
        });
        comprobar('Móvil: sin errores de JavaScript ni violaciones de CSP', errores.length === 0 && (await pagina.evaluate(() => window.__csp)).length === 0, errores.join(' | '));
        await ctx.close();
    }

    // ================================================================ REDUCIR MOVIMIENTO
    {
        const { ctx, pagina, errores } = await nuevoContexto({ reducedMotion: 'reduce' });
        await paso('reducir movimiento', async () => {
            await pagina.goto(base + '/', { waitUntil: 'networkidle' });
            const r = await pagina.evaluate(() => ({
                ltjs: document.documentElement.classList.contains('lt-js'),
                ocultos: [...document.querySelectorAll('[data-revelar], [data-revelar-grupo] > *')].filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
                movimiento: document.getAnimations().filter((a) => a.playState === 'running').length
            }));
            comprobar('Reducir movimiento: sin estado oculto, todo visible SIN hacer scroll y sin animaciones en marcha', !r.ltjs && r.ocultos === 0 && r.movimiento === 0, JSON.stringify(r));
            await registrar(pagina, `quieto${Date.now()}@prueba.co`);
            await crearActividad(pagina, { titulo: 'Lectura', horas: 1 });
            await pagina.goto(base + '/panel', { waitUntil: 'domcontentloaded' });
            await pagina.waitForSelector('#grid-calendario .act-dia');
            const c = await pagina.evaluate(() => ({ texto: document.getElementById('porcentaje-carga').textContent, n: getComputedStyle(document.querySelector('#porcentaje-carga .lt-contador')).getPropertyValue('--lt-n').trim() }));
            comprobar('Reducir movimiento: el contador muestra el valor final al instante', c.texto === `${c.n}%`, JSON.stringify(c));
            await pagina.click('nav a[href="/calendario"]');
            await pagina.waitForSelector('.cal-vista .mes');
            await pagina.click('#btn-next');
            comprobar('Reducir movimiento: el cambio de mes es inmediato (sin Web Animations)', (await pagina.evaluate(() => document.getElementById('cal-vista').getAnimations().length)) === 0);
            await pagina.screenshot({ path: path.join(salida, 'reducir-movimiento-agenda.png'), fullPage: true });
        });
        comprobar('Reducir movimiento: sin errores de JavaScript', errores.length === 0, errores.join(' | '));
        await ctx.close();
    }
} finally {
    await navegador.close();
    servidor.kill();
    await ollama.cerrar?.();
    await externas.cerrar?.();
    await smtp.cerrar();
    await mongo?.cerrar?.();
}

const fallos = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones de animaciones correctas. Capturas en ${path.relative(process.cwd(), salida)}`);
process.exit(fallos.length ? 1 : 0);
