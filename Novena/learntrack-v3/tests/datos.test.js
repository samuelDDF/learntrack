// Capa de datos contra una base de pruebas (ver tests/helpers/entorno.js: MONGO_URI_TEST, mongodb-memory-server
// o el servidor de pruebas en memoria, que NO es MongoDB real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { conectarBD } from './helpers/entorno.js';
import * as db from '../src/database.js';

let bd;
before(async () => { bd = await conectarBD({ replicaSet: true }); });
after(async () => { await bd.cerrar(); });

const nueva = (userId, extra = {}) => ({ id: db.nuevoId(), titulo: 'Tarea', tipo: 'estudio', exigencia: 2, horas: 1, fecha: '2026-10-07', fecha_inicio: '2026-10-07', fecha_fin: '2026-10-07', hora_inicio: null, hora_fin: null, estado: 'pendiente', proyecto: '', ...extra });

test('borrado lógico: las lecturas filtran { eliminadaEn: null } (también documentos antiguos sin el campo)', async () => {
    const u = db.nuevoId();
    const a = nueva(u, { titulo: 'Activa' });
    const b = nueva(u, { titulo: 'Para borrar' });
    await db.guardarActividadBD(u, a);
    await db.guardarActividadBD(u, b);
    // Documento antiguo SIN el campo eliminadaEn (como los importados de data_store.json)
    await db.modelos.Actividad.collection.insertOne({ id: db.nuevoId(), userId: u, titulo: 'Antigua', tipo: 'ocio', exigencia: -2, horas: 1, fecha: '2026-10-01' });
    let lista = await db.eliminarActividadBD(u, b.id);
    assert.deepEqual(lista.map((x) => x.titulo).sort(), ['Activa', 'Antigua']);
    const papelera = await db.obtenerPapeleraBD(u);
    assert.equal(papelera.length, 1); assert.equal(papelera[0].titulo, 'Para borrar'); assert.ok(papelera[0].purgaEn > papelera[0].eliminadaEn);
    assert.equal(await db.actualizarActividadBD(u, b.id, { titulo: 'x' }), null, 'no se edita algo que está en la papelera');
    assert.equal(await db.eliminarActividadBD(u, b.id), null, 'no se borra dos veces');
    const restaurada = await db.restaurarActividadBD(u, b.id);
    assert.equal(restaurada.titulo, 'Para borrar');
    assert.equal((await db.obtenerActividadesBD(u)).length, 3);
    assert.equal(await db.restaurarActividadBD(db.nuevoId(), a.id), null, 'otro usuario no puede restaurar');
});

test('backfill idempotente de fechas para datos importados (solo `fecha`)', async () => {
    const u = db.nuevoId();
    await db.modelos.Actividad.collection.insertMany([
        { id: db.nuevoId(), userId: u, titulo: 'Vieja 1', tipo: 'estudio', exigencia: 2, horas: 1, fecha: '2026-09-01' },
        { id: db.nuevoId(), userId: u, titulo: 'Vieja 2', tipo: 'estudio', exigencia: 2, horas: 1, fecha: '2026-09-02', fecha_fin: '2026-08-01' }
    ]);
    const r1 = await db.backfillActividadesBD();
    assert.ok(r1.actualizadas >= 2);
    const crudas = await db.modelos.Actividad.collection.find({ userId: u }).toArray();
    for (const c of crudas) {
        assert.equal(c.fecha_inicio, c.fecha); assert.ok(c.fecha_fin >= c.fecha_inicio);
        assert.equal(c.estado, 'pendiente'); assert.equal(c.proyecto, ''); assert.equal(c.hora_inicio, null); assert.equal(c.fija, false);
    }
    const r2 = await db.backfillActividadesBD();
    assert.equal(r2.actualizadas, 0, 'idempotente');
});

test('índice TTL de la papelera: se crea con PAPELERA_DIAS y se ajusta con collMod si cambia', async () => {
    const leer = async () => (await db.modelos.Actividad.collection.indexes()).find((i) => i.key.eliminadaEn === 1);
    assert.equal((await leer()).expireAfterSeconds, 30 * 86400);
    process.env.PAPELERA_DIAS = '7';
    const r = await db.asegurarTtlPapelera();
    assert.equal(r.actualizado, true);
    assert.equal((await leer()).expireAfterSeconds, 7 * 86400);
    assert.equal((await db.asegurarTtlPapelera()).sinCambios, true);
    delete process.env.PAPELERA_DIAS;
    await db.asegurarTtlPapelera();
    const propuestas = (await db.modelos.Propuesta.collection.indexes()).find((i) => i.key.expira === 1);
    assert.equal(propuestas.expireAfterSeconds, 0, 'TTL de propuestas');
});

test('check-in: uno por usuario y día (sin mezclar usuarios del mismo navegador)', async () => {
    const u1 = db.nuevoId(), u2 = db.nuevoId();
    await db.guardarCheckinBD(u1, { fecha: '2026-10-07', animo: 'bajo', sueno: 'mal', enfoque: 'descansar' });
    await db.guardarCheckinBD(u1, { fecha: '2026-10-07', animo: 'alto', sueno: 'bien', enfoque: 'avanzar' });
    await db.guardarCheckinBD(u2, { fecha: '2026-10-07', animo: 'medio', sueno: 'bien', enfoque: 'mantener' });
    assert.equal((await db.obtenerCheckinBD(u1, '2026-10-07')).animo, 'alto');
    assert.equal((await db.obtenerCheckinBD(u2, '2026-10-07')).animo, 'medio');
    assert.equal((await db.obtenerCheckinsBD(u1, '2026-10-01', '2026-10-31')).length, 1);
    await assert.rejects(db.modelos.Checkin.create({ userId: u1, fecha: '2026-10-07', animo: 'alto', sueno: 'bien', enfoque: 'avanzar' }), (e) => e.code === 11000);
});

test('propuestas: un solo uso, del usuario, y caducidad comprobada en código (no solo por TTL)', async () => {
    const u = db.nuevoId();
    const p = await db.crearPropuestaBD(u, { tipo: 'eliminar', operaciones: { lista: [] } });
    assert.match(p.id, /^[a-f0-9]{32}$/);
    assert.equal(await db.reclamarPropuestaBD(db.nuevoId(), p.id), null, 'otro usuario no la puede usar');
    assert.ok(await db.reclamarPropuestaBD(u, p.id));
    assert.equal(await db.reclamarPropuestaBD(u, p.id), null, 'segundo uso rechazado');
    const vieja = await db.crearPropuestaBD(u, { tipo: 'eliminar' });
    await db.modelos.Propuesta.updateOne({ id: vieja.id }, { $set: { expira: new Date(Date.now() - 1000) } });
    assert.equal(await db.obtenerPropuestaBD(u, vieja.id), null, 'caducada aunque el monitor TTL aún no la haya borrado');
    assert.equal(await db.reclamarPropuestaBD(u, vieja.id), null);
});

test('aplicarCambiosBD: verifica TODOS los ids en una consulta y rechaza si no coinciden (sin IDOR)', async () => {
    const dueño = db.nuevoId(), atacante = db.nuevoId();
    const ajena = nueva(dueño, { titulo: 'Ajena' });
    const propia = nueva(atacante, { titulo: 'Propia' });
    await db.guardarActividadBD(dueño, ajena);
    await db.guardarActividadBD(atacante, propia);
    await assert.rejects(db.aplicarCambiosBD(atacante, [{ op: 'eliminar', id: propia.id }, { op: 'eliminar', id: ajena.id }]), (e) => e.codigo === 'ids');
    assert.equal((await db.obtenerActividadesBD(atacante)).length, 1, 'no se aplicó nada');
    assert.equal((await db.obtenerActividadesBD(dueño))[0].titulo, 'Ajena');
    assert.equal(await db.verificarIdsBD(atacante, [ajena.id]), false);
    assert.equal(await db.verificarIdsBD(atacante, [propia.id]), true);
    await assert.rejects(db.aplicarCambiosBD(atacante, Array.from({ length: 31 }, () => ({ op: 'crear', datos: nueva(atacante) }))), (e) => e.codigo === 'demasiadas');
});

test('diario de operaciones: deshacer revierte el lote completo', async () => {
    const u = db.nuevoId();
    const a = nueva(u, { titulo: 'A', proyecto: 'Liga', hora_inicio: '18:00', hora_fin: '20:00' });
    const b = nueva(u, { titulo: 'B' });
    await db.guardarActividadBD(u, a); await db.guardarActividadBD(u, b);
    const { loteId, creadas } = await db.aplicarCambiosBD(u, [
        { op: 'editar', id: a.id, cambios: { fecha_inicio: '2026-10-09', fecha: '2026-10-09', fecha_fin: '2026-10-09' } },
        { op: 'eliminar', id: b.id },
        { op: 'crear', datos: nueva(u, { titulo: 'C' }) }
    ]);
    assert.equal(creadas.length, 1);
    assert.equal(await db.ultimoLoteBD(u), loteId);
    assert.equal(await db.deshacerLoteBD(u, loteId), 3);
    const lista = await db.obtenerActividadesBD(u);
    assert.deepEqual(lista.map((x) => x.titulo).sort(), ['A', 'B']);
    const a2 = lista.find((x) => x.id === a.id);
    assert.deepEqual([a2.fecha_inicio, a2.proyecto, a2.hora_inicio], ['2026-10-07', 'Liga', '18:00']);
    assert.equal(await db.deshacerLoteBD(u, loteId), 0, 'no se deshace dos veces');
    assert.equal(await db.deshacerLoteBD(db.nuevoId(), loteId), 0, 'otro usuario no puede deshacer');
});

test('transacción: si algo falla a mitad, no queda nada aplicado', async () => {
    assert.equal(db.transaccionesDisponibles(), true, 'el entorno de pruebas es un replica set');
    const u = db.nuevoId();
    const a = nueva(u, { titulo: 'Intacta' });
    await db.guardarActividadBD(u, a);
    const b = nueva(u, { titulo: 'Otra' });
    await db.guardarActividadBD(u, b);
    // La 2.ª operación falla al guardar (horas fuera de rango: validación de Mongoose) después de que la 1.ª ya escribió
    await assert.rejects(db.conTransaccion((session) => db.aplicarCambiosBD(u, [
        { op: 'editar', id: a.id, cambios: { titulo: 'Cambiada' } },
        { op: 'editar', id: b.id, cambios: { horas: 50 } }
    ], { session })), (e) => e.name === 'ValidationError');
    assert.equal((await db.obtenerActividadBD(u, a.id)).titulo, 'Intacta', 'rollback');
    assert.equal(await db.modelos.Operacion.countDocuments({ userId: u }), 0, 'el diario también se revierte');
});

test('sanitizeFilter: segunda capa contra operadores NoSQL aunque se salte esTexto', async () => {
    const u = db.nuevoId();
    await db.guardarActividadBD(u, nueva(u));
    assert.equal(mongoose.get('sanitizeFilter'), true);
    await assert.rejects(db.modelos.Actividad.find({ userId: { $ne: null } }).lean(), (e) => e.name === 'CastError');
    assert.equal((await db.obtenerActividadesBD({ $ne: null })).length, 0, 'primera capa: esTexto');
    assert.equal(await db.obtenerActividadBD(u, { $gt: '' }), null);
});
