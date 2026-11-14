// v3.6.1 · Aclaraciones parciales, liberación anual por pasos, «Decide tú» no destructivo y aislamiento entre usuarios.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, hoyLocal, actividadBase } from '../utilidades/entorno.js';
import { sumarDias } from '../../compartido/fechas.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const BOGOTA = 300;
const HOY = hoyLocal(BOGOTA);
const MANANA = sumarDias(HOY, 1);
const clasif = (intencion, extra = {}) => ({ intencion, ids: [], referencia: '', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'ninguno', ...extra });
const nuevo = async () => {
    const c = await e.cliente();
    c.chat = (texto, extra = {}) => c.post('/api/ia/chat', { texto, fechaHoy: HOY, tzOffset: BOGOTA, horaLocal: '09:30', ...extra });
    c.lista = async () => (await c.get('/api/actividades')).data;
    return c;
};

test('aclaración parcial: conserva la fecha ya respondida y solo pregunta lo pendiente; «elimínalas» responde al modo', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Lectura', fecha_inicio: MANANA, fecha_fin: MANANA }));
    e.ollama.responder('clasificar', clasif('liberar_dia'));
    const primera = await c.chat('Libera el día');
    assert.equal(primera.data.tipo, 'aclaracion');
    const ids = primera.data.aclaracion.preguntas.map((p) => p.id);
    assert.ok(ids.includes('fecha'), 'sin día pregunta el día');
    const segunda = await c.chat('mañana', { aclaracionId: primera.data.aclaracion.id });
    assert.equal(segunda.data.tipo, 'aclaracion');
    assert.deepEqual(segunda.data.aclaracion.preguntas.map((p) => p.id), ['modo'], 'solo queda el modo: la fecha no se vuelve a preguntar');
    const tercera = await c.chat('elimínalas', { aclaracionId: segunda.data.aclaracion.id });
    assert.equal(tercera.data.tipo, 'propuesta');
    assert.deepEqual(tercera.data.propuesta.operaciones.eliminar.map((x) => x.titulo), ['Lectura']);
    assert.equal((await c.lista()).length, 1, 'nada cambia antes de confirmar');
});

test('«Decide tú» (botón sin texto) aplica valores por defecto NO destructivos y los anuncia', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Repaso', fecha_inicio: HOY, fecha_fin: HOY }));
    e.ollama.responder('clasificar', clasif('liberar_dia'));
    const primera = await c.chat('Libera el día');
    const r = await c.chat('', { aclaracionId: primera.data.aclaracion.id, respuestas: {} });
    assert.equal(r.data.tipo, 'propuesta');
    assert.equal(r.data.propuesta.operaciones.eliminar.length, 0, 'por defecto nunca se elimina');
    assert.ok(r.data.propuesta.supuestos.some((s) => /aplazo en lugar de eliminarlas/.test(s)));
});

test('liberación anual: pregunta eliminar/trasladar, luego el destino y propone sin aplicar', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Taller 2027', fecha_inicio: '2027-04-01', fecha_fin: '2027-04-01' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Curso 2027', fecha_inicio: '2027-09-01', fecha_fin: '2027-09-01' }));
    e.ollama.responder('clasificar', clasif('charla'));
    const primera = await c.chat('Libera mi agenda de 2027');
    assert.equal(primera.data.tipo, 'aclaracion');
    assert.match(primera.data.mensaje, /¿quieres eliminar esas actividades o trasladarlas/);
    const segunda = await c.chat('trasladarlas', { aclaracionId: primera.data.aclaracion.id });
    assert.equal(segunda.data.tipo, 'aclaracion');
    assert.match(segunda.data.mensaje, /¿A qué fecha quieres trasladar/);
    const tercera = await c.chat('2028-01-15', { aclaracionId: segunda.data.aclaracion.id });
    assert.equal(tercera.data.tipo, 'propuesta');
    assert.match(tercera.data.mensaje, /Mover 2 actividades/);
    const lista = await c.lista();
    assert.equal(lista.length, 2);
    assert.ok(lista.every((a) => a.fecha_inicio.startsWith('2027')), 'nada se mueve antes de confirmar');
});

test('liberación anual con «eliminar»: propone la eliminación de ese año, nunca la crea como actividad nueva', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Viaje 2027', fecha_inicio: '2027-06-01', fecha_fin: '2027-06-01' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Viaje 2028', fecha_inicio: '2028-06-01', fecha_fin: '2028-06-01' }));
    const crearAntes = e.ollama.peticionesDe('crear').length;
    e.ollama.responder('clasificar', clasif('crear'));                    // aunque el clasificador diga «crear»
    const primera = await c.chat('Libera mi agenda de 2027');
    assert.equal(primera.data.tipo, 'aclaracion');
    const r = await c.chat('eliminar', { aclaracionId: primera.data.aclaracion.id });
    assert.equal(r.data.tipo, 'propuesta');
    assert.deepEqual(r.data.propuesta.operaciones.eliminar.map((x) => x.titulo), ['Viaje 2027']);
    assert.equal(e.ollama.peticionesDe('crear').length, crearAntes, 'no se llamó al extractor de creación');
    assert.equal((await c.lista()).length, 2);
});

test('aislamiento: la eliminación anual de un usuario no ve actividades de otro, ni con ids inventados por el modelo', async () => {
    const a = await nuevo();
    const b = await nuevo();
    const ajena = (await a.post('/api/actividades', actividadBase({ titulo: 'De A 2027', fecha_inicio: '2027-02-02', fecha_fin: '2027-02-02' }))).data;
    e.ollama.responder('clasificar', clasif('charla'));
    const r = await b.chat('Elimina todas las tareas de 2027');
    assert.equal(r.data.tipo, 'respuesta');
    assert.match(r.data.mensaje, /No encontré actividades.*2027/);
    // El clasificador «inventa» el id de una actividad de otro usuario: se descarta
    e.ollama.responder('clasificar', clasif('eliminar', { ids: [ajena.id ?? ajena._id] }));
    const r2 = await b.chat('borra definitivamente esa');
    assert.notEqual(r2.data.tipo, 'aplicado');
    assert.ok(!JSON.stringify(r2.data).includes('De A 2027'), 'no se revela la actividad ajena');
    assert.equal((await a.lista()).length, 1, 'la actividad de A sigue intacta');
});
