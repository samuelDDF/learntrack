// MongoDB independiente (sin replica set): las propuestas se aplican degradando con aviso, y si algo falla a
// mitad se compensa con el diario. Siempre usa el servidor de pruebas en modo standalone (no aplica a Atlas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, actividadBase, hoyLocal } from './helpers/entorno.js';
import * as db from '../src/database.js';

let e;
before(async () => { const prev = process.env.MONGO_URI_TEST; delete process.env.MONGO_URI_TEST; e = await iniciarEntorno({ replicaSet: false }); if (prev) process.env.MONGO_URI_TEST = prev; });
after(async () => { await e.cerrar(); });

test('sin transacciones: aplica con aviso y conTransaccion lo detecta', async () => {
    assert.equal(db.transaccionesDisponibles(), false);
    const c = await e.cliente();
    await c.post('/api/actividades', actividadBase({ titulo: 'Taller', fecha_inicio: hoyLocal(), fecha_fin: hoyLocal() }));
    const lista = (await c.get('/api/actividades')).data;
    e.ollama.responder('clasificar', { intencion: 'eliminar', ids: [lista[0].id], referencia: 'taller', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'eliminar' });
    const r = await c.post('/api/ia/chat', { texto: 'borra el taller', fechaHoy: hoyLocal() });
    assert.equal(r.data.tipo, 'propuesta');
    const ap = await c.post(`/api/propuestas/${r.data.propuesta.id}/aplicar`);
    assert.equal(ap.status, 200);
    assert.match(ap.data.avisos.join(' '), /no admite transacciones/);
    assert.equal(ap.data.actividades.length, 0);
});

test('sin transacciones: un fallo a mitad se compensa y la propuesta se libera para reintentar', async () => {
    const c = await e.cliente();
    await c.post('/api/actividades', actividadBase({ titulo: 'Uno' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Dos' }));
    const [uno, dos] = (await c.get('/api/actividades')).data;
    // La 2.ª operación falla al guardar (horas fuera de rango) DESPUÉS de que la 1.ª ya escribió
    const p = await db.crearPropuestaBD(c.usuario.id, { tipo: 'mover', operaciones: { lista: [
        { op: 'editar', id: uno.id, cambios: { titulo: 'Cambiada' } }, { op: 'editar', id: dos.id, cambios: { horas: 50 } }
    ] } });
    const ap = await c.post(`/api/propuestas/${p.id}/aplicar`);
    assert.equal(ap.status, 400);
    assert.equal((await c.get('/api/actividades')).data.find((a) => a.id === uno.id).titulo, 'Uno', 'compensado');
    assert.ok(await db.obtenerPropuestaBD(c.usuario.id, p.id), 'la propuesta vuelve a estar disponible');
});
