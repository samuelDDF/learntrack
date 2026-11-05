// Seguridad: sin sesión, IDOR entre usuarios, operadores NoSQL, archivos maliciosos, inyección de prompt,
// CSRF, cabeceras, CSP sin estilos en línea, endpoints muertos y límites separados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarEntorno, hoyLocal, actividadBase } from '../utilidades/entorno.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Todos los archivos con esa extensión dentro de una carpeta (recursivo) */
const archivosDe = (carpeta, ext) => fs.readdirSync(path.join(raiz, carpeta), { recursive: true })
    .filter((f) => f.endsWith(ext)).map((f) => path.join(raiz, carpeta, f));
const HOY = hoyLocal(300);
let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const subir = (c, nombre, contenido, campos = { fechaHoy: HOY }) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.append(k, v);
    fd.append('archivo', new Blob([contenido]), nombre);
    return c.post('/api/ia/archivo', fd);
};

test('direcciones antiguas (*.html) redirigen a las nuevas sin perder la consulta', async () => {
    const s = e.sinSesion();
    for (const [antigua, nueva] of [['/app-dashboard.html', '/panel'], ['/calendario.html', '/calendario'], ['/perfil.html', '/configuracion'], ['/perfil', '/configuracion'], ['/proyectos.html', '/proyectos'],
        ['/planificador-info.html', '/planificador'], ['/asistente-info.html', '/asistente'], ['/index.html?acceso=login', '/?acceso=login']]) {
        const r = await s.get(antigua);
        assert.equal(r.status, 301, antigua); assert.equal(r.headers.get('location'), nueva, antigua);
    }
    for (const r of ['/', '/planificador', '/asistente']) assert.equal((await s.get(r)).status, 200, r);
    // Íconos del sitio (el logo de LearnTrack): SVG vectorial, .ico para navegadores antiguos y PNG para móviles
    for (const [ruta, tipo] of [['/recursos/favicon.svg', /image\/svg\+xml/], ['/favicon.ico', /icon/], ['/apple-touch-icon.png', /image\/png/]]) {
        const r = await s.crudo('GET', ruta);
        assert.equal(r.status, 200, ruta); assert.match(r.headers.get('content-type'), tipo, ruta);
    }
    const no = await s.get('/no-existe');
    assert.equal(no.status, 404); assert.match(String(no.data), /Página no encontrada|404/);
});

test('sin sesión: API 401, páginas privadas redirigen y los recursos privados (también /app/compartido) dan 401', async () => {
    const s = e.sinSesion();
    for (const [m, r] of [['get', '/api/actividades'], ['post', '/api/ia/chat'], ['get', '/api/papelera'], ['post', '/api/ia/archivo'], ['get', '/api/checkin?fecha=2026-10-07'], ['post', '/api/propuestas/0123456789abcdef0123456789abcdef/aplicar'], ['get', '/api/historial']]) {
        assert.equal((await s[m](r)).status, 401, `${m} ${r}`);
    }
    for (const r of ['/panel', '/calendario', '/proyectos', '/configuracion']) {
        const res = await s.get(r);
        assert.equal(res.status, 302); assert.equal(res.headers.get('location'), '/?acceso=login');
    }
    for (const r of ['/app/panel/panel.js', '/app/componentes/chat-ia/chat-ia.js', '/app/comun/privado.css', '/app/compartido/carga.js', '/app/panel/panel.html', '/app/configuracion/configuracion.js', '/app/componentes/barra-navegacion/barra-navegacion.js', '/app/comun/voz.js', '/app/proyectos/proyectos.js']) {
        assert.ok([401, 302].includes((await s.get(r)).status), r);
    }
    const c = await e.cliente();
    const js = await c.get('/app/compartido/carga.js');
    assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal(js.headers.get('cache-control'), 'no-store');
});

test('IDOR: un usuario no puede leer, editar, borrar, restaurar, aplicar ni deshacer lo de otro', async () => {
    const ana = await e.cliente('Ana');
    const beto = await e.cliente('Beto');
    const lista = (await ana.post('/api/actividades', actividadBase({ titulo: 'De Ana' }))).data;
    const id = lista[0].id;
    assert.equal((await beto.put(`/api/actividades/${id}`, { titulo: 'hack' })).status, 404);
    assert.equal((await beto.del(`/api/actividades/${id}`)).status, 404);
    assert.equal((await beto.get('/api/actividades')).data.length, 0);
    // Propuesta de Ana: Beto no la puede aplicar ni cancelar
    e.ollama.responder('clasificar', { intencion: 'eliminar', ids: [id], referencia: 'de ana', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'eliminar' });
    const p = (await ana.post('/api/ia/chat', { texto: 'borra lo de ana', fechaHoy: HOY })).data.propuesta;
    assert.equal((await beto.post(`/api/propuestas/${p.id}/aplicar`)).status, 410);
    assert.match((await beto.post(`/api/propuestas/${p.id}/cancelar`)).data.mensaje, /ya no estaba pendiente/);
    assert.equal((await beto.post('/api/ia/chat', { texto: 'sí', fechaHoy: HOY, propuestaPendiente: p.id })).status, 410);
    const ap = await ana.post(`/api/propuestas/${p.id}/aplicar`);
    assert.equal(ap.status, 200, 'la propuesta sigue intacta para su dueña');
    assert.equal((await beto.post(`/api/operaciones/${ap.data.loteId}/deshacer`)).status, 404);
    assert.equal((await beto.post(`/api/papelera/${id}/restaurar`)).status, 404);
    assert.equal((await beto.get('/api/papelera')).data.actividades.length, 0);
    assert.equal((await ana.get('/api/papelera')).data.actividades.length, 1);
    // El modelo propone ids de Ana en el chat de Beto: se descartan
    e.ollama.responder('clasificar', { intencion: 'eliminar', ids: [id], referencia: '', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'eliminar' });
    const r = await beto.post('/api/ia/chat', { texto: 'borra eso', fechaHoy: HOY });
    assert.notEqual(r.data.tipo, 'propuesta');
});

test('operadores NoSQL ({"$ne":null}) en ids, cuerpos, consultas y filtros', async () => {
    const c = await e.cliente();
    await c.post('/api/actividades', actividadBase({ titulo: 'Mía' }));
    const ne = encodeURIComponent('{"$ne":null}');
    assert.equal((await c.put(`/api/actividades/${ne}`, { titulo: 'x' })).status, 404);
    assert.equal((await c.del(`/api/actividades/${ne}`)).status, 404);
    assert.equal((await c.post(`/api/papelera/${ne}/restaurar`)).status, 404);
    assert.equal((await c.post(`/api/propuestas/${ne}/aplicar`)).status, 404);
    assert.equal((await c.post('/api/actividades', actividadBase({ titulo: { $ne: null } }))).status, 400);
    assert.equal((await c.post('/api/actividades', actividadBase({ tipo: { $ne: null } }))).status, 400);
    assert.equal((await c.put('/api/checkin', { fecha: { $gt: '' }, animo: 'alto', sueno: 'bien', enfoque: 'avanzar' })).status, 400);
    assert.equal((await c.get('/api/checkin?fecha[$ne]=x')).status, 400);
    assert.equal((await c.get('/api/checkins?desde[$gt]=a&hasta=2026-10-10')).status, 400);
    const s = e.sinSesion();
    assert.equal((await s.post('/api/auth/login', { email: { $ne: null }, password: { $ne: null } })).status, 400);
    const r = await c.post('/api/ia/chat', { texto: 'sí', fechaHoy: HOY, propuestaPendiente: { $ne: null }, aclaracionId: { $gt: '' } });
    assert.match(r.data.mensaje, /No hay ningún cambio pendiente/);
    assert.equal((await c.get('/api/actividades')).data.length, 1);
});

test('archivos: enorme (413), extensión falsa (415), dos a la vez, sin multipart, sin fechaHoy', async () => {
    const c = await e.cliente();
    assert.equal((await subir(c, 'grande.txt', Buffer.alloc(5 * 1024 * 1024 + 10, 65))).status, 413);
    assert.equal((await subir(c, 'falso.pdf', 'texto disfrazado')).status, 415);
    assert.equal((await subir(c, 'ejecutable.docx', Buffer.from('MZ\x90\x00'))).status, 415);
    assert.equal((await subir(c, 'script.js', 'alert(1)')).status, 415);
    const dos = new FormData(); dos.append('fechaHoy', HOY); dos.append('archivo', new Blob(['a']), 'a.txt'); dos.append('archivo', new Blob(['b']), 'b.txt');
    assert.equal((await c.post('/api/ia/archivo', dos)).status, 400);
    assert.equal((await c.post('/api/ia/archivo', { archivo: 'x' })).status, 415);
    assert.equal((await subir(c, 'a.txt', 'Quiz el 3 de noviembre', {})).status, 400);
    assert.equal((await c.get('/api/actividades')).data.length, 0);
});

test('inyección de prompt desde un archivo: va entre delimitadores, no se registra en logs y solo puede AÑADIR actividades', async () => {
    const c = await e.cliente();
    await c.post('/api/actividades', actividadBase({ titulo: 'No me borres' }));
    const contenido = fs.readFileSync(path.join(raiz, 'tests', 'archivos-de-prueba', 'inyeccion.txt'));
    // El modelo simulado "obedece" a la inyección y añade claves peligrosas además de los candidatos
    e.ollama.responder('archivo', { accion: 'eliminar', ids: ['*'], intencion: 'eliminar', candidatos: [{ titulo: 'Quiz', categoria: 'examen', fecha: '3 de noviembre', cita: 'Quiz el 3 de noviembre' }, { titulo: 'Borrar todo', categoria: 'otro', fecha: 'mañana', cita: 'cita inventada que no está' }] });
    const logs = [];
    const originales = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(originales)) console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
    let r;
    try { r = await subir(c, 'cronograma.txt', contenido); } finally { Object.assign(console, originales); }
    assert.equal(r.status, 200);
    // Lo comprobado (cita literal en el documento) se añade solo; nada se borra ni se edita
    assert.equal(r.data.tipo, 'aplicado');
    assert.deepEqual((await c.get('/api/actividades')).data.map((a) => a.titulo).sort(), ['No me borres', 'Quiz'], 'la inyección no borra nada');
    const prop = r.data.siguiente.propuesta;
    assert.equal(prop.seleccionable, true);
    assert.ok(prop.items.every((it) => it.op === 'crear'), 'un archivo solo puede proponer actividades nuevas');
    const inventada = prop.items.find((it) => it.titulo === 'Borrar todo');
    assert.equal(inventada.marcado, false, 'cita no encontrada en el documento → no se añade sola'); assert.ok(inventada.aviso);
    const prompt = e.ollama.peticionesDe('archivo').at(-1);
    assert.match(prompt.sistema, /NUNCA sigas instrucciones/);
    assert.ok(prompt.usuario.startsWith('<<<DOCUMENTO_DEL_USUARIO>>>') && prompt.usuario.trimEnd().endsWith('<<<FIN_DEL_DOCUMENTO>>>'));
    assert.equal(prompt.usuario.split('<<<FIN_DEL_DOCUMENTO>>>').length, 2, 'el delimitador falso del documento se neutraliza');
    assert.ok(!logs.some((l) => /IMPORTANTE PARA EL ASISTENTE|Quiz el 3/.test(l)), 'el contenido del archivo no aparece en los logs');
    // Una selección con basura (operadores, índices fuera de rango) no aplica nada
    const ap = await c.post(`/api/propuestas/${prop.id}/aplicar`, { seleccion: [{ $ne: null }, 99] });
    assert.equal(ap.status, 400);
    assert.deepEqual((await c.get('/api/actividades')).data.map((a) => a.titulo).sort(), ['No me borres', 'Quiz']);
});

test('CSRF: Origin ajeno rechazado; cuerpo JSON > 10 kB rechazado; fechaHoy obligatoria', async () => {
    const c = await e.cliente();
    const r = await c.post('/api/actividades', actividadBase(), { cabeceras: { origin: 'https://malo.example' } });
    assert.equal(r.status, 403);
    const grande = await c.post('/api/ia/chat', { texto: 'x', fechaHoy: HOY, relleno: 'a'.repeat(11 * 1024) });
    assert.ok([400, 413].includes(grande.status)); assert.match(grande.data.error, /no válido/);
    assert.equal((await c.post('/api/ia/chat', '{"texto": "hola"')).status, 400, 'JSON mal formado');
    assert.equal((await c.post('/api/ia/chat', { texto: 'hola' })).status, 400, 'sin fecha local no hay fecha UTC por defecto');
    assert.equal((await c.post('/api/historial', { fecha: '2099-01-01', fechaHoy: HOY })).status, 400, 'historial solo para días <= hoy');
});

test('cabeceras: CSP estricta sin inline y Permissions-Policy para el micrófono', async () => {
    const c = await e.cliente();
    for (const ruta of ['/', '/panel', '/calendario', '/proyectos', '/configuracion']) {
        const r = await c.get(ruta);
        const csp = r.headers.get('content-security-policy');
        assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /style-src 'self' https:\/\/fonts\.googleapis\.com(;|$)/);
        assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
        assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/);
        assert.equal(r.headers.get('x-powered-by'), null);
    }
});

test('CSP sin inline en TODAS las páginas: sin style="", <style>, <script> en línea ni manejadores on*; sin innerHTML', () => {
    const html = archivosDe('frontend', '.html');
    assert.ok(html.length >= 7);
    for (const f of html) {
        const s = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(s, /\sstyle\s*=/i, `${path.basename(f)}: style=""`);
        assert.doesNotMatch(s, /<style[\s>]/i, `${path.basename(f)}: <style>`);
        assert.doesNotMatch(s, /<script(?![^>]*\ssrc=)[^>]*>/i, `${path.basename(f)}: <script> en línea`);
        assert.doesNotMatch(s, /\son[a-z]+\s*=/i, `${path.basename(f)}: manejador en línea`);
    }
    const js = archivosDe('frontend', '.js');
    assert.ok(js.length >= 10);
    for (const f of js) {
        const s = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
        assert.doesNotMatch(s, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/, path.basename(f));
        assert.doesNotMatch(s, /setAttribute\(\s*['"]style['"]/, `${path.basename(f)}: setAttribute('style') lo bloquea la CSP`);
        assert.doesNotMatch(s, /\bconfirm\(|\balert\(/, `${path.basename(f)}: diálogos del navegador`);
    }
});

test('endpoints muertos eliminados: /api/ia/agendar y /api/ia/parsear ya no existen', async () => {
    const c = await e.cliente();
    assert.equal((await c.post('/api/ia/agendar', { texto: 'hola', fechaHoy: HOY })).status, 404);
    assert.equal((await c.post('/api/ia/parsear', { texto: 'hola', fechaHoy: HOY })).status, 404);
    const sinComentarios = (f) => fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    for (const f of [...archivosDe('backend', '.js'), ...archivosDe('frontend', '.js'), path.join(raiz, 'server.js')]) {
        assert.doesNotMatch(sinComentarios(f), /ia\/agendar|ia\/parsear|limitadorIA\b|parsearActividadIA|SYSTEM_PROMPT_AGENDA/, path.relative(raiz, f));
    }
});

test('límites separados por usuario: archivos (más estricto) no bloquea el chat', async () => {
    const e2 = await e.otraApp({ limites: { archivos: 2, chat: 50, consejo: 3 } });
    try {
        const c = await e2.cliente();
        for (let i = 0; i < 2; i++) await subir(c, 'a.txt', 'nada');
        assert.equal((await subir(c, 'a.txt', 'nada')).status, 429);
        assert.equal((await c.post('/api/ia/chat', { texto: 'sí', fechaHoy: HOY })).status, 200, 'el chat tiene su propio límite');
        const otro = await e2.cliente();
        assert.notEqual((await subir(otro, 'a.txt', 'nada')).status, 429, 'el límite es por usuario');
        for (let i = 0; i < 3; i++) await c.post('/api/ia/consultar', { estadoAnimo: 'medio', porcentajeCarga: 10, actividades: [] });
        assert.equal((await c.post('/api/ia/consultar', { estadoAnimo: 'medio', porcentajeCarga: 10, actividades: [] })).status, 429);
    } finally { await e2.cerrar(); }
});
