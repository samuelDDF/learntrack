// Repaso espaciado (SM-2): API /api/repaso. Validaciones (v3.6), flujo completo y aislamiento entre usuarios.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, hoyLocal, actividadBase } from '../utilidades/entorno.js';
import { sumarDias } from '../../compartido/fechas.js';
import { calcularRepaso } from '../../backend/servicios/repaso-espaciado.js';
import { validarCalificacion, validarProximaFecha } from '../../backend/validacion/repaso.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const HOY = hoyLocal(300);           // el servidor calcula «hoy» en America/Bogota (zona por defecto)

async function conActividad(titulo = 'Tema de redes') {
    const c = await e.cliente();
    await c.post('/api/actividades', actividadBase({ titulo }));
    const [a] = (await c.get('/api/actividades')).data;
    return { c, a };
}

test('validarCalificacion: solo enteros 0–5 (número o un dígito en texto); rechaza "", null, true y [3]', () => {
    for (const ok of [0, 3, 5, '4', ' 2 ']) assert.ok(!validarCalificacion(ok).error, String(ok));
    for (const mal of ['', null, undefined, true, false, [3], 6, -1, 2.5, '3.0', '10', 'tres', {}]) {
        assert.ok(validarCalificacion(mal).error, JSON.stringify(mal));
    }
});

test('validarProximaFecha: opcional (hoy por defecto); fecha real y dentro de ±1 año', () => {
    assert.equal(validarProximaFecha(undefined, '2026-10-28').proximaFecha, '2026-10-28');
    assert.equal(validarProximaFecha('2026-11-02', '2026-10-28').proximaFecha, '2026-11-02');
    for (const mal of ['2026-13-45', '2026-02-30', ['2026-01-01'], 20261101, 'mañana', '2030-01-01', '2020-01-01']) {
        assert.ok(validarProximaFecha(mal, '2026-10-28').error, JSON.stringify(mal));
    }
});

test('activar sin cuerpo JSON ya no da 500: el primer repaso queda para hoy', async () => {
    const { c, a } = await conActividad();
    const res = await c.crudo('POST', `/api/repaso/${a.id}/activar`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.actividad.repaso.proximaFecha, HOY);
    assert.equal(data.actividad.repaso.facilidad, 2.5);
    // Fechas imposibles o con otro tipo → 400 (antes llegaban a Mongo)
    for (const proximaFecha of ['2026-13-45', ['2026-01-01'], 'mañana']) {
        assert.equal((await c.post(`/api/repaso/${a.id}/activar`, { proximaFecha })).status, 400, JSON.stringify(proximaFecha));
    }
});

test('flujo SM-2 por la API: pendientes → calificar (5) → intervalo 1 → fallo (1) reinicia; desactivar', async () => {
    const { c, a } = await conActividad();
    await c.post(`/api/repaso/${a.id}/activar`, {});
    let p = (await c.get('/api/repaso/pendientes')).data;
    assert.equal(p.hoy, HOY);
    assert.deepEqual(p.actividades.map((x) => x.id), [a.id]);

    const r1 = await c.post(`/api/repaso/${a.id}/calificar`, { calificacion: 5 });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.data.resultado, calcularRepaso({ intervalo: 0, facilidad: 2.5, repeticiones: 0, calificacion: 5, fechaRepaso: HOY }));
    assert.equal(r1.data.resultado.proximaFecha, sumarDias(HOY, 1));
    assert.equal((await c.get('/api/repaso/pendientes')).data.pendientes, 0, 'ya no está pendiente hoy');

    const r2 = await c.post(`/api/repaso/${a.id}/calificar`, { calificacion: '5' });
    assert.equal(r2.data.resultado.intervalo, 6, 'segunda repetición: 6 días');
    const r3 = await c.post(`/api/repaso/${a.id}/calificar`, { calificacion: 1 });
    assert.equal(r3.data.resultado.repeticiones, 0, 'una respuesta incorrecta reinicia');
    assert.equal(r3.data.resultado.intervalo, 1);

    for (const calificacion of ['', null, true, [3], 7]) {
        assert.equal((await c.post(`/api/repaso/${a.id}/calificar`, { calificacion })).status, 400, JSON.stringify(calificacion));
    }
    // El campo `repaso` viaja con la actividad normal (lo usa la interfaz para mostrar el estado)
    const lista = (await c.get('/api/actividades')).data;
    assert.equal(lista[0].repaso.repeticiones, 0);

    assert.equal((await c.post(`/api/repaso/${a.id}/desactivar`, {})).status, 200);
    assert.equal((await c.get('/api/repaso')).data.actividades.length, 0);
    assert.equal((await c.post(`/api/repaso/${a.id}/calificar`, { calificacion: 4 })).status, 404, 'sin repaso activo');
});

test('aislamiento: otro usuario no puede activar, calificar ni ver repasos ajenos; sin sesión 401', async () => {
    const { c, a } = await conActividad('Privado');
    await c.post(`/api/repaso/${a.id}/activar`, {});
    const otro = await e.cliente('Otro');
    assert.equal((await otro.post(`/api/repaso/${a.id}/activar`, {})).status, 404);
    assert.equal((await otro.post(`/api/repaso/${a.id}/calificar`, { calificacion: 5 })).status, 404);
    assert.equal((await otro.get('/api/repaso')).data.actividades.length, 0);
    assert.equal((await e.sinSesion().get('/api/repaso/pendientes')).status, 401);
    assert.equal((await c.post(`/api/repaso/${'x'.repeat(65)}/activar`, {})).status, 400, 'id con formato inválido');
    // Una actividad en la papelera deja de salir en los repasos
    await c.del(`/api/actividades/${a.id}`);
    assert.equal((await c.get('/api/repaso/pendientes')).data.pendientes, 0);
});
