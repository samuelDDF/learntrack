// POST /api/ia/chat con un Ollama SIMULADO: una prueba por intención, aclaraciones, confirmaciones,
// deshacer, contexto limitado y fallos del modelo. La fecha que envía el cliente es la LOCAL de Bogotá.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, hoyLocal, actividadBase } from '../utilidades/entorno.js';
import { sumarDias, diaSemana } from '../../compartido/fechas.js';
import { proximoDia } from '../../backend/servicios/asistente/interprete-lenguaje.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const BOGOTA = 300;
const HOY = hoyLocal(BOGOTA);
const MANANA = sumarDias(HOY, 1);
const clasif = (intencion, extra = {}) => ({ intencion, ids: [], referencia: '', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'ninguno', ...extra });
const nuevo = async () => {
    const c = await e.cliente();
    c.chat = (texto, extra = {}) => c.post('/api/ia/chat', { texto, fechaHoy: HOY, tzOffset: BOGOTA, ...extra });
    c.lista = async () => (await c.get('/api/actividades')).data;
    c.crear = async (extra) => { const r = await c.post('/api/actividades', actividadBase({ fecha_inicio: HOY, fecha_fin: HOY, ...extra })); return r.data.at(-1); };
    return c;
};

test('crear: fechas y horas en código ("mañana", "de 2 a 4 pm"), aplicado directo con Deshacer y carga', async () => {
    const c = await nuevo();
    e.ollama.responder('crear', { actividades: [{ titulo: 'Parcial de redes', tipo: 'estudio', exigencia: 3, horas: 1, fecha_inicio: '1999-01-01', fecha_fin: '1999-01-01', hora_inicio: '09:00', hora_fin: null, estado: 'pendiente', proyecto: '' }] });
    const r = await c.chat('Mañana tengo parcial de redes de 2 a 4 pm');
    assert.equal(r.status, 200); assert.equal(r.data.tipo, 'aplicado');
    const a = r.data.actividades.find((x) => x.titulo === 'Parcial de redes');
    assert.deepEqual([a.fecha_inicio, a.hora_inicio, a.hora_fin, a.horas, a.exigencia], [MANANA, '14:00', '16:00', 2, 3], 'el código corrige la fecha y la hora del modelo');
    assert.ok(r.data.loteId); assert.equal(r.data.cargas[0].fecha, MANANA); assert.equal(r.data.cargas[0].despues, 60);
    const d = await c.post(`/api/operaciones/${r.data.loteId}/deshacer`);
    assert.equal(d.status, 200); assert.equal(d.data.actividades.length, 0);
});

test('crear: deporte -2 salvo cansancio (2-3); "ya hice" = completado; cruce de medianoche', async () => {
    const c = await nuevo();
    e.ollama.responder('crear', { actividades: [{ titulo: 'Entreno maratón', tipo: 'deporte', exigencia: -2, horas: 3 }] });
    let r = await c.chat('El sábado entreno para la maratón a las 7 am, 3 horas, voy a terminar exhausto');
    let a = r.data.actividades.at(-1);
    assert.equal(a.exigencia, 3, 'cansancio fuerte → 3');
    assert.equal(a.fecha_inicio, proximoDia(HOY, 6, diaSemana(HOY) === 6 ? false : false));
    e.ollama.responder('crear', { actividades: [{ titulo: 'Fútbol', tipo: 'deporte', exigencia: 3, horas: 1, estado: 'pendiente' }] });
    r = await c.chat('Hoy ya jugué fútbol 1 hora');
    a = r.data.actividades.at(-1);
    assert.deepEqual([a.exigencia, a.estado, a.fecha_inicio], [-2, 'completado', HOY], 'sin cansancio el deporte recarga; "ya jugué" = completado');
    e.ollama.responder('crear', { actividades: [{ titulo: 'Estudio nocturno', tipo: 'estudio', exigencia: 2 }] });
    r = await c.chat('hoy estudio de 10 pm a 1 am');
    a = r.data.actividades.at(-1);
    assert.deepEqual([a.hora_inicio, a.hora_fin, a.horas], ['22:00', null, 3]);
    assert.match(r.data.supuestos.join(' '), /día siguiente/);
});

test('crear con conflicto de horario: aclaración con respuestas rápidas', async () => {
    const c = await nuevo();
    await c.crear({ titulo: 'Clase', fecha_inicio: MANANA, fecha_fin: MANANA, hora_inicio: '14:00', hora_fin: '16:00', horas: 2 });
    e.ollama.responder('crear', { actividades: [{ titulo: 'Tutoría', tipo: 'estudio', exigencia: 1 }] });
    const r = await c.chat('mañana tutoría de 3 a 4 pm');
    assert.equal(r.data.tipo, 'aclaracion');
    assert.deepEqual(r.data.aclaracion.preguntas[0].opciones.map((o) => o.valor), ['si', 'no']);
    const r2 = await c.chat('', { aclaracionId: r.data.aclaracion.id, respuestas: { confirmar: 'si' } });
    assert.equal(r2.data.tipo, 'aplicado');
    assert.ok(r2.data.actividades.some((a) => a.titulo === 'Tutoría' && a.hora_inicio === '15:00'));
    const r3 = await c.chat('', { aclaracionId: r.data.aclaracion.id, respuestas: { confirmar: 'si' } });
    assert.match(r3.data.mensaje, /caducó/, 'la aclaración es de un solo uso');
});

test('editar (regresión 2-a por la API): el modelo devuelve el registro entero con valores por defecto y solo cambia lo pedido', async () => {
    const c = await nuevo();
    const t = await c.crear({ titulo: 'Taller de cálculo', tipo: 'estudio', exigencia: 1, estado: 'en_proceso', proyecto: 'Semestre', hora_inicio: '10:00', hora_fin: '12:00', horas: 2 });
    e.ollama.responder('clasificar', clasif('editar', { ids: [t.id], referencia: 'taller' }));
    // El simulador "despistado" devuelve tipo estudio/2/pendiente/sin proyecto/sin hora + exigencia 3
    const r = await c.chat('ponle exigencia alta al taller');
    assert.equal(r.data.tipo, 'aplicado');
    const a = r.data.actividades.find((x) => x.id === t.id);
    assert.deepEqual([a.exigencia, a.estado, a.proyecto, a.hora_inicio, a.hora_fin, a.horas, a.tipo], [3, 'en_proceso', 'Semestre', '10:00', '12:00', 2, 'estudio']);
    const prompt = e.ollama.peticionesDe('editar').at(-1).sistema;
    assert.match(prompt, /"proyecto":"Semestre"/, 'el modelo recibe el registro COMPLETO de la actividad');
});

test('mover (regresión 2-a): "mueve el entrenamiento al viernes" conserva deporte/3/en_proceso/Liga/18:00-20:00', async () => {
    const c = await nuevo();
    const ent = await c.crear({ titulo: 'Entrenamiento', tipo: 'deporte', exigencia: 3, estado: 'en_proceso', proyecto: 'Liga', hora_inicio: '18:00', hora_fin: '20:00', horas: 2 });
    e.ollama.responder('clasificar', clasif('mover', { ids: [ent.id], referencia: 'entrenamiento', fecha_destino: 'al viernes' }));
    const r = await c.chat('mueve el entrenamiento al viernes');
    assert.equal(r.data.tipo, 'aplicado');
    const a = r.data.actividades.find((x) => x.id === ent.id);
    const viernes = proximoDia(HOY, 5);
    assert.deepEqual([a.fecha_inicio, a.fecha_fin, a.tipo, a.exigencia, a.estado, a.proyecto, a.hora_inicio, a.hora_fin], [viernes, viernes, 'deporte', 3, 'en_proceso', 'Liga', '18:00', '20:00']);
});

test('mover: si el modelo inventa ids de otro usuario se descartan (una consulta) y se busca por texto; ambigüedad → pregunta', async () => {
    const otro = await nuevo();
    const ajena = await otro.crear({ titulo: 'Ajena' });
    const c = await nuevo();
    await c.crear({ titulo: 'Lectura de historia', fecha_inicio: HOY, fecha_fin: HOY });
    await c.crear({ titulo: 'Lectura de inglés', fecha_inicio: MANANA, fecha_fin: MANANA });
    e.ollama.responder('clasificar', clasif('mover', { ids: [ajena.id], referencia: 'lectura', fecha_destino: 'el lunes' }));
    const r = await c.chat('mueve la lectura al lunes');
    assert.equal(r.data.tipo, 'aclaracion');
    const opciones = r.data.aclaracion.preguntas[0].opciones;
    assert.ok(opciones.length === 3 && opciones.at(-1).valor === 'todas');
    // Se elige la lectura de HOY: la de mañana ya estaría en lunes cuando hoy es domingo (y no habría nada que mover)
    const elegida = opciones.find((o) => /historia/.test(o.etiqueta)).valor;
    const r2 = await c.chat('', { aclaracionId: r.data.aclaracion.id, respuestas: { objetivo: elegida } });
    assert.equal(r2.data.tipo, 'aplicado');
    assert.equal(r2.data.actividades.find((a) => a.id === elegida).fecha_inicio, proximoDia(HOY, 1));
    assert.equal((await otro.lista())[0].fecha_inicio, ajena.fecha_inicio, 'la actividad ajena no se tocó');
});

test('mover un proyecto completo (por `proyecto`): propuesta que desplaza conservando duraciones', async () => {
    const c = await nuevo();
    await c.crear({ titulo: 'Fase 1', proyecto: 'Robótica', fecha_inicio: HOY, fecha_fin: sumarDias(HOY, 1) });
    await c.crear({ titulo: 'Fase 2', proyecto: 'Robótica', fecha_inicio: sumarDias(HOY, 3), fecha_fin: sumarDias(HOY, 3) });
    await c.crear({ titulo: 'Otra cosa' });
    e.ollama.responder('clasificar', clasif('mover', { proyecto: 'Robótica', fecha_destino: 'en 7 días' }));
    const r = await c.chat('mueve el proyecto Robótica en 7 días');
    assert.equal(r.data.tipo, 'propuesta'); assert.equal(r.data.propuesta.items.length, 2);
    const ap = await c.post(`/api/propuestas/${r.data.propuesta.id}/aplicar`);
    const f1 = ap.data.actividades.find((a) => a.titulo === 'Fase 1');
    assert.deepEqual([f1.fecha_inicio, f1.fecha_fin], [sumarDias(HOY, 7), sumarDias(HOY, 8)]);
    assert.equal(ap.data.actividades.find((a) => a.titulo === 'Otra cosa').fecha_inicio, HOY);
});

test('liberar_dia: propuesta (Aplicar), un solo uso, carga antes/después, y Deshacer', async () => {
    const c = await nuevo();
    await c.crear({ titulo: 'Taller', fecha_inicio: MANANA, fecha_fin: MANANA, horas: 2 });
    await c.crear({ titulo: 'Examen final', fecha_inicio: MANANA, fecha_fin: MANANA, exigencia: 2 });
    e.ollama.responder('clasificar', clasif('liberar_dia', { fecha_objetivo: 'mañana' }));
    const r = await c.chat('libera mi agenda de mañana');
    assert.equal(r.data.tipo, 'propuesta');
    // TODAS las actividades del día reciben decisión; el examen (hito) aparece, pero desmarcado y con aviso
    assert.equal(r.data.propuesta.items.length, 2);
    assert.equal(r.data.propuesta.seleccionable, true);
    const examen = r.data.propuesta.items.find((i) => i.titulo === 'Examen final');
    assert.equal(examen.marcado, false); assert.match(examen.aviso, /examen|entrega|fija/);
    assert.ok(r.data.propuesta.cargas.some((x) => x.fecha === MANANA && x.antes > x.despues));
    assert.deepEqual(Object.keys(r.data.propuesta.operaciones), ['crear', 'editar', 'mover', 'eliminar', 'restaurar']);
    assert.deepEqual(r.data.propuesta.operaciones.mover.map((m) => m.titulo).sort(), ['Examen final', 'Taller']);
    assert.equal((await c.lista()).find((a) => a.titulo === 'Taller').fecha_inicio, MANANA, 'nada cambia antes de confirmar');
    const ap = await c.post(`/api/propuestas/${r.data.propuesta.id}/aplicar`);
    assert.equal(ap.status, 200);
    assert.notEqual(ap.data.actividades.find((a) => a.titulo === 'Taller').fecha_inicio, MANANA);
    assert.equal(ap.data.actividades.find((a) => a.titulo === 'Examen final').fecha_inicio, MANANA, 'sin marcarlo, el examen no se mueve');
    assert.equal((await c.post(`/api/propuestas/${r.data.propuesta.id}/aplicar`)).status, 410, 'un solo uso');
    const d = await c.post(`/api/operaciones/${ap.data.loteId}/deshacer`);
    assert.equal(d.data.actividades.find((a) => a.titulo === 'Taller').fecha_inicio, MANANA);
});

test('liberar_dia: "elimina todo lo del jueves" es ambiguo → pregunta; "Decide tú" aplaza y lo dice como supuesto', async () => {
    const c = await nuevo();
    const jueves = proximoDia(HOY, 4);
    await c.crear({ titulo: 'Lectura', fecha_inicio: jueves, fecha_fin: jueves });
    e.ollama.responder('clasificar', clasif('liberar_dia', { fecha_objetivo: 'el jueves', modo: 'eliminar' }));
    const r = await c.chat('elimina todo lo del jueves');
    assert.equal(r.data.tipo, 'aclaracion');
    assert.equal(r.data.aclaracion.preguntas[0].id, 'modo');
    const r2 = await c.chat('', { aclaracionId: r.data.aclaracion.id, respuestas: {} });
    assert.equal(r2.data.tipo, 'propuesta');
    assert.equal(r2.data.propuesta.items[0].op, 'mover');
    assert.match(r2.data.propuesta.supuestos.join(' '), /aplazo en lugar de eliminarlas/);
    e.ollama.responder('clasificar', clasif('liberar_dia', { fecha_objetivo: 'el jueves', modo: 'eliminar' }));
    const r3 = await c.chat('borra definitivamente todo lo del jueves');
    assert.equal(r3.data.tipo, 'propuesta');
    assert.equal(r3.data.propuesta.items[0].op, 'eliminar');
    await c.post(`/api/propuestas/${r3.data.propuesta.id}/aplicar`);
    assert.equal((await c.get('/api/papelera')).data.actividades.length, 1, 'borrado lógico: va a la papelera');
});

test('reorganizar: balancea los días > 85 % con propuesta', async () => {
    const c = await nuevo();
    await c.crear({ titulo: 'Bloque A', fecha_inicio: MANANA, fecha_fin: MANANA, horas: 3, exigencia: 2 });
    await c.crear({ titulo: 'Bloque B', fecha_inicio: MANANA, fecha_fin: MANANA, horas: 2, exigencia: 2 });
    e.ollama.responder('clasificar', clasif('reorganizar'));
    const r = await c.chat('organízame la semana, tengo demasiado');
    assert.equal(r.data.tipo, 'propuesta');
    const dia = r.data.propuesta.cargas.find((x) => x.fecha === MANANA);
    assert.ok(dia.antes > 85 && dia.despues <= 85, JSON.stringify(dia));
    assert.ok(r.data.propuesta.explicaciones.every((t) => typeof t === 'string'));
});

test('planificar_proyecto: pregunta lo mínimo, el modelo desglosa y el planificador agenda antes de la fecha límite', async () => {
    const c = await nuevo();
    const limite = sumarDias(HOY, 14);
    e.ollama.responder('clasificar', clasif('planificar_proyecto', { proyecto: 'Robótica', fecha_objetivo: '' }));
    const r = await c.chat('tengo que hacer un proyecto de robótica');
    assert.equal(r.data.tipo, 'aclaracion');
    assert.deepEqual(r.data.aclaracion.preguntas.map((p) => p.id), ['fecha_limite', 'horas_dia'], 'máximo 2 preguntas');
    const r2 = await c.chat('', { aclaracionId: r.data.aclaracion.id, respuestas: { fecha_limite: limite, horas_dia: '2' } });
    assert.equal(r2.data.tipo, 'propuesta');
    const ap = await c.post(`/api/propuestas/${r2.data.propuesta.id}/aplicar`);
    const proyecto = ap.data.actividades.filter((a) => a.proyecto === 'Robótica');
    assert.ok(proyecto.length >= 4);
    assert.ok(proyecto.filter((a) => !a.fija).every((a) => a.fecha_fin <= sumarDias(limite, -2)), 'un día de colchón');
    assert.equal(proyecto.find((a) => a.fija).fecha_inicio, limite);
});

test('eliminar: siempre propuesta (nunca directo) y va a la papelera', async () => {
    const c = await nuevo();
    const p = await c.crear({ titulo: 'Parcial de redes' });
    e.ollama.responder('clasificar', clasif('eliminar', { ids: [p.id], referencia: 'parcial de redes', modo: 'eliminar' }));
    const r = await c.chat('borra el parcial de redes');
    assert.equal(r.data.tipo, 'propuesta');
    assert.equal((await c.lista()).length, 1, 'no se borra sin confirmar');
    await c.post(`/api/propuestas/${r.data.propuesta.id}/aplicar`);
    assert.equal((await c.lista()).length, 0);
    assert.equal((await c.get('/api/papelera')).data.actividades[0].titulo, 'Parcial de redes');
});

test('restaurar: por texto y por fecha de borrado; varias coincidencias → listar y preguntar', async () => {
    const c = await nuevo();
    const a = await c.crear({ titulo: 'Tarea de redes' });
    const b = await c.crear({ titulo: 'Tarea de cálculo' });
    await c.del(`/api/actividades/${a.id}`); await c.del(`/api/actividades/${b.id}`);
    e.ollama.responder('clasificar', clasif('restaurar', { referencia: 'tarea de redes' }));
    let r = await c.chat('restaura la tarea de redes');
    assert.equal(r.data.tipo, 'aplicado');
    assert.ok(r.data.actividades.some((x) => x.id === a.id));
    await c.del(`/api/actividades/${a.id}`);
    e.ollama.responder('clasificar', clasif('restaurar', { referencia: 'tarea' }));
    r = await c.chat('recupera la tarea');
    assert.equal(r.data.tipo, 'aclaracion');
    assert.equal(r.data.aclaracion.preguntas[0].opciones.length, 3);
    e.ollama.responder('clasificar', clasif('restaurar', { referencia: 'lo que borré hoy' }));
    r = await c.chat('recupera lo que borré hoy');
    assert.equal(r.data.tipo, 'propuesta', 'todo lo borrado hoy (hora de Bogotá) → propuesta');
    assert.equal(r.data.propuesta.items.length, 2);
    e.ollama.responder('clasificar', clasif('restaurar', { referencia: 'lo que borré ayer' }));
    r = await c.chat('recupera lo que borré ayer');
    assert.equal(r.data.tipo, 'respuesta', 'nada se borró ayer');
});

test('importar (sin archivo), preguntar y charla', async () => {
    const c = await nuevo();
    await c.crear({ titulo: 'Parcial', fecha_inicio: MANANA, fecha_fin: MANANA, hora_inicio: '14:00', hora_fin: '16:00', horas: 2, exigencia: 3 });
    e.ollama.responder('clasificar', clasif('importar'));
    let r = await c.chat('quiero importar mi horario');
    assert.match(r.data.mensaje, /adjunta el archivo/);
    e.ollama.responder('clasificar', clasif('preguntar'));
    r = await c.chat('¿qué tengo mañana?');
    assert.equal(r.data.tipo, 'respuesta');
    const datos = e.ollama.peticionesDe('redactar').at(-1).usuario;
    assert.match(datos, /Parcial 14:00–16:00/); assert.match(datos, /"carga":60/, 'el modelo recibe la carga calculada en código');
    e.ollama.responder('clasificar', clasif('charla'));
    r = await c.chat('hola');
    assert.equal(r.data.tipo, 'respuesta');
});

test('confirmaciones deterministas: un "sí" sin propuesta pendiente no ejecuta nada; con propuesta la aplica; "no" la cancela', async () => {
    const c = await nuevo();
    await c.crear({ titulo: 'Taller', fecha_inicio: MANANA, fecha_fin: MANANA });
    const antes = e.ollama.estado.peticiones.length;
    let r = await c.chat('sí');
    assert.match(r.data.mensaje, /No hay ningún cambio pendiente/);
    assert.equal(e.ollama.estado.peticiones.length, antes, 'ni siquiera se consulta al modelo');
    e.ollama.responder('clasificar', clasif('liberar_dia', { fecha_objetivo: 'mañana' }));
    r = await c.chat('libera mañana');
    r = await c.chat('sí', { propuestaPendiente: r.data.propuesta.id });
    assert.equal(r.data.tipo, 'aplicado');
    e.ollama.responder('clasificar', clasif('liberar_dia', { fecha_objetivo: 'mañana' }));
    await c.crear({ titulo: 'Otra', fecha_inicio: MANANA, fecha_fin: MANANA });
    r = await c.chat('libera mañana');
    const id = r.data.propuesta.id;
    r = await c.chat('no', { propuestaPendiente: id });
    assert.equal(r.data.tipo, 'cancelada');
    assert.equal((await c.post(`/api/propuestas/${id}/aplicar`)).status, 410);
});

test('"deshaz lo último" revierte la última operación completa de la IA', async () => {
    const c = await nuevo();
    e.ollama.responder('crear', { actividades: [{ titulo: 'Para deshacer', tipo: 'estudio', exigencia: 2 }] });
    await c.chat('hoy estudio 1 hora, a cualquier hora');
    assert.equal((await c.lista()).length, 1);
    const r = await c.chat('deshaz lo último');
    assert.equal(r.data.tipo, 'deshecho');
    assert.equal((await c.lista()).length, 0);
});

test('contexto limitado: ±14 días, máx. 40 actividades compactas; historial ≤ 6 turnos', async () => {
    const c = await nuevo();
    for (let i = 0; i < 45; i++) await c.crear({ titulo: `Cerca ${i}`, fecha_inicio: sumarDias(HOY, i % 10), fecha_fin: sumarDias(HOY, i % 10) });
    await c.crear({ titulo: 'Muy lejos', fecha_inicio: sumarDias(HOY, 40), fecha_fin: sumarDias(HOY, 40) });
    e.ollama.responder('clasificar', clasif('charla'));
    const historial = Array.from({ length: 12 }, (_, i) => ({ rol: i % 2 ? 'asistente' : 'usuario', texto: `turno ${i}` }));
    await c.chat('hola', { historial });
    const p = e.ollama.peticionesDe('clasificar').at(-1);
    const lista = JSON.parse(p.sistema.match(/Usa SOLO estos ids \(la lista puede estar vacía\):\n(\[.*\])/)[1]);
    assert.equal(lista.length, 40);
    assert.ok(!lista.some((a) => a.t === 'Muy lejos'));
    assert.ok(lista.every((a) => a.id && a.t && a.tipo && a.ex !== undefined && a.fi), 'campos completos pero compactos');
    assert.equal(p.body.messages.length, 1 + 6 + 1, 'sistema + 6 turnos + mensaje');
    assert.equal(p.body.response_format.type, 'json_object');
    assert.ok(p.body.temperature <= 0.2);
    assert.match(p.sistema, /miércoles|jueves|viernes|sábado|domingo|lunes|martes/, 'tabla de los próximos 14 días');
});

test('Ollama caído → 503 claro; la creación manual sigue funcionando', async () => {
    const c = await nuevo();
    e.ollama.modo('caido');
    try {
        const r = await c.chat('mañana estudio');
        assert.equal(r.status, 503); assert.match(r.data.error, /no está disponible/);
        const consejo = await c.post('/api/ia/consultar', { estadoAnimo: 'medio', porcentajeCarga: 10, actividades: [] });
        assert.equal(consejo.status, 503);
        const m = await c.post('/api/actividades', actividadBase({ titulo: 'Manual' }));
        assert.equal(m.status, 200);
        const si = await c.chat('sí');
        assert.equal(si.status, 200, 'las confirmaciones no dependen del modelo');
    } finally { e.ollama.modo('normal'); }
});

test('JSON inválido del modelo → un reintento y luego 502, sin escribir nada', async () => {
    const c = await nuevo();
    const antes = e.ollama.estado.peticiones.length;
    e.ollama.modo('json_invalido');
    try {
        const r = await c.chat('mañana estudio cálculo');
        assert.equal(r.status, 502);
        assert.equal(e.ollama.estado.peticiones.length - antes, 2, 'un intento + un reintento');
        assert.equal((await c.lista()).length, 0);
    } finally { e.ollama.modo('normal'); }
    // JSON válido pero con esquema incorrecto: también se rechaza
    e.ollama.responder('clasificar', { intencion: 'borrar_base_de_datos' }, { intencion: 'borrar_base_de_datos' });
    const r2 = await c.chat('haz algo raro');
    assert.equal(r2.status, 502);
});
