// Regresiones para consultas por año calendario y respuestas ambiguas a aclaraciones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, hoyLocal, actividadBase } from '../utilidades/entorno.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const BOGOTA = 300;
const HOY = hoyLocal(BOGOTA);
const clasif = (intencion, extra = {}) => ({ intencion, ids: [], referencia: '', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'ninguno', ...extra });
const nuevo = async () => {
    const c = await e.cliente();
    c.chat = (texto, extra = {}) => c.post('/api/ia/chat', { texto, fechaHoy: HOY, tzOffset: BOGOTA, horaLocal: '09:30', ...extra });
    c.lista = async () => (await c.get('/api/actividades')).data;
    return c;
};

test('consulta por año: encuentra actividades futuras en la agenda del usuario sin depender del contexto compacto', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Proyecto enero', fecha_inicio: '2027-01-12', fecha_fin: '2027-01-12' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Examen diciembre', fecha_inicio: '2027-12-10', fecha_fin: '2027-12-11' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Actividad 2028', fecha_inicio: '2028-02-01', fecha_fin: '2028-02-01' }));
    e.ollama.responder('clasificar', clasif('charla'));
    const r = await c.chat('¿Puedes ver las actividades del año 2027?');
    assert.equal(r.status, 200);
    assert.match(r.data.mensaje, /Encontré 2 actividades.*2027/s);
    assert.match(r.data.mensaje, /Proyecto enero/);
    assert.match(r.data.mensaje, /Examen diciembre/);
    assert.doesNotMatch(r.data.mensaje, /Actividad 2028/);
});

test('eliminación por año: propone solo actividades de ese año y no las borra antes de confirmar', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Tarea A 2027', fecha_inicio: '2027-03-01', fecha_fin: '2027-03-01' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Tarea B 2027', fecha_inicio: '2027-11-01', fecha_fin: '2027-11-01' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Tarea 2028', fecha_inicio: '2028-01-01', fecha_fin: '2028-01-01' }));
    e.ollama.responder('clasificar', clasif('charla'));
    const r = await c.chat('Elimina todas las tareas que tengo para el año 2027');
    assert.equal(r.status, 200);
    assert.equal(r.data.tipo, 'propuesta');
    assert.match(r.data.mensaje, /Eliminar 2 actividades/);
    // Contrato de la API: las operaciones propuestas van agrupadas en propuesta.operaciones.{crear,editar,mover,eliminar,restaurar}
    const nombresPropuestos = (r.data.propuesta?.operaciones?.eliminar ?? []).map((a) => a.titulo);
    assert.ok(nombresPropuestos.includes('Tarea A 2027'));
    assert.ok(nombresPropuestos.includes('Tarea B 2027'));
    assert.ok(!nombresPropuestos.includes('Tarea 2028'));
    assert.equal((await c.lista()).length, 3, 'no se modifica la agenda antes de confirmar');
});

test('eliminación por año sin coincidencias: responde con claridad y no altera otras actividades', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Solo 2028', fecha_inicio: '2028-01-01', fecha_fin: '2028-01-01' }));
    e.ollama.responder('clasificar', clasif('charla'));
    const r = await c.chat('Elimina todas las tareas de 2027');
    assert.equal(r.status, 200);
    assert.equal(r.data.tipo, 'respuesta');
    assert.match(r.data.mensaje, /No encontré actividades.*2027/);
    assert.equal((await c.lista()).length, 1);
});

test('respuesta ambigua «nada» no activa un modo predeterminado ni modifica actividades', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Entrega viernes', fecha_inicio: sumarViernes(HOY), fecha_fin: sumarViernes(HOY) }));
    e.ollama.responder('clasificar', clasif('liberar_dia', { modo: 'ninguno' }));
    const primera = await c.chat('Libera el día');
    assert.equal(primera.data.tipo, 'aclaracion', 'sin fecha debe pedir una aclaración');
    const antes = await c.lista();
    const respuesta = await c.chat('nada', { aclaracionId: primera.data.aclaracion.id });
    assert.equal(respuesta.data.tipo, 'aclaracion', 'debe mantener la aclaración, no ejecutar un valor predeterminado');
    assert.equal((await c.lista()).length, antes.length);
});

function sumarViernes(hoy) {
    const fecha = new Date(`${hoy}T12:00:00Z`);
    const delta = (5 - fecha.getUTCDay() + 7) % 7 || 7;
    fecha.setUTCDate(fecha.getUTCDate() + delta);
    return fecha.toISOString().slice(0, 10);
}

test('consulta anual incluye actividades que se cruzan con el año y nunca revela las de otro usuario', async () => {
    const c1 = await nuevo();
    const c2 = await nuevo();
    await c1.post('/api/actividades', actividadBase({ titulo: 'Cruza desde 2026', fecha_inicio: '2026-12-30', fecha_fin: '2027-01-02' }));
    await c1.post('/api/actividades', actividadBase({ titulo: 'Diciembre 2027', fecha_inicio: '2027-12-29', fecha_fin: '2028-01-03' }));
    await c1.post('/api/actividades', actividadBase({ titulo: 'Privada de otra persona', fecha_inicio: '2027-06-01', fecha_fin: '2027-06-01' }));
    e.ollama.responder('clasificar', clasif('charla'));
    const r1 = await c1.chat('Muéstrame todas las actividades de 2027');
    assert.match(r1.data.mensaje, /Cruza desde 2026/);
    assert.match(r1.data.mensaje, /Diciembre 2027/);
    e.ollama.responder('clasificar', clasif('charla'));
    const r2 = await c2.chat('Muéstrame todas las actividades de 2027');
    assert.match(r2.data.mensaje, /No encontré actividades/);
    assert.doesNotMatch(r2.data.mensaje, /Cruza desde 2026|Diciembre 2027|Privada de otra persona/);
});

test('aplazar todas las actividades de un año pide destino y prepara una propuesta sin mover antes de confirmar', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Tarea enero', fecha_inicio: '2027-01-10', fecha_fin: '2027-01-10' }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Tarea marzo', fecha_inicio: '2027-03-10', fecha_fin: '2027-03-11' }));
    e.ollama.responder('clasificar', clasif('charla'));
    const primera = await c.chat('Aplaza todas las tareas de 2027');
    assert.equal(primera.data.tipo, 'aclaracion');
    assert.match(primera.data.mensaje, /¿A qué fecha quieres trasladar/);
    const antes = await c.lista();
    const segunda = await c.chat('2028-01-15', { aclaracionId: primera.data.aclaracion.id });
    assert.equal(segunda.data.tipo, 'propuesta');
    assert.match(segunda.data.mensaje, /Mover 2 actividades/);
    assert.deepEqual((await c.lista()).map(a => a.fecha_inicio).sort(), antes.map(a => a.fecha_inicio).sort());
});

test('liberar la agenda de un año pregunta si se desea eliminar o trasladar', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Tarea 2027', fecha_inicio: '2027-05-01', fecha_fin: '2027-05-01' }));
    e.ollama.responder('clasificar', clasif('liberar_dia'));
    const r = await c.chat('Libera mi agenda de 2027');
    assert.equal(r.data.tipo, 'aclaracion');
    assert.match(r.data.mensaje, /¿quieres eliminar esas actividades o trasladarlas/);
    assert.equal((await c.lista()).length, 1);
});

test('una aclaración con varios campos conserva la respuesta válida y vuelve a preguntar solo lo pendiente', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Entrega viernes', fecha_inicio: sumarViernes(HOY), fecha_fin: sumarViernes(HOY) }));
    e.ollama.responder('clasificar', clasif('liberar_dia', { modo: 'ninguno' }));
    const primera = await c.chat('Libera el día');
    assert.equal(primera.data.tipo, 'aclaracion');
    const fecha = await c.chat('mañana', { aclaracionId: primera.data.aclaracion.id });
    assert.equal(fecha.data.tipo, 'aclaracion');
    assert.match(fecha.data.mensaje, /¿Aplazo esas actividades|¿quieres trasladar|¿quieres eliminar/i);
    const antes = await c.lista();
    const ambigua = await c.chat('nada', { aclaracionId: fecha.data.aclaracion.id });
    assert.equal(ambigua.data.tipo, 'aclaracion');
    assert.equal((await c.lista()).length, antes.length);
});

test('solicitar dos actividades sin describirlas pide detalles y no consulta ni modifica la agenda', async () => {
    const c = await nuevo();
    const peticionesCrearAntes = e.ollama.peticionesDe('crear').length;
    e.ollama.responder('clasificar', clasif('preguntar'));
    const r = await c.chat('Crea 2 actividades para el el 3 de enero del año 2028');
    assert.equal(r.status, 200);
    assert.equal(r.data.tipo, 'respuesta');
    assert.match(r.data.mensaje, /¿Qué nombres y horarios quieres asignarles/);
    assert.equal((await c.lista()).length, 0);
    assert.equal(e.ollama.peticionesDe('crear').length, peticionesCrearAntes, 'no debe pedir al modelo inventar actividades');
});

test('un mensaje nuevo con partido, fecha y horario se interpreta como creación aunque la clasificación diga charla', async () => {
    const c = await nuevo();
    e.ollama.responder('clasificar', clasif('charla'));
    e.ollama.responder('crear', { actividades: [{
        titulo: 'Partido de fútbol importante', tipo: 'deporte', exigencia: -2, horas: 2,
        fecha_inicio: '2028-01-02', fecha_fin: '2028-01-02', hora_inicio: null, hora_fin: null,
        estado: 'pendiente', proyecto: ''
    }] });
    const r = await c.chat('El 2 de enero del 2028 tengo un partido de futbol importante de 10 a 12');
    assert.equal(r.status, 200);
    assert.ok(['aplicado', 'aclaracion', 'propuesta'].includes(r.data.tipo), `tipo inesperado: ${r.data.tipo}`);
    assert.doesNotMatch(r.data.mensaje, /No encontré actividades entre el 1 de enero y el 31 de diciembre/);
    const actividades = await c.lista();
    assert.equal(actividades.length, 1);
    assert.match(actividades[0].titulo, /Partido de fútbol importante/);
    assert.equal(actividades[0].fecha_inicio, '2028-01-02');
    assert.equal(actividades[0].hora_inicio, '10:00');
    assert.equal(actividades[0].hora_fin, '12:00');
});

test('un mensaje nuevo de creación no se consume como respuesta de una aclaración anterior', async () => {
    const c = await nuevo();
    e.ollama.responder('clasificar', clasif('liberar_dia', { modo: 'ninguno' }));
    const primera = await c.chat('Libera el día');
    assert.equal(primera.data.tipo, 'aclaracion');
    e.ollama.responder('clasificar', clasif('charla'));
    e.ollama.responder('crear', { actividades: [{
        titulo: 'Partido de fútbol', tipo: 'deporte', exigencia: -2, horas: 2,
        fecha_inicio: '2028-01-02', fecha_fin: '2028-01-02', hora_inicio: null, hora_fin: null,
        estado: 'pendiente', proyecto: ''
    }] });
    const nueva = await c.chat('El 2 de enero de 2028 tengo un partido de fútbol de 10 a 12', { aclaracionId: primera.data.aclaracion.id });
    assert.notEqual(nueva.data.tipo, 'aclaracion', 'no debe responder a la aclaración antigua');
    assert.equal((await c.lista()).length, 1);
});
