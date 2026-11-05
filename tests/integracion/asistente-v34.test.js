// v3.4: Prompt Maestro (nombreIA + fecha/hora), correcciones, horarios ambiguos, vencimientos y urgencia,
// auto-estado, limpieza automática (node-cron), archivadas y resumen de proyectos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import cron from 'node-cron';
import { iniciarEntorno, hoyLocal, actividadBase } from '../utilidades/entorno.js';
import { sumarDias, aMinutos, deMinutos } from '../../compartido/fechas.js';
import { ahoraEn } from '../../backend/servicios/tiempo.js';
import { ejecutarLimpieza, configuracionLimpieza, iniciarLimpiezaAutomatica } from '../../backend/servicios/tareas/limpieza.js';
import { prioridadDe } from '../../compartido/prioridad.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const BOGOTA = 300;
const HOY = hoyLocal(BOGOTA);
const MANANA = sumarDias(HOY, 1);
const nuevo = async () => {
    const c = await e.cliente();
    c.chat = (texto, extra = {}) => c.post('/api/ia/chat', { texto, fechaHoy: HOY, tzOffset: BOGOTA, horaLocal: '09:30', ...extra });
    c.lista = async () => (await c.get('/api/actividades')).data;
    return c;
};
const clasif = (intencion, extra = {}) => ({ intencion, ids: [], referencia: '', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'ninguno', ...extra });

test('Prompt Maestro: identidad con nombreIA (Nexo por defecto) y fecha/hora local inyectadas en el mensaje de sistema', async () => {
    const c = await nuevo();
    assert.equal((await c.get('/api/auth/me')).data.usuario.nombreIA, 'Nexo');
    await c.chat('hola');
    let sistema = e.ollama.estado.peticiones.at(-1).sistema;
    assert.match(sistema, /^Eres Nexo, el asistente de productividad de LearnTrack/);
    assert.match(sistema, /nombre predeterminado.*Configuración/);
    assert.match(sistema, new RegExp(`Ahora es \\w+ ${HOY}, 09:30`), 'fecha y hora LOCALES del usuario');
    assert.match(sistema, /NUNCA crees una actividad nueva para una corrección/);
    assert.match(sistema, /=== TAREA ===/);

    for (const malo of ['', '!!!', '<>', 42]) assert.equal((await c.put('/api/perfil', { nombreIA: malo })).status, 400, malo);
    const r = await c.put('/api/perfil', { nombreIA: 'Luna' });
    assert.equal(r.status, 200); assert.equal(r.data.perfil.nombreIA, 'Luna');
    await c.chat('hola');
    sistema = e.ollama.estado.peticiones.at(-1).sistema;
    assert.match(sistema, /^Eres Luna/); assert.doesNotMatch(sistema, /nombre predeterminado/);
    // Sin el modelo (respaldo), el saludo también usa el nombre
    e.ollama.responder('clasificar', clasif('charla'));
    e.ollama.responder('redactar', 'esto no es json', 'tampoco');
    const saludo = await c.chat('hola de nuevo');
    assert.match(saludo.data.mensaje, /Soy Luna/);
});

test('horario ambiguo: sin hora NO se inventa → requiere_confirmacion con 2-3 horarios libres; elegir uno crea la actividad', async () => {
    const c = await nuevo();
    await c.post('/api/actividades', actividadBase({ titulo: 'Clase', fecha_inicio: MANANA, fecha_fin: MANANA, hora_inicio: '08:00', hora_fin: '10:00', horas: 2 }));
    e.ollama.responder('crear', { actividades: [{ titulo: 'Estudiar cálculo', tipo: 'estudio', exigencia: 2, horas: 2, hora_inicio: '07:00', requiere_confirmacion: false }] });
    const r = await c.chat('Mañana estudio cálculo 2 horas');
    assert.equal(r.data.tipo, 'aclaracion'); assert.equal(r.data.requiere_confirmacion, true);
    const opciones = r.data.aclaracion.preguntas[0].opciones;
    const horas = opciones.filter((o) => o.valor !== 'sin_hora').map((o) => o.valor);
    assert.ok(horas.length >= 2 && horas.length <= 3, horas.join(','));
    assert.ok(!horas.includes('08:00') && !horas.includes('09:00'), 'no sugiere horas ocupadas por la clase');
    assert.match(r.data.mensaje, /Tienes libre a las .+ o /);
    assert.equal((await c.lista()).length, 1, 'nada se crea hasta elegir');
    const elegida = horas[0];
    const ok = await c.chat('', { aclaracionId: r.data.aclaracion.id, respuestas: { hora: elegida } });
    assert.equal(ok.data.tipo, 'aplicado');
    const a = ok.data.actividades.find((x) => x.titulo === 'Estudiar cálculo');
    assert.deepEqual([a.hora_inicio, a.hora_fin], [elegida, deMinutos(aMinutos(elegida) + 120)]);
    // Respuesta escrita y «sin hora»
    e.ollama.responder('crear', { actividades: [{ titulo: 'Leer', tipo: 'estudio', exigencia: 1, horas: 1 }] });
    const r2 = await c.chat('Mañana leo 1 hora');
    const escrito = await c.chat('a las 6 pm', { aclaracionId: r2.data.aclaracion.id });
    assert.equal(escrito.data.actividades.find((x) => x.titulo === 'Leer').hora_inicio, '18:00');
    e.ollama.responder('crear', { actividades: [{ titulo: 'Repasar', tipo: 'estudio', exigencia: 1, horas: 1 }] });
    const r3 = await c.chat('Mañana repaso 1 hora');
    const sin = await c.chat('', { aclaracionId: r3.data.aclaracion.id, respuestas: { hora: 'sin_hora' } });
    assert.equal(sin.data.actividades.find((x) => x.titulo === 'Repasar').hora_inicio, null);
    // Lo que ya pasó («hoy jugué…») o «a cualquier hora» no pregunta
    e.ollama.responder('crear', { actividades: [{ titulo: 'Fútbol', tipo: 'deporte', exigencia: -2, horas: 1 }] });
    assert.equal((await c.chat('Hoy ya jugué fútbol 1 hora')).data.tipo, 'aplicado');
});

test('correcciones: «No, era a las 5» EDITA lo recién creado (nunca crea); «no, cancélala» lo quita', async () => {
    const c = await nuevo();
    e.ollama.responder('crear', { actividades: [{ titulo: 'Taller de cálculo', tipo: 'estudio', exigencia: 2, horas: 2 }] });
    const r = await c.chat('Mañana tengo taller de cálculo de 2 a 4 pm');
    assert.equal(r.data.tipo, 'aplicado');
    const id = r.data.actividades[0].id;
    const crearAntes = e.ollama.peticionesDe('crear').length;
    const clasifAntes = e.ollama.peticionesDe('clasificar').length;
    const corr = await c.chat('No, era a las 5');
    assert.equal(corr.data.tipo, 'aplicado'); assert.equal(corr.data.correccion, true);
    assert.match(corr.data.mensaje, /Corregido/);
    const lista = await c.lista();
    assert.equal(lista.length, 1, 'no se creó nada nuevo');
    assert.deepEqual([lista[0].id, lista[0].hora_inicio, lista[0].hora_fin], [id, '17:00', '19:00'], 'misma actividad, se conserva la duración');
    assert.equal(e.ollama.peticionesDe('crear').length, crearAntes, 'la corrección no pasa por «crear»');
    assert.equal(e.ollama.peticionesDe('clasificar').length, clasifAntes, 'se resuelve en código, sin clasificador');
    const otra = await c.chat('perdón, es pasado mañana');
    assert.equal(otra.data.tipo, 'aplicado'); assert.equal((await c.lista()).length, 1);
    const cancelar = await c.chat('no, cancélala');
    assert.match(cancelar.data.mensaje, /Mandé «Taller de cálculo» a la papelera|quité/);
    assert.equal((await c.lista()).length, 0);

    // Sin una acción reciente, aunque el modelo diga «crear», una corrección nunca crea
    const c2 = await nuevo();
    await c2.post('/api/actividades', actividadBase({ titulo: 'Taller', fecha_inicio: MANANA, fecha_fin: MANANA, hora_inicio: '14:00', hora_fin: '15:00' }));
    e.ollama.responder('clasificar', clasif('crear', { referencia: 'taller' }));
    const r2 = await c2.chat('No, el taller era a las 5');
    assert.notEqual(r2.data.tipo, 'aclaracion');
    const l2 = await c2.lista();
    assert.equal(l2.length, 1); assert.equal(l2[0].hora_inicio, '17:00');
});

test('vencimientos y urgencia: «para el viernes»/«se entrega» fijan fecha_vencimiento; un parcial vence ese día', async () => {
    const c = await nuevo();
    e.ollama.responder('crear', { actividades: [{ titulo: 'Informe de física', tipo: 'estudio', exigencia: 2, horas: 2 }] });
    const r = await c.chat('Mañana a las 9 am avanzo el informe de física, se entrega el 20 de diciembre');
    const informe = r.data.actividades.find((a) => a.titulo === 'Informe de física');
    assert.ok(/-12-20$/.test(informe.fecha_vencimiento), informe.fecha_vencimiento);
    assert.equal(informe.fecha_inicio, MANANA, 'la fecha de trabajo es otra');
    assert.equal(informe.fecha_asignacion, HOY);
    e.ollama.responder('crear', { actividades: [{ titulo: 'Parcial de redes', tipo: 'estudio', exigencia: 3, horas: 2 }] });
    const p = (await c.chat('Mañana tengo parcial de redes de 2 a 4 pm')).data.actividades.find((a) => a.titulo === 'Parcial de redes');
    assert.equal(p.fecha_vencimiento, MANANA);
    assert.equal(prioridadDe(p, HOY).nivel, 'urgente', 'vence en ≤ 2 días');
    assert.equal(prioridadDe({ ...p, fecha_vencimiento: sumarDias(HOY, 5), titulo: 'x', exigencia: 2 }, HOY).nivel, 'alta');
    assert.equal(prioridadDe({ ...p, estado: 'completado' }, HOY).nivel, 'ninguna');
    // Validación manual
    assert.equal((await c.post('/api/actividades', actividadBase({ fecha_inicio: MANANA, fecha_fin: MANANA, fecha_vencimiento: HOY }))).status, 400, 'no puede vencer antes de empezar');
    assert.equal((await c.post('/api/actividades', actividadBase({ fecha_vencimiento: 'pronto' }))).status, 400);
});

test('auto-estado: al pedir las actividades, la que está en su horario pasa a «en proceso» (salvo que el usuario lo fijara)', async () => {
    const c = await nuevo();
    const ahora = ahoraEn('America/Bogota');
    const m = aMinutos(ahora.hora);
    const ini = deMinutos(Math.max(0, m - 30)), fin = deMinutos(Math.min(23 * 60 + 59, m + 30));
    await c.post('/api/actividades', actividadBase({ titulo: 'En curso', fecha_inicio: ahora.fecha, fecha_fin: ahora.fecha, hora_inicio: ini, hora_fin: fin }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Futura', fecha_inicio: sumarDias(ahora.fecha, 2), fecha_fin: sumarDias(ahora.fecha, 2), hora_inicio: ini, hora_fin: fin }));
    await c.post('/api/actividades', actividadBase({ titulo: 'Sin hora', fecha_inicio: ahora.fecha, fecha_fin: ahora.fecha }));
    let lista = (await c.get('/api/actividades', { cabeceras: { 'X-Zona-Horaria': 'America/Bogota' } })).data;
    const estado = (t) => lista.find((a) => a.titulo === t).estado;
    assert.deepEqual([estado('En curso'), estado('Futura'), estado('Sin hora')], ['en_proceso', 'pendiente', 'pendiente']);
    // Si la persona la devuelve a «pendiente», el servidor respeta su decisión
    const id = lista.find((a) => a.titulo === 'En curso').id;
    await c.put(`/api/actividades/${id}`, { estado: 'pendiente' });
    lista = (await c.get('/api/actividades')).data;
    assert.equal(estado('En curso'), 'pendiente');
    // Zona horaria inválida en la cabecera → se ignora (zona del servidor)
    assert.equal((await c.get('/api/actividades', { cabeceras: { 'X-Zona-Horaria': '../../etc' } })).status, 200);
});

test('limpieza automática (node-cron): archiva completadas con el vencimiento pasado; archivadas, desarchivar y proyectos', async () => {
    const c = await nuevo();
    const ayer = sumarDias(HOY, -1), semana = sumarDias(HOY, -7);
    const crear = (titulo, extra) => c.post('/api/actividades', actividadBase({ titulo, proyecto: 'Tesis', ...extra }));
    await crear('Hecha y vencida', { fecha_inicio: semana, fecha_fin: semana, fecha_vencimiento: ayer, estado: 'completado' });
    await crear('Hecha la semana pasada', { fecha_inicio: semana, fecha_fin: semana, estado: 'completado' });
    await crear('Hecha, vence luego', { fecha_inicio: semana, fecha_fin: semana, fecha_vencimiento: MANANA, estado: 'completado' });
    await crear('Pendiente atrasada', { fecha_inicio: semana, fecha_fin: semana });
    const r = await ejecutarLimpieza({ modo: 'archivar', diasGracia: 0, zona: 'America/Bogota' }, new Date(`${HOY}T17:00:00Z`));
    assert.ok(r.cambiadas >= 2);
    const visibles = (await c.lista()).map((a) => a.titulo).sort();
    assert.deepEqual(visibles, ['Hecha, vence luego', 'Pendiente atrasada'], 'solo salen las completadas ya vencidas');
    const archivadas = (await c.get('/api/actividades/archivadas')).data;
    assert.deepEqual(archivadas.map((a) => a.titulo).sort(), ['Hecha la semana pasada', 'Hecha y vencida']);
    assert.ok(archivadas.every((a) => a.archivada === true));
    const conArchivadas = (await c.get('/api/actividades?archivadas=incluir')).data;
    assert.equal(conArchivadas.length, 4);
    const proy = (await c.get('/api/proyectos')).data.proyectos.find((p) => p.nombre === 'Tesis');
    assert.deepEqual([proy.total, proy.completadas, proy.progreso], [4, 3, 75], 'el progreso del proyecto cuenta las archivadas');
    assert.equal(proy.siguiente.titulo, 'Pendiente atrasada');
    const des = await c.post(`/api/actividades/${archivadas[0].id}/desarchivar`);
    assert.equal(des.status, 200); assert.ok(des.data.some((a) => a.id === archivadas[0].id));
    assert.equal((await c.post(`/api/actividades/${archivadas[0].id}/desarchivar`)).status, 404);
    // Modo «eliminar»: a la papelera (se puede restaurar)
    await crear('Para papelera', { fecha_inicio: semana, fecha_fin: semana, estado: 'completado' });
    await ejecutarLimpieza({ modo: 'eliminar', diasGracia: 0, zona: 'America/Bogota' }, new Date(`${HOY}T17:00:00Z`));
    assert.ok((await c.get('/api/papelera')).data.actividades.some((a) => a.titulo === 'Para papelera'));
    assert.equal((await ejecutarLimpieza({ modo: 'desactivado', zona: 'America/Bogota' })).cambiadas, 0);
});

test('limpieza: configuración desde .env y tarea de node-cron programada en la zona horaria', () => {
    assert.deepEqual(configuracionLimpieza({ LIMPIEZA_MODO: 'eliminar', LIMPIEZA_CRON: '0 4 * * *', LIMPIEZA_DIAS_GRACIA: '2' }).expresion, '0 4 * * *');
    const porDefecto = configuracionLimpieza({ LIMPIEZA_MODO: 'raro', LIMPIEZA_CRON: 'no es cron', LIMPIEZA_DIAS_GRACIA: '-3' });
    assert.deepEqual([porDefecto.modo, porDefecto.expresion, porDefecto.diasGracia], ['archivar', '15 3 * * *', 0]);
    assert.ok(cron.validate(porDefecto.expresion));
    const silencio = { log: () => {}, error: () => {} };
    assert.equal(iniciarLimpiezaAutomatica({ ...porDefecto, modo: 'desactivado' }, { registrar: silencio }), null);
    const tarea = iniciarLimpiezaAutomatica({ ...porDefecto, expresion: '0 0 1 1 *' }, { registrar: silencio });
    assert.ok(tarea && typeof tarea.stop === 'function');
    tarea.stop();
});
