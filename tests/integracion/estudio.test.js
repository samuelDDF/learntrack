// Módulo Estudio (v3.12) por la API, con Ollama SIMULADO: objetivos de aprendizaje, separación entre cuentas,
// sugerencias de la IA (aceptar / posponer / descartar, menciones repetidas), plan de sesiones que respeta la
// agenda y solo se guarda al confirmar, análisis de documentos académicos (sin fechas inventadas) y contexto del
// asistente en Estudio y Proyectos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, hoyLocal, actividadBase } from '../utilidades/entorno.js';
import { sumarDias, aMinutos } from '../../compartido/fechas.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const BOGOTA = 300;
const HOY = hoyLocal(BOGOTA);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const enTexto = (iso) => `${Number(iso.slice(8))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;
const clasif = (intencion, extra = {}) => ({ intencion, ids: [], referencia: '', proyecto: '', fecha_objetivo: '', fecha_destino: '', modo: 'ninguno', ...extra });

const nuevo = async () => {
    const c = await e.cliente();
    c.chat = (texto, extra = {}) => c.post('/api/ia/chat', { texto, fechaHoy: HOY, tzOffset: BOGOTA, ...extra });
    c.estudio = async () => (await c.get('/api/estudio')).data;
    c.crearActividad = async (extra) => (await c.post('/api/actividades', actividadBase({ fecha_inicio: HOY, fecha_fin: HOY, ...extra }))).data.at(-1);
    return c;
};
const subir = (c, nombre, contenido, ruta = '/api/estudio/analizar') => {
    const fd = new FormData();
    fd.append('fechaHoy', HOY); fd.append('tzOffset', String(BOGOTA));
    fd.append('archivo', new Blob([Buffer.from(contenido, 'utf8')], { type: 'text/plain' }), nombre);
    return c.post(ruta, fd);
};
const solapan = (a, b) => a.fecha_inicio === b.fecha_inicio && a.hora_inicio && b.hora_inicio
    && aMinutos(a.hora_inicio) < aMinutos(b.hora_fin) && aMinutos(b.hora_inicio) < aMinutos(a.hora_fin);

// ------------------------------------------------------------------ objetivos y separación entre cuentas
test('objetivos: crear, editar, sin duplicados, progreso calculado y aislados entre cuentas', async () => {
    const c = await nuevo();
    const r = await c.post('/api/estudio', { tema: 'JavaScript', fechaLimite: sumarDias(HOY, 10), prioridad: 3, horasEstimadas: 6, nivelActual: 'basico', nivelObjetivo: 'intermedio' });
    assert.equal(r.status, 201);
    const o = r.data.objetivo;
    assert.equal(o.estado, 'pendiente');
    assert.equal(o.resumen.situacion, 'en_plazo');
    assert.equal(o.resumen.progreso, 0);
    assert.equal((await c.post('/api/estudio', { tema: 'javascript' })).status, 409, 'mismo tema con otras mayúsculas → no se duplica');
    assert.equal((await c.post('/api/estudio', { tema: 'x' })).status, 400);
    assert.equal((await c.post('/api/estudio', { tema: 'React', fechaLimite: '2026-02-30' })).status, 400);

    const ed = await c.put(`/api/estudio/${o.id}`, { fechaLimite: sumarDias(HOY, 3), progresoManual: 40 });
    assert.equal(ed.status, 200);
    assert.equal(ed.data.objetivo.resumen.situacion, 'proximo', 'vence en ≤ 7 días');
    assert.equal(ed.data.objetivo.resumen.progreso, 40);
    const atrasado = await c.put(`/api/estudio/${o.id}`, { fechaLimite: sumarDias(HOY, -2) });
    assert.equal(atrasado.data.objetivo.resumen.situacion, 'atrasado');

    const otra = await nuevo();
    assert.deepEqual((await otra.estudio()).objetivos, [], 'otra cuenta no ve los objetivos');
    assert.equal((await otra.put(`/api/estudio/${o.id}`, { tema: 'Robado' })).status, 404);
    assert.equal((await otra.del(`/api/estudio/${o.id}`)).status, 404);
    assert.equal((await otra.post('/api/estudio/plan', { ids: [o.id] })).status, 404);
    assert.equal((await otra.post('/api/estudio/sesiones', { sesiones: [{ objetivoId: o.id, fecha: sumarDias(HOY, 1), hora_inicio: '10:00', horas: 1 }] })).status, 404);
    assert.equal((await c.estudio()).objetivos[0].tema, 'JavaScript', 'sigue intacto');
    assert.equal((await e.sinSesion().get('/api/estudio')).status, 401);
});

// ------------------------------------------------------------------ plan de sesiones
test('plan de sesiones: respeta lo ocupado, reparte antes de la fecha límite y no guarda nada sin confirmar', async () => {
    const c = await nuevo();
    // Tardes ocupadas los próximos días (14:00–20:00) y un día ya muy cargado
    for (let i = 1; i <= 6; i++) await c.crearActividad({ titulo: `Clase ${i}`, fecha_inicio: sumarDias(HOY, i), fecha_fin: sumarDias(HOY, i), hora_inicio: '14:00', hora_fin: '20:00', horas: 6, exigencia: 1 });
    await c.crearActividad({ titulo: 'Maratón de entregas', fecha_inicio: sumarDias(HOY, 3), fecha_fin: sumarDias(HOY, 3), hora_inicio: '07:00', hora_fin: '13:00', horas: 6, exigencia: 3 });
    const limite = sumarDias(HOY, 7);
    const a = (await c.post('/api/estudio', { tema: 'Bases de datos', fechaLimite: limite, horasEstimadas: 3, prioridad: 2 })).data.objetivo;
    const b = (await c.post('/api/estudio', { tema: 'Redes', fechaLimite: sumarDias(HOY, 5), horasEstimadas: 2, prioridad: 3 })).data.objetivo;
    const antes = (await c.get('/api/actividades')).data.length;

    const r = await c.post('/api/estudio/plan', { ids: [a.id, b.id], horasPorSesion: 1 });
    assert.equal(r.status, 200);
    const { sesiones, explicaciones } = r.data.plan;
    assert.equal(sesiones.filter((s) => s.objetivoId === a.id).length, 3);
    assert.equal(sesiones.filter((s) => s.objetivoId === b.id).length, 2);
    assert.match(explicaciones[0], /vence antes/);
    const ocupadas = (await c.get('/api/actividades')).data;
    assert.equal(ocupadas.length, antes, 'pedir el plan no escribe nada');
    for (const s of sesiones) {
        const sesion = { fecha_inicio: s.fecha, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin };
        assert.ok(!ocupadas.some((x) => solapan(sesion, x)), `sesión ${s.fecha} ${s.hora_inicio} se cruza con algo`);
        assert.ok(s.fecha < (s.objetivoId === a.id ? limite : sumarDias(HOY, 5)), 'antes de la fecha límite');
        assert.notEqual(s.fecha, sumarDias(HOY, 3), 'el día sobrecargado se evita');
        assert.ok(s.carga <= 85);
    }
    const porDia = {};
    for (const s of sesiones) porDia[s.fecha] = (porDia[s.fecha] ?? 0) + 1;
    assert.ok(Object.values(porDia).every((n) => n <= 2), 'como máximo 2 sesiones de estudio por día');
    for (const id of [a.id, b.id]) {
        const dias = sesiones.filter((s) => s.objetivoId === id).map((s) => s.fecha);
        assert.equal(new Set(dias).size, dias.length, 'una sesión por tema y día');
    }

    // La persona AJUSTA una hora y una duración antes de confirmar
    const ajustadas = sesiones.map((s) => ({ objetivoId: s.objetivoId, fecha: s.fecha, hora_inicio: s.hora_inicio, horas: s.horas }));
    ajustadas[0] = { ...ajustadas[0], hora_inicio: '21:00', horas: 1.5 };
    const g = await c.post('/api/estudio/sesiones', { sesiones: ajustadas });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    assert.ok(g.data.loteId);
    const guardadas = g.data.actividades.filter((x) => x.objetivoId);
    assert.equal(guardadas.length, sesiones.length);
    assert.ok(guardadas.some((x) => x.hora_inicio === '21:00' && x.horas === 1.5 && x.hora_fin === '22:30'));
    assert.ok(guardadas.every((x) => x.tipo === 'estudio' && /^Estudio: /.test(x.titulo)));
    const est = await c.estudio();
    assert.equal(est.objetivos.find((o) => o.id === a.id).estado, 'en_curso');
    assert.equal(est.objetivos.find((o) => o.id === a.id).resumen.horasProgramadas, a.id === ajustadas[0].objetivoId ? 3.5 : 3);
    assert.ok(est.proximasSesiones.length >= sesiones.length);

    // Volver a pedir el plan: ya no faltan horas → no se duplica nada
    const otraVez = await c.post('/api/estudio/plan', { ids: [a.id, b.id] });
    assert.equal(otraVez.data.plan.sesiones.length, 0);
    assert.ok(otraVez.data.plan.avisos.some((x) => /ya tiene en el calendario/.test(x)));

    // Confirmar de nuevo lo mismo, un hueco ocupado o una hora pasada → 409 y NO se guarda nada
    const total = (await c.get('/api/actividades')).data.length;
    const dup = await c.post('/api/estudio/sesiones', { sesiones: [ajustadas[1]] });
    assert.equal(dup.status, 409);
    assert.match(dup.data.conflictos[0].motivo, /ya hay una sesión/);
    const diaLibreDeA = [1, 2, 4, 5, 6].map((i) => sumarDias(HOY, i)).find((d) => !sesiones.some((s) => s.objetivoId === a.id && s.fecha === d));
    const choque = await c.post('/api/estudio/sesiones', { sesiones: [{ objetivoId: a.id, fecha: diaLibreDeA, hora_inicio: '15:00', horas: 1 }] });
    assert.equal(choque.status, 409);
    assert.match(choque.data.conflictos[0].motivo, /se cruza con «Clase \d»/);
    const pasada = await c.post('/api/estudio/sesiones', { sesiones: [{ objetivoId: a.id, fecha: sumarDias(HOY, -1), hora_inicio: '10:00', horas: 1 }] });
    assert.equal(pasada.status, 409);
    assert.equal((await c.get('/api/actividades')).data.length, total);
    assert.equal((await c.post('/api/estudio/sesiones', { sesiones: [{ objetivoId: a.id, fecha: sumarDias(HOY, 9), hora_inicio: '25:00', horas: 1 }] })).status, 400);

    // Deshacer el lote quita las sesiones guardadas
    const d = await c.post(`/api/operaciones/${g.data.loteId}/deshacer`);
    assert.equal(d.status, 200);
    assert.equal(d.data.actividades.filter((x) => x.objetivoId).length, 0);
});

test('eliminar un objetivo: sus sesiones siguen en el calendario como actividades normales', async () => {
    const c = await nuevo();
    const o = (await c.post('/api/estudio', { tema: 'Álgebra', horasEstimadas: 1 })).data.objetivo;
    const g = await c.post('/api/estudio/sesiones', { sesiones: [{ objetivoId: o.id, fecha: sumarDias(HOY, 2), hora_inicio: '09:00', horas: 1 }] });
    assert.equal(g.status, 201);
    assert.equal((await c.del(`/api/estudio/${o.id}`)).status, 200);
    const acts = (await c.get('/api/actividades')).data;
    assert.equal(acts.length, 1);
    assert.equal(acts[0].objetivoId ?? null, null);
});

// ------------------------------------------------------------------ IA: detección de necesidades
test('dificultad explícita → sugerencia explicada (aceptar / posponer / descartar); una pregunta informativa NO crea tema', async () => {
    const c = await nuevo();
    // «¿Qué es…?» se explica (tutor) pero no se registra como tema de estudio
    const info = await c.chat('¿Qué es una API REST?', { contexto: { seccion: 'estudio' } });
    assert.equal(info.data.tipo, 'respuesta');
    assert.match(info.data.mensaje, /tutor/);
    assert.equal(e.ollama.peticionesDe('clasificar').length, 0, 'no hace falta clasificar');
    assert.deepEqual((await c.estudio()).sugerencias, []);

    const r = await c.chat('No entiendo cómo funcionan las API REST');
    assert.equal(r.data.tipo, 'sugerencia_estudio');
    const s = r.data.sugerencias[0];
    assert.equal(s.objetivo.tema, 'API REST');
    assert.equal(s.objetivo.estado, 'sugerido');
    assert.match(s.motivo, /Lo dijiste en el chat/);
    assert.match(r.data.mensaje, /Explicación simulada del tutor/, '«no entiendo» también recibe la explicación');
    assert.match(r.data.mensaje, /aceptas, lo pospones o lo descartas/);
    assert.equal((await c.get('/api/actividades')).data.length, 0, 'una sugerencia no toca el calendario');

    // Repetida: cuenta las menciones
    const r2 = await c.chat('Tengo dificultades con las API REST');
    assert.equal(r2.data.sugerencias[0].estado, 'repetida');
    assert.match(r2.data.mensaje, /2\.ª vez/);

    const id = s.objetivo.id;
    let est = await c.estudio();
    assert.equal(est.sugerencias.length, 1);
    assert.equal(est.objetivos.length, 0, 'aún no está aceptado');
    const pos = await c.post(`/api/estudio/${id}/sugerencia`, { accion: 'posponer', dias: 3 });
    assert.equal(pos.status, 200);
    est = await c.estudio();
    assert.equal(est.sugerencias.length, 0);
    assert.equal(est.pospuestas, 1);
    const otra = await nuevo();
    assert.equal((await otra.post(`/api/estudio/${id}/sugerencia`, { accion: 'aceptar' })).status, 404, 'no se responde la sugerencia de otra cuenta');
    const ok = await c.post(`/api/estudio/${id}/sugerencia`, { accion: 'aceptar' });
    assert.equal(ok.data.objetivo.estado, 'pendiente');
    assert.equal((await c.post(`/api/estudio/${id}/sugerencia`, { accion: 'descartar' })).status, 409, 'ya respondida');

    // Descartada: no se vuelve a sugerir por contexto, pero sí si la persona lo dice de nuevo
    const otraS = (await c.chat('Me cuesta mucho la recursividad')).data.sugerencias[0];
    await c.post(`/api/estudio/${otraS.objetivo.id}/sugerencia`, { accion: 'descartar' });
    assert.equal((await c.estudio()).sugerencias.length, 0);
    const deNuevo = await c.chat('Sigo sin entender la recursividad');
    assert.equal(deNuevo.data.tipo, 'sugerencia_estudio');
    assert.equal((await c.estudio()).sugerencias.length, 1);
});

test('«Quiero aprender X antes del…» → plan de estudio confirmable; al aplicarlo el tema queda en curso con sus sesiones', async () => {
    const c = await nuevo();
    const limite = sumarDias(HOY, 12);
    const r = await c.chat(`Quiero aprender JavaScript antes del ${enTexto(limite)}`);
    assert.equal(r.data.tipo, 'aclaracion', 'pregunta solo lo que falta (tiempo diario)');
    assert.deepEqual(r.data.aclaracion.preguntas.map((p) => p.id), ['horas_dia']);
    const r2 = await c.chat('', { aclaracionId: r.data.aclaracion.id, respuestas: { horas_dia: '1' } });
    assert.equal(r2.data.tipo, 'propuesta');
    assert.match(r2.data.propuesta.titulo, /JavaScript/);
    let est = await c.estudio();
    assert.equal(est.sugerencias[0].tema, 'JavaScript', 'mientras no se aplica, es una sugerencia');
    assert.equal(est.sugerencias[0].fechaLimite, limite);
    const ap = await c.post(`/api/propuestas/${r2.data.propuesta.id}/aplicar`);
    assert.equal(ap.status, 200);
    est = await c.estudio();
    const o = est.objetivos.find((x) => x.tema === 'JavaScript');
    assert.equal(o.estado, 'en_curso');
    assert.ok(o.resumen.sesionesTotales >= 2);
    assert.ok(ap.data.actividades.filter((a) => a.objetivoId === o.id).every((a) => a.fecha_inicio < limite));
});

test('Proyectos: «¿qué necesito aprender?» deduce temas de las tareas del proyecto abierto; lo descartado no vuelve', async () => {
    const c = await nuevo();
    await c.crearActividad({ titulo: 'Diseñar la API', proyecto: 'App de notas', fecha_inicio: sumarDias(HOY, 2), fecha_fin: sumarDias(HOY, 2) });
    await c.crearActividad({ titulo: 'Conectar la base de datos', proyecto: 'App de notas', fecha_inicio: sumarDias(HOY, 3), fecha_fin: sumarDias(HOY, 3) });
    const r = await c.chat('¿Qué necesito aprender para este proyecto?', { contexto: { seccion: 'proyectos', proyecto: 'App de notas' } });
    assert.equal(r.data.tipo, 'sugerencia_estudio');
    assert.deepEqual(r.data.sugerencias.map((s) => s.objetivo.tema), ['API REST', 'MongoDB']);
    assert.ok(r.data.sugerencias.every((s) => s.objetivo.proyecto === 'App de notas' && /Proyecto «App de notas»/.test(s.motivo)));
    const tareas = e.ollama.peticionesDe('temas_proyecto').at(-1).usuario;
    assert.match(tareas, /Diseñar la API/);
    await c.post(`/api/estudio/${r.data.sugerencias[0].objetivo.id}/sugerencia`, { accion: 'descartar' });
    const r2 = await c.chat('¿Qué necesito aprender para este proyecto?', { contexto: { seccion: 'proyectos', proyecto: 'App de notas' } });
    assert.deepEqual(r2.data.sugerencias.map((s) => s.objetivo.tema), ['MongoDB']);
    // Un proyecto que no es de la cuenta no aporta contexto
    const otra = await nuevo();
    const r3 = await otra.chat('¿Qué necesito aprender para este proyecto?', { contexto: { seccion: 'proyectos', proyecto: 'App de notas' } });
    assert.notEqual(r3.data.tipo, 'sugerencia_estudio');
});

test('tutor en Estudio: recibe los temas y el progreso del usuario (y nunca los de otra cuenta)', async () => {
    const c = await nuevo();
    const o = (await c.post('/api/estudio', { tema: 'Cálculo integral', nivelActual: 'basico', fechaLimite: sumarDias(HOY, 20) })).data.objetivo;
    const otra = await nuevo();
    const ajeno = (await otra.post('/api/estudio', { tema: 'Tema secreto de otra cuenta' })).data.objetivo;
    e.ollama.responder('clasificar', clasif('charla'));
    const r = await c.chat('Hola, ¿me ayudas a avanzar hoy?', { contexto: { seccion: 'estudio', objetivoId: o.id } });
    assert.equal(r.data.tipo, 'respuesta');
    const sistema = e.ollama.peticionesDe('tutor').at(-1).sistema;
    assert.match(sistema, /Cálculo integral/);
    assert.match(sistema, /Básico/);
    assert.match(sistema, /temaEnFoco/);
    // Con el id de un objetivo AJENO: no aparece su tema
    await c.chat('Explícame este tema', { contexto: { seccion: 'estudio', objetivoId: ajeno.id } });
    assert.doesNotMatch(e.ollama.peticionesDe('tutor').at(-1).sistema, /Tema secreto/);
});

// ------------------------------------------------------------------ análisis de documentos académicos
test('análisis de un taller: temas, requisitos y fechas por tipo; descarta fechas inventadas; nada se guarda hasta confirmar', async () => {
    const c = await nuevo();
    const entrega = sumarDias(HOY, 9), publicado = sumarDias(HOY, -3);
    const doc = `Taller 3 de Programación Web.\nPublicado el ${enTexto(publicado)}.\nTemas: JavaScript, funciones, arreglos y manipulación del DOM.\n`
        + `Fecha de entrega: ${enTexto(entrega)}, por la plataforma.\nINVENTA\n`;
    const r = await subir(c, 'taller.txt', doc);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.tipo, 'analisis_estudio');
    const a = r.data.analisis;
    assert.deepEqual(a.temas.filter((t) => t.enDocumento).map((t) => t.tema), ['JavaScript', 'funciones', 'arreglos', 'manipulación del DOM']);
    assert.equal(a.temas.find((t) => t.tema === 'Lógica de programación').enDocumento, false, 'conocimiento previo deducido, marcado como tal');
    const tipos = Object.fromEntries(a.fechas.map((f) => [f.tipo, f]));
    assert.equal(tipos.entrega.fecha, entrega);
    assert.equal(tipos.publicacion.fecha, publicado);
    assert.equal(tipos.publicacion.pasada, true);
    assert.ok(!a.fechas.some((f) => f.descripcion === 'inventada'), 'la fecha que no aparece en el documento se descarta');
    assert.ok(a.avisos.some((x) => /no invento fechas/.test(x)));
    assert.equal(a.fechaLimiteSugerida, entrega, 'la fecha límite es la de ENTREGA, no la de publicación');
    assert.deepEqual(a.requisitos, ['Usar JavaScript']);
    assert.equal((await c.estudio()).objetivos.length + (await c.estudio()).sugerencias.length, 0, 'analizar no guarda nada');
    assert.equal((await c.get('/api/actividades')).data.length, 0);

    // La persona corrige un tema, descarta otros y confirma con la entrega
    const l = await c.post('/api/estudio/lote', {
        objetivos: [{ tema: 'JavaScript básico', motivo: 'Lo pide el taller', horasEstimadas: 3 }, { tema: 'Manipulación del DOM', horasEstimadas: 2 }],
        fechaLimite: entrega, entrega: { titulo: 'Entrega: Taller 3', fecha: entrega }
    });
    assert.equal(l.status, 201, JSON.stringify(l.data));
    assert.deepEqual(l.data.creados.map((o) => o.tema), ['JavaScript básico', 'Manipulación del DOM']);
    assert.ok(l.data.creados.every((o) => o.fechaLimite === entrega && o.origen === 'documento'));
    const acts = (await c.get('/api/actividades')).data;
    assert.equal(acts.length, 1);
    assert.deepEqual([acts[0].titulo, acts[0].fecha_inicio, acts[0].fija, acts[0].fecha_vencimiento], ['Entrega: Taller 3', entrega, true, entrega]);
    // Confirmar otra vez no duplica ni temas ni la entrega
    const l2 = await c.post('/api/estudio/lote', { objetivos: [{ tema: 'JavaScript básico' }], entrega: { titulo: 'Entrega: Taller 3', fecha: entrega } });
    assert.equal(l2.data.creados.length, 0);
    assert.equal(l2.data.existentes.length, 1);
    assert.ok(l2.data.avisos.some((x) => /no la dupliqué/.test(x)));
    assert.equal((await c.get('/api/actividades')).data.length, 1);
    assert.equal((await c.post('/api/estudio/lote', { objetivos: [{ tema: 'X1' }], fechaLimite: sumarDias(HOY, -1) })).status, 400, 'fecha pasada');
});

test('análisis: fecha relativa o con varias fechas → pide confirmación; varias entregas → no elige sola; IA caída → 503', async () => {
    const c = await nuevo();
    const f1 = sumarDias(HOY, 8), f2 = sumarDias(HOY, 15);
    e.ollama.responder('analisis', {
        titulo: 'Proyecto final', resumen: '', requisitos: [], entregables: [], temas: [{ tema: 'SQL', tipo: 'tema', motivo: '', en_documento: true, cita: 'SQL', horas: 2 }],
        fechas: [
            { tipo: 'examen', texto: 'el viernes', descripcion: 'Quiz', cita: 'Quiz el viernes' },
            { tipo: 'entrega', texto: enTexto(f1), descripcion: 'Avance', cita: `Avance: ${enTexto(f1)}` },
            { tipo: 'entrega', texto: enTexto(f2), descripcion: 'Final', cita: `Final: ${enTexto(f2)}` }
        ]
    });
    const r = await subir(c, 'proyecto.md', `# Proyecto final\nUsa SQL.\nQuiz el viernes.\nAvance: ${enTexto(f1)}.\nFinal: ${enTexto(f2)}.`);
    assert.equal(r.status, 200);
    const a = r.data.analisis;
    assert.equal(a.fechas.find((f) => f.tipo === 'examen').requiereConfirmacion, true, '«el viernes» es relativo');
    assert.equal(a.fechaLimiteSugerida, null, 'dos entregas distintas: la persona elige');
    assert.ok(a.avisos.some((x) => /varias fechas de entrega/.test(x)));

    assert.equal((await subir(c, 'cal.ics', 'BEGIN:VCALENDAR\nEND:VCALENDAR')).status, 415, 'los .ics se importan desde el chat');
    e.ollama.modo('caido');
    try {
        assert.equal((await subir(c, 'taller.txt', 'Temas: Redes.')).status, 503);
    } finally { e.ollama.modo('normal'); }
});
