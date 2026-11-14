// Frontend React (v3.6) servido por Express: rutas públicas y privadas, protección del código privado (/r/privado),
// 404 de páginas y de la API, PWA (service worker conservador) y comprobaciones estáticas de seguridad del código.
// Necesita la compilación (npm run build): si no existe, las pruebas que la usan se omiten avisándolo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarEntorno } from '../utilidades/entorno.js';
import { elegirFrontend } from '../../backend/app.js';
import { PAGINAS_PUBLICAS_REACT, PAGINAS_PRIVADAS_REACT } from '../../backend/rutas/paginas-react.rutas.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(raiz, 'frontend-react', 'dist');
const src = path.join(raiz, 'frontend-react', 'src');
const compilado = fs.existsSync(path.join(dist, 'index.html'));
const omitir = compilado ? false : 'sin compilación de React: ejecuta «npm run build» antes de «npm test»';

let e;
before(async () => { if (compilado) e = await iniciarEntorno({ frontend: 'react' }); });
after(async () => { await e?.cerrar(); });

const archivos = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => f.endsWith(ext)) : []);
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('frontend único: React obligatorio; rechaza modo clásico y exige compilación', () => {
    const vacia = fs.mkdtempSync(path.join(raiz, 'tests', '.tmp-sin-dist-'));
    try {
        assert.throws(() => elegirFrontend('legacy', dist), /solo admite el frontend React/);
        assert.throws(() => elegirFrontend('react', vacia), /npm run build/);
        if (compilado) assert.equal(elegirFrontend('react', dist), 'react');
    } finally { fs.rmSync(vacia, { recursive: true, force: true }); }
});

test('las rutas de páginas del servidor coinciden con las del enrutador de React', () => {
    const rutas = fs.readFileSync(path.join(src, 'rutas.js'), 'utf8');
    const lista = (nombre) => JSON.parse(rutas.match(new RegExp(`${nombre} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
    assert.deepEqual(lista('RUTAS_PUBLICAS'), PAGINAS_PUBLICAS_REACT);
    assert.deepEqual(lista('RUTAS_PRIVADAS'), PAGINAS_PRIVADAS_REACT);
});

test('páginas: públicas 200 sin caché; privadas sin sesión → acceso; con sesión 200; CSP estricta', { skip: omitir }, async () => {
    const anon = e.sinSesion();
    for (const ruta of PAGINAS_PUBLICAS_REACT) {
        const r = await anon.get(ruta);
        assert.equal(r.status, 200, ruta);
        assert.match(r.headers.get('content-type'), /text\/html/);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.match(r.data, /<div id="raiz"><\/div>/);
        const csp = r.headers.get('content-security-policy');
        assert.match(csp, /script-src 'self'(;|$)/, 'sin unsafe-inline ni unsafe-eval');
        assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    }
    for (const ruta of PAGINAS_PRIVADAS_REACT) {
        const r = await anon.get(ruta);
        assert.equal(r.status, 302, ruta);
        assert.equal(r.headers.get('location'), '/?acceso=login');
    }
    const c = await e.cliente();
    for (const ruta of PAGINAS_PRIVADAS_REACT) assert.equal((await c.get(ruta)).status, 200, ruta);
    // El HTML no lleva scripts en línea (la CSP los bloquearía)
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i);
    assert.doesNotMatch(html, /\sstyle\s*=|<style[\s>]|\son[a-z]+\s*=/i);
});

test('código privado (r/privado): 401 sin sesión, 200 con sesión; el público es inmutable', { skip: omitir }, async () => {
    const privados = fs.readdirSync(path.join(dist, 'r', 'privado'));
    assert.ok(privados.some((f) => f.endsWith('.js')) && privados.some((f) => f.endsWith('.css')), 'hay JS y CSS privados');
    assert.ok(privados.some((f) => f.startsWith('Panel-')) && privados.some((f) => f.startsWith('Configuracion-')), 'las pantallas privadas son privadas');
    const anon = e.sinSesion();
    const c = await e.cliente();
    for (const f of privados) {
        assert.equal((await anon.get(`/r/privado/${f}`)).status, 401, f);
        const r = await c.get(`/r/privado/${f}`);
        assert.equal(r.status, 200, f);
        assert.match(r.headers.get('cache-control'), /private/);
    }
    const publicos = fs.readdirSync(path.join(dist, 'r', 'publico'));
    assert.ok(!publicos.some((f) => /^(Panel|Agenda|Proyectos|Repaso|Configuracion|ChatIA|ZonaPrivada)-/.test(f)), 'ninguna pantalla privada en r/publico');
    const r = await anon.get(`/r/publico/${publicos.find((f) => f.endsWith('.js'))}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /immutable/);
    // Recorrido de carpetas: sin sesión se corta antes (401); con sesión no se sale de r/privado
    assert.equal((await anon.get('/r/privado/..%2f..%2f..%2fserver.js')).status, 401);
    assert.notEqual((await c.get('/r/privado/..%2f..%2f..%2fserver.js')).status, 200);
    assert.equal((await anon.get('/r/publico/no-existe.js')).status, 404);
});

test('todo lo que necesita la zona pública está en r/publico (no depende de código con sesión)', { skip: omitir }, () => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const entrada = html.match(/<script type="module"[^>]*src="\/(r\/publico\/[^"]+\.js)"/)[1];
    const visitados = new Set();
    const pendientes = [entrada];
    const leer = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8');
    let zonaPublica = null;
    while (pendientes.length) {
        const rel = pendientes.pop();
        if (visitados.has(rel)) continue;
        visitados.add(rel);
        assert.ok(rel.startsWith('r/publico/'), `la zona pública carga ${rel}`);
        const codigo = leer(rel);
        // importaciones estáticas (import … from"./x.js" / import"./x.js")
        for (const m of codigo.matchAll(/(?:from|import)\s*["'](\.\.?\/[^"']+\.js)["']/g)) pendientes.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
        // la carga diferida de la zona pública
        const zp = codigo.match(/["'](\.\/ZonaPublica-[\w-]+\.js)["']/);
        if (zp) { zonaPublica = path.posix.join(path.posix.dirname(rel), zp[1]); pendientes.push(zonaPublica); }
    }
    assert.ok(zonaPublica, 'la entrada carga ZonaPublica');
    assert.ok(visitados.size >= 3);
});

test('404: página desconocida → interfaz con estado 404; API desconocida → JSON 404 (nunca el HTML)', { skip: omitir }, async () => {
    const anon = e.sinSesion();
    const pag = await anon.get('/esto-no-existe');
    assert.equal(pag.status, 404);
    assert.match(pag.headers.get('content-type'), /text\/html/);
    const api = await anon.get('/api/esto-no-existe');
    assert.equal(api.status, 404);
    assert.deepEqual(api.data, { error: 'Ruta de API no encontrada.' });
    const post = await anon.post('/esto-no-existe', {});
    assert.equal(post.status, 404);
    assert.match(post.headers.get('content-type'), /json/);
    // Direcciones antiguas siguen redirigiendo y /index.html no se sirve suelto
    const vieja = await anon.get('/calendario.html');
    assert.equal(vieja.status, 301);
    assert.equal(vieja.headers.get('location'), '/calendario');
    assert.equal((await anon.get('/index.html')).status, 301);
    // Las rutas de la interfaz anterior ya no existen
    assert.equal((await anon.get('/app/panel/panel.js')).status, 404);
});

test('PWA: manifiesto, service worker sin caché y precaché SIN datos privados ni HTML', { skip: omitir }, async () => {
    const anon = e.sinSesion();
    const sw = await anon.get('/sw.js');
    assert.equal(sw.status, 200);
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
    assert.equal(sw.headers.get('service-worker-allowed'), '/');
    const precache = [...String(sw.data).matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(precache.length > 5, 'hay recursos precacheados');
    for (const u of precache) {
        assert.doesNotMatch(u, /^r\/privado\/|^\/?api\/|index\.html$/, `precaché: ${u}`);
    }
    assert.ok(precache.includes('offline.html'));
    assert.match(String(sw.data), /NetworkOnly/, 'las navegaciones van siempre a la red');
    const man = await anon.get('/manifest.webmanifest');
    assert.equal(man.status, 200);
    assert.match(man.headers.get('content-type'), /application\/manifest\+json/);
    const m = typeof man.data === 'string' ? JSON.parse(man.data) : man.data;
    assert.equal(m.start_url, '/panel');
    assert.equal(m.display, 'standalone');
    for (const icono of m.icons) {
        const r = await anon.crudo('GET', icono.src);
        assert.equal(r.status, 200, icono.src);
        assert.equal(r.headers.get('content-type'), 'image/png');
    }
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
    assert.equal((await anon.get('/offline.html')).status, 200);
});

test('código fuente React: sin HTML inyectado, sin eval, sin secretos y sin imports privados en la parte pública', () => {
    const fuentes = archivos(src, '.js').concat(archivos(src, '.jsx')).filter((f) => !f.includes(`${path.sep}pruebas${path.sep}`) && !/\.test\.jsx?$/.test(f));
    assert.ok(fuentes.length > 20);
    for (const f of fuentes) {
        const s = sinComentarios(fs.readFileSync(f, 'utf8'));
        const n = path.relative(src, f);
        assert.doesNotMatch(s, /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write|\beval\(|new Function\(/, n);
        assert.doesNotMatch(s, /setAttribute\(\s*['"]style['"]/, `${n}: setAttribute('style') lo bloquea la CSP`);
        assert.doesNotMatch(s, /\bconfirm\(|\balert\(/, `${n}: diálogos del navegador`);
        assert.doesNotMatch(s, /localStorage\.setItem\([^)]*(password|token|sesion|cookie)/i, `${n}: credenciales en localStorage`);
        assert.doesNotMatch(s, /11434|OLLAMA|MONGO_URI|mongodb(\+srv)?:\/\//, `${n}: configuración del servidor en el navegador`);
        // Lo público no importa código privado (solo App.jsx carga la zona privada de forma diferida)
        if (!n.startsWith(`privado${path.sep}`) && n !== 'App.jsx') {
            assert.doesNotMatch(s, /from\s+['"][^'"]*\/privado\//, `${n} importa código privado`);
        }
    }
    const app = fs.readFileSync(path.join(src, 'App.jsx'), 'utf8');
    assert.match(app, /lazy\(\(\) => import\('\.\/privado\/ZonaPrivada\.jsx'\)\)/);
});

test('compilación: sin secretos ni direcciones internas en lo que descarga el navegador', { skip: omitir }, () => {
    for (const f of archivos(dist, '.js').concat(archivos(dist, '.html'), archivos(dist, '.webmanifest'))) {
        const s = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(s, /11434|MONGO_URI|mongodb(\+srv)?:\/\/|OLLAMA_API_BASE|SESSION_SECRET|passwordHash/, path.relative(dist, f));
    }
    assert.ok(!fs.existsSync(path.join(dist, '.env')));
    assert.equal(archivos(dist, '.map').length, 0, 'sin mapas de código fuente en producción');
});
