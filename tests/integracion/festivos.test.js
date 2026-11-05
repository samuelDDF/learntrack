// Festivos (Nager.Date simulado): países, regiones, FUSIÓN sin tocar actividades, duplicados, datos externos
// maliciosos, caída del servicio y aislamiento entre usuarios.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, actividadBase } from '../utilidades/entorno.js';

let e;
const AÑO = new Date().getFullYear();
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

test('sin sesión: las rutas de festivos dan 401', async () => {
    const s = e.sinSesion();
    for (const [m, r] of [['get', '/api/festivos'], ['get', '/api/festivos/paises'], ['post', '/api/festivos/importar'], ['del', '/api/festivos']]) {
        assert.equal((await s[m](r)).status, 401, `${m} ${r}`);
    }
});

test('países y regiones vienen del servicio y se validan', async () => {
    const c = await e.cliente();
    const p = await c.get('/api/festivos/paises');
    assert.equal(p.status, 200);
    assert.deepEqual(p.data.paises.map((x) => x.codigo), ['CO', 'ES']);
    assert.deepEqual((await c.get(`/api/festivos/regiones?pais=ES&anio=${AÑO}`)).data.regiones, ['ES-CT', 'ES-MD']);
    assert.deepEqual((await c.get(`/api/festivos/regiones?pais=CO&anio=${AÑO}`)).data.regiones, [], 'Colombia: solo festivos nacionales');
    assert.equal((await c.get(`/api/festivos/regiones?pais=colombia&anio=${AÑO}`)).status, 400);
    assert.equal((await c.get('/api/festivos/regiones?pais=CO&anio=1999')).status, 400);
});

test('CRÍTICO: importar festivos NO crea, cambia ni borra ninguna actividad (aunque coincidan fecha y título)', async () => {
    const c = await e.cliente();
    // una actividad el mismo día y con el mismo nombre que un festivo, otra cualquiera y otra en la papelera
    await c.post('/api/actividades', actividadBase({ titulo: 'Navidad', fecha_inicio: `${AÑO}-12-25`, fecha_fin: `${AÑO}-12-25`, hora_inicio: '10:00', hora_fin: '12:00' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Estudiar', fecha_inicio: `${AÑO}-07-20`, fecha_fin: `${AÑO}-07-21` }));
    const borrar = (await c.post('/api/actividades', actividadBase({ titulo: 'En papelera' }))).data.at(-1);
    await c.del(`/api/actividades/${borrar.id}`);
    const { modelos } = await import('../../backend/datos/index.js');
    const foto = async () => JSON.stringify(await modelos.Actividad.find({ userId: c.usuario.id }).sort({ id: 1 }).lean());
    const antes = await foto();

    const r = await c.post('/api/festivos/importar', { pais: 'CO', anio: AÑO });
    assert.equal(r.status, 201);
    assert.equal(r.data.añadidos, 4, 'los 4 festivos válidos (el de fecha rota se descarta)');
    assert.equal(await foto(), antes, 'las actividades quedan exactamente iguales, byte a byte');
    assert.equal((await c.get('/api/actividades')).data.length, 2);
    assert.equal((await c.get('/api/papelera')).data.actividades.length, 1);
    // los festivos son otra cosa: no aparecen como actividades y se distinguen por su tipo
    const festivos = (await c.get('/api/festivos')).data.festivos;
    assert.ok(festivos.every((f) => f.tipo === 'festivo' && f.pais === 'CO'));
    assert.ok(festivos.some((f) => f.nombre === 'Navidad' && f.fecha === `${AÑO}-12-25`));
});

test('fusión idempotente: importar dos veces no duplica; otra región solo añade lo suyo', async () => {
    const c = await e.cliente();
    const r1 = await c.post('/api/festivos/importar', { pais: 'ES', region: 'ES-MD', anio: AÑO });
    assert.equal(r1.data.añadidos, 2);                                   // Año Nuevo + Madrid
    const r2 = await c.post('/api/festivos/importar', { pais: 'ES', region: 'ES-MD', anio: AÑO });
    assert.equal(r2.data.añadidos, 0); assert.equal(r2.data.yaExistian, 2);
    const r3 = await c.post('/api/festivos/importar', { pais: 'ES', region: 'ES-CT', anio: AÑO });
    assert.equal(r3.data.añadidos, 1, 'Año Nuevo (nacional) ya estaba; solo se añade la Diada');
    const lista = (await c.get('/api/festivos')).data.festivos;
    assert.equal(lista.length, 3);
    assert.deepEqual(lista.map((f) => f.region), [null, 'ES-MD', 'ES-CT']);
    // dos importaciones a la vez tampoco duplican (inserción atómica «si no existe»)
    const otro = await e.cliente();
    await Promise.all([otro.post('/api/festivos/importar', { pais: 'CO', anio: AÑO }), otro.post('/api/festivos/importar', { pais: 'CO', anio: AÑO })]);
    assert.equal((await otro.get('/api/festivos')).data.festivos.length, 4);
});

test('los datos externos no son confiables: nombres limpios y fechas inválidas descartadas', async () => {
    const c = await e.cliente();
    await c.post('/api/festivos/importar', { pais: 'CO', anio: AÑO });
    const nombres = (await c.get('/api/festivos')).data.festivos.map((f) => f.nombre);
    assert.ok(nombres.every((n) => !/[<>]|script|alert/.test(n)), nombres.join(' | '));
    assert.ok(nombres.includes('Todos los Santos'), 'se quita la etiqueta y su contenido, no el texto legítimo');
    assert.ok(!nombres.includes('Roto'));
});

test('consulta por rango y quitar festivos (por país o todos) sin tocar actividades', async () => {
    const c = await e.cliente();
    await c.post('/api/actividades', actividadBase({ titulo: 'Mía' }));
    await c.post('/api/festivos/importar', { pais: 'CO', anio: AÑO });
    await c.post('/api/festivos/importar', { pais: 'ES', anio: AÑO });
    assert.equal((await c.get(`/api/festivos?desde=${AÑO}-07-01&hasta=${AÑO}-07-31`)).data.festivos.length, 1);
    assert.equal((await c.get('/api/festivos?desde=ayer')).status, 400);
    const quitado = await c.del('/api/festivos?pais=ES');
    assert.equal(quitado.data.eliminados, 1);
    assert.equal((await c.del('/api/festivos')).data.eliminados, 4);
    assert.equal((await c.get('/api/festivos')).data.festivos.length, 0);
    assert.equal((await c.get('/api/actividades')).data.length, 1);
});

test('validación de la importación', async () => {
    const c = await e.cliente();
    for (const cuerpo of [{}, { pais: 'Colombia', anio: AÑO }, { pais: 'CO', anio: 1990 }, { pais: 'ES', region: 'FR-X', anio: AÑO }, { pais: { $ne: 1 }, anio: AÑO }, []]) {
        assert.equal((await c.post('/api/festivos/importar', cuerpo)).status, 400, JSON.stringify(cuerpo));
    }
    assert.equal((await c.post('/api/festivos/importar', { pais: 'ZZ', anio: AÑO })).status, 404, 'país sin datos');
});

test('si Nager.Date no responde: 503 claro y nada cambia', async () => {
    const c = await e.cliente();
    e.externas.estado.caido = true;
    try {
        const r = await c.post('/api/festivos/importar', { pais: 'CO', anio: AÑO });
        assert.equal(r.status, 503); assert.match(r.data.error, /no está disponible/);
        assert.equal((await c.get('/api/festivos')).data.festivos.length, 0);
    } finally { e.externas.estado.caido = false; }
});

test('los festivos de un usuario no los ve otro y se borran con la cuenta', async () => {
    const a = await e.cliente(); const b = await e.cliente();
    await a.post('/api/festivos/importar', { pais: 'CO', anio: AÑO });
    assert.equal((await b.get('/api/festivos')).data.festivos.length, 0);
    assert.equal((await a.get('/api/auth/me')).data.usuario.eventosImportados, undefined, 'no viajan en cada petición');
});
