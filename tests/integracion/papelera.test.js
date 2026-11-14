// Papelera (v3.9): restaurar y eliminar para siempre la SELECCIÓN, y «Vaciar papelera» (deleteMany).
// Seguridad: solo actividades del usuario autenticado que estén EN LA PAPELERA; nunca activas ni de otras personas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, actividadBase } from '../utilidades/entorno.js';
import * as db from '../../backend/datos/index.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

/** Crea n actividades y manda a la papelera las indicadas; devuelve sus ids en orden */
async function preparar(c, titulos, { aPapelera = titulos } = {}) {
    const ids = {};
    for (const t of titulos) {
        const lista = (await c.post('/api/actividades', actividadBase({ titulo: t }))).data;
        ids[t] = lista.find((a) => a.titulo === t).id;
    }
    for (const t of aPapelera) assert.equal((await c.del(`/api/actividades/${ids[t]}`)).status, 200);
    return ids;
}
const titulosPapelera = async (c) => (await c.get('/api/papelera')).data.actividades.map((a) => a.titulo).sort();
const titulosActivas = async (c) => (await c.get('/api/actividades')).data.map((a) => a.titulo).sort();

test('sin sesión: las nuevas operaciones de la papelera dan 401', async () => {
    const s = e.sinSesion();
    assert.equal((await s.post('/api/papelera/restaurar', { ids: ['abc'] })).status, 401);
    assert.equal((await s.delCuerpo('/api/papelera/seleccion', { ids: ['abc'] })).status, 401);
    assert.equal((await s.del('/api/papelera')).status, 401);
});

test('restaurar la selección: vuelven a la agenda solo las seleccionadas y la respuesta trae la lista nueva', async () => {
    const c = await e.cliente();
    const ids = await preparar(c, ['A', 'B', 'C']);
    const r = await c.post('/api/papelera/restaurar', { ids: [ids.A, ids.C] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.restauradas.map((a) => a.titulo).sort(), ['A', 'C']);
    assert.deepEqual(r.data.actividades.map((a) => a.titulo).sort(), ['A', 'C']);
    assert.ok(Array.isArray(r.data.avisos));
    assert.deepEqual(await titulosPapelera(c), ['B']);
    // La restauración individual («Deshacer» y botón de cada fila) sigue funcionando igual
    const una = await c.post(`/api/papelera/${ids.B}/restaurar`);
    assert.equal(una.status, 200); assert.equal(una.data.restaurada.titulo, 'B');
    assert.deepEqual(await titulosActivas(c), ['A', 'B', 'C']);
});

test('restaurar: ids activos o de otra persona se ignoran; si no queda ninguno válido → 404 sin tocar nada', async () => {
    const ana = await e.cliente('Ana');
    const beto = await e.cliente('Beto');
    const deAna = await preparar(ana, ['Ana papelera', 'Ana activa'], { aPapelera: ['Ana papelera'] });
    const deBeto = await preparar(beto, ['Beto papelera']);
    const r = await ana.post('/api/papelera/restaurar', { ids: [deAna['Ana activa'], deBeto['Beto papelera']] });
    assert.equal(r.status, 404);
    assert.deepEqual(await titulosPapelera(beto), ['Beto papelera'], 'lo de Beto sigue en SU papelera');
    const mezcla = await ana.post('/api/papelera/restaurar', { ids: [deAna['Ana papelera'], deBeto['Beto papelera']] });
    assert.equal(mezcla.status, 200);
    assert.deepEqual(mezcla.data.restauradas.map((a) => a.titulo), ['Ana papelera']);
    assert.ok(!JSON.stringify(mezcla.data).includes('Beto'), 'no se revela nada de otra cuenta');
    assert.deepEqual(await titulosPapelera(beto), ['Beto papelera']);
});

test('eliminar para siempre la selección: solo lo seleccionado, solo de la papelera, solo del usuario', async () => {
    const ana = await e.cliente('Ana');
    const beto = await e.cliente('Beto');
    const a = await preparar(ana, ['Uno', 'Dos', 'Tres', 'Activa'], { aPapelera: ['Uno', 'Dos', 'Tres'] });
    const b = await preparar(beto, ['De Beto']);
    const r = await ana.delCuerpo('/api/papelera/seleccion', { ids: [a.Uno, a.Tres, a.Activa, b['De Beto']] });
    assert.equal(r.status, 200);
    assert.equal(r.data.eliminadas, 2, 'la activa y la de Beto no cuentan');
    assert.deepEqual(await titulosPapelera(ana), ['Dos']);
    assert.deepEqual(await titulosActivas(ana), ['Activa'], 'una actividad activa nunca se elimina por esta vía');
    assert.deepEqual(await titulosPapelera(beto), ['De Beto']);
    // Ya no existen en MongoDB (no es otro borrado lógico) y no se pueden restaurar
    assert.equal(await db.modelos.Actividad.countDocuments({ id: db.confiable({ $in: [a.Uno, a.Tres] }) }), 0);
    assert.equal((await ana.post(`/api/papelera/${a.Uno}/restaurar`)).status, 404);
    // Repetirlo no hace nada: 404
    assert.equal((await ana.delCuerpo('/api/papelera/seleccion', { ids: [a.Uno] })).status, 404);
});

test('eliminar para siempre borra también las fotos del diario de deshacer de esas actividades', async () => {
    const c = await e.cliente();
    const ids = await preparar(c, ['Con diario', 'Otra']);
    const userId = c.usuario.id;
    const { Operacion } = db.modelos;
    await Operacion.create([
        { loteId: db.nuevoId(), userId, origen: 'ia', orden: 0, tipo: 'editar', actividadId: ids['Con diario'], antes: { titulo: 'Con diario' } },
        { loteId: db.nuevoId(), userId, origen: 'ia', orden: 0, tipo: 'editar', actividadId: ids.Otra, antes: { titulo: 'Otra' } }
    ]);
    assert.equal((await c.delCuerpo('/api/papelera/seleccion', { ids: [ids['Con diario']] })).data.eliminadas, 1);
    assert.equal(await Operacion.countDocuments({ userId, actividadId: ids['Con diario'] }), 0);
    assert.equal(await Operacion.countDocuments({ userId, actividadId: ids.Otra }), 1, 'lo demás del diario se conserva');
});

test('validación de la selección: lista vacía, no lista, formato, inyección NoSQL y más de 200', async () => {
    const c = await e.cliente();
    for (const cuerpo of [{}, { ids: [] }, { ids: 'abc' }, { ids: [{ $ne: null }] }, { ids: ['../x'] }, { ids: Array.from({ length: 201 }, (_, i) => `id${i}`) }]) {
        assert.equal((await c.post('/api/papelera/restaurar', cuerpo)).status, 400, JSON.stringify(cuerpo).slice(0, 60));
        assert.equal((await c.delCuerpo('/api/papelera/seleccion', cuerpo)).status, 400, JSON.stringify(cuerpo).slice(0, 60));
    }
});

test('vaciar papelera: deleteMany de TODA la papelera del usuario; activas y otras cuentas intactas', async () => {
    const ana = await e.cliente('Ana');
    const beto = await e.cliente('Beto');
    await preparar(ana, ['P1', 'P2', 'P3', 'Sigue activa'], { aPapelera: ['P1', 'P2', 'P3'] });
    await preparar(beto, ['Papelera de Beto', 'Activa de Beto'], { aPapelera: ['Papelera de Beto'] });
    const r = await ana.del('/api/papelera');
    assert.equal(r.status, 200);
    assert.equal(r.data.eliminadas, 3);
    assert.deepEqual(await titulosPapelera(ana), []);
    assert.deepEqual(await titulosActivas(ana), ['Sigue activa']);
    assert.deepEqual(await titulosPapelera(beto), ['Papelera de Beto']);
    assert.deepEqual(await titulosActivas(beto), ['Activa de Beto']);
    const otra = await ana.del('/api/papelera');
    assert.equal(otra.status, 200); assert.equal(otra.data.eliminadas, 0, 'vaciar una papelera vacía no falla');
});

test('origen ajeno (CSRF): vaciar desde otra web se rechaza', async () => {
    const c = await e.cliente();
    await preparar(c, ['Protegida']);
    const r = await c.del('/api/papelera', { cabeceras: { origin: 'https://sitio-malicioso.example' } });
    assert.equal(r.status, 403);
    assert.deepEqual(await titulosPapelera(c), ['Protegida']);
});
