// Apariencia y voz: temas nuevos, paleta con Colormind (simulado) y su respaldo local, fondo con multer, voz del
// asistente y migración del campo antiguo temaEstetico.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno } from '../utilidades/entorno.js';
import { variablesDePaleta, paletaArmonica, contraste } from '../../compartido/paleta.js';

let e;
before(async () => { e = await iniciarEntorno({ limites: { perfilSensible: 100 } }); });
after(async () => { await e.cerrar(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const subirFondo = (c, contenido, nombre = 'fondo.png', campo = 'imagen') => {
    const fd = new FormData();
    fd.append(campo, new Blob([contenido]), nombre);
    return c.post('/api/perfil/fondo', fd);
};

test('temas predeterminados nuevos: Moderno, Oscuro Profundo y Futurista', async () => {
    const c = await e.cliente();
    for (const tema of ['moderno', 'oscuro-profundo', 'futurista', 'tech-focus']) {
        const r = await c.put('/api/perfil', { temaSeleccionado: tema });
        assert.equal(r.status, 200, tema); assert.equal(r.data.perfil.temaSeleccionado, tema);
    }
    assert.equal((await c.put('/api/perfil', { temaSeleccionado: 'personalizado' })).status, 400, 'sin paleta no hay tema personalizado');
});

test('paleta con Colormind: el servidor hace el POST con la semilla y devuelve 5 colores + variables', async () => {
    const c = await e.cliente();
    const r = await c.post('/api/perfil/paleta', { color: '#2563EB' });
    assert.equal(r.status, 200);
    assert.equal(r.data.fuente, 'colormind');
    assert.equal(r.data.colores.length, 5); assert.equal(r.data.colores[0], '#2563eb', 'la semilla se respeta');
    assert.ok(r.data.variables['--color-primario']);
    const peticion = e.externas.estado.peticiones.filter((p) => p.url.startsWith('/colormind')).at(-1);
    assert.equal(peticion.metodo, 'POST');
    assert.deepEqual(JSON.parse(peticion.cuerpo), { model: 'default', input: [[37, 99, 235], 'N', 'N', 'N', 'N'] });
    // guardar y usar la paleta
    const g = await c.put('/api/perfil', { temaSeleccionado: 'personalizado', coloresPersonalizados: r.data.colores });
    assert.equal(g.status, 200);
    const me = (await c.get('/api/auth/me')).data.usuario;
    assert.equal(me.temaSeleccionado, 'personalizado');
    assert.equal(me.variablesTema['--color-primario'], g.data.perfil.variablesTema['--color-primario']);
});

test('si Colormind no responde se usa una paleta armónica local (y se dice)', async () => {
    const c = await e.cliente();
    e.externas.estado.colormindCaido = true;
    try {
        const r = await c.post('/api/perfil/paleta', { color: '#ff0000' });
        assert.equal(r.status, 200); assert.equal(r.data.fuente, 'local'); assert.equal(r.data.colores.length, 5);
    } finally { e.externas.estado.colormindCaido = false; }
    for (const malo of [{}, { color: 'rojo' }, { color: '#fff' }, { color: { $ne: 1 } }]) {
        assert.equal((await c.post('/api/perfil/paleta', malo)).status, 400, JSON.stringify(malo));
    }
    for (const malos of [['#fff'], ['#ffffff', '#000000'], ['x', 'y', 'z', 'w', 'v'], 'texto']) {
        assert.equal((await c.put('/api/perfil', { coloresPersonalizados: malos })).status, 400, JSON.stringify(malos));
    }
});

test('cualquier paleta produce un tema legible (contraste WCAG)', () => {
    for (const semilla of ['#ffff00', '#000000', '#ffffff', '#ff0000', '#00ff88', '#7a7a7a', '#1d4ed8']) {
        const v = variablesDePaleta(paletaArmonica(semilla));
        assert.ok(contraste(v['--color-texto'], v['--color-fondo']) >= 7, `${semilla}: texto`);
        assert.ok(contraste(v['--color-primario'], v['--color-superficie']) >= 4.5, `${semilla}: primario`);
        assert.ok(contraste(v['--sobre-primario'], v['--color-primario']) >= 4.5, `${semilla}: texto sobre primario`);
    }
});

test('fondo personalizado (multer): subir, servir solo al dueño, validar firma y tamaño, quitar', async () => {
    const c = await e.cliente(); const otro = await e.cliente();
    const r = await subirFondo(c, PNG);
    assert.equal(r.status, 201);
    assert.match(r.data.perfil.imagenFondoUrl, /^\/api\/perfil\/fondo\?v=\d+$/);
    assert.equal((await c.get('/api/auth/me')).data.usuario.imagenFondoUrl, r.data.perfil.imagenFondoUrl);
    const img = await c.crudo('GET', r.data.perfil.imagenFondoUrl);
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await otro.get('/api/perfil/fondo')).status, 404, 'cada uno ve solo su fondo');

    assert.equal((await subirFondo(c, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png')).status, 415);
    assert.equal((await subirFondo(c, Buffer.concat([PNG, Buffer.alloc(1.6 * 1024 * 1024)]))).status, 413);
    assert.equal((await subirFondo(c, PNG, 'f.png', 'otro')).status, 400, 'campo equivocado');
    assert.equal((await c.post('/api/perfil/fondo', { imagen: 'x' })).status, 415, 'debe ser multipart');

    const q = await c.del('/api/perfil/fondo');
    assert.equal(q.data.perfil.imagenFondoUrl, null);
    assert.equal((await c.get('/api/perfil/fondo')).status, 404);
});

test('voz del asistente: se guarda en la cuenta y llega a todas las páginas por /api/auth/me', async () => {
    const c = await e.cliente();
    const r = await c.put('/api/perfil', { vozAsistente: 'Google español de Estados Unidos' });
    assert.equal(r.status, 200); assert.equal(r.data.perfil.vozAsistente, 'Google español de Estados Unidos');
    assert.equal((await c.get('/api/auth/me')).data.usuario.vozAsistente, 'Google español de Estados Unidos');
    assert.equal((await c.put('/api/perfil', { vozAsistente: 'x'.repeat(201) })).status, 400);
    assert.equal((await c.put('/api/perfil', { vozAsistente: { $ne: 1 } })).status, 400);
    assert.equal((await c.put('/api/perfil', { vozAsistente: '' })).data.perfil.vozAsistente, '', 'vacío = voz del navegador');
});

test('cuentas vinculadas nuevas: GitHub, Steam y Xbox', async () => {
    const c = await e.cliente();
    for (const s of ['github', 'steam', 'xbox']) {
        const r = await c.post('/api/perfil/vincular', { servicio: s });
        assert.equal(r.status, 201, s); assert.equal(r.data.perfil.cuentasVinculadas[s].vinculada, true);
    }
    const nombres = (await c.get('/api/perfil')).data.integraciones.servicios.map((x) => x.nombre);
    assert.deepEqual(nombres, ['YouTube', 'GitHub', 'Discord', 'Spotify', 'Steam', 'Xbox']);
});

test('migración: los usuarios con el campo antiguo temaEstetico pasan a temaSeleccionado', async () => {
    const { modelos, migrarTemaAntiguoBD } = await import('../../backend/datos/index.js');
    const c = await e.cliente();
    await modelos.Usuario.collection.updateOne({ id: c.usuario.id }, { $set: { temaEstetico: 'zen-calm' }, $unset: { temaSeleccionado: '' } });
    const r = await migrarTemaAntiguoBD();
    assert.ok(r.migrados >= 1);
    const doc = await modelos.Usuario.collection.findOne({ id: c.usuario.id });
    assert.equal(doc.temaSeleccionado, 'zen-calm'); assert.equal(doc.temaEstetico, undefined);
    assert.equal((await migrarTemaAntiguoBD()).migrados, 0, 'idempotente');
});
