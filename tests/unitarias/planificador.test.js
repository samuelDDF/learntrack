// Planificador determinista: liberar un día, reorganizar y desglose de proyectos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liberarDia, reorganizar, planificarProyecto, seSolapa, simularOperaciones, cargasAntesDespues, mejorDia, desplazar, horariosLibres } from '../../backend/servicios/asistente/planificador.js';
import { cargaDelDia, actividadesDelDia } from '../../compartido/carga.js';
import { rangoFechas, sumarDias } from '../../compartido/fechas.js';

const HOY = '2026-10-07';
let n = 0;
const A = (titulo, fi, ff, exigencia, horas, extra = {}) => ({ id: `a${++n}`, titulo, tipo: exigencia < 0 ? 'deporte' : 'estudio', exigencia, horas, fecha_inicio: fi, fecha_fin: ff, fecha: fi, estado: 'pendiente', proyecto: '', hora_inicio: null, hora_fin: null, ...extra });
const aplicar = (acts, r) => simularOperaciones(acts, [...r.mover.map((m) => ({ op: 'editar', id: m.id, cambios: m.cambios })), ...r.crear.map((c) => ({ op: 'crear', datos: c.datos })), ...r.eliminar.map((e) => ({ op: 'eliminar', id: e.id }))]);

test('liberar un día (aplazar): decide sobre TODAS las pendientes (hitos desmarcados), deja las completadas, ≤ 85 %, sin solapes, explica cada decisión', () => {
    const acts = [
        A('Taller de cálculo', '2026-10-08', '2026-10-08', 2, 2),
        A('Lectura', '2026-10-08', '2026-10-08', 1, 1, { hora_inicio: '18:00', hora_fin: '19:00' }),
        A('Parcial de redes', '2026-10-08', '2026-10-08', 3, 2),
        A('Ya hecho', '2026-10-08', '2026-10-08', 1, 1, { estado: 'completado' }),
        A('Fija por usuario', '2026-10-08', '2026-10-08', 1, 1, { fija: true }),
        A('Ocupa el viernes', '2026-10-09', '2026-10-09', 2, 4),
        A('Clase 18h sábado', '2026-10-10', '2026-10-10', 1, 1, { hora_inicio: '18:00', hora_fin: '19:30' })
    ];
    const todo = liberarDia({ actividades: acts, fecha: '2026-10-08', hoy: HOY, capacidades: {} });
    // TODAS las pendientes del día reciben una decisión; los hitos/fijas llegan DESMARCADOS y con aviso
    assert.deepEqual(todo.mover.map((m) => m.titulo).sort(), ['Fija por usuario', 'Lectura', 'Parcial de redes', 'Taller de cálculo']);
    for (const t of ['Parcial de redes', 'Fija por usuario']) {
        const m = todo.mover.find((x) => x.titulo === t);
        assert.equal(m.marcado, false, t); assert.match(m.aviso, /examen|entrega|fija/);
    }
    assert.ok(todo.explicaciones.some((e) => e.includes('«Ya hecho» ya está completada')));
    const r = { ...todo, mover: todo.mover.filter((m) => m.marcado !== false) };     // lo que se aplica por defecto
    assert.deepEqual(r.mover.map((m) => m.titulo).sort(), ['Lectura', 'Taller de cálculo']);
    for (const m of r.mover) assert.match(m.motivo, /^Moví «.+» (al|a partir del) .+ porque (ese día tienes|esos días tienes como máximo) \d+ % de carga\.$/);
    const despues = aplicar(acts, r);
    for (const m of r.mover) {
        const a = despues.find((x) => x.id === m.id);
        assert.notEqual(a.fecha_inicio, '2026-10-08');
        assert.ok(a.fecha_inicio > '2026-10-08' && a.fecha_inicio <= '2026-10-15', 'ventana de 7 días');
        assert.ok(cargaDelDia(despues, a.fecha_inicio).porcentaje <= 85, 'no supera el 85 %');
        assert.ok(!seSolapa(despues, a, a.fecha_inicio), 'sin solapamientos');
    }
    const lectura = despues.find((a) => a.titulo === 'Lectura');
    assert.notEqual(lectura.fecha_inicio, '2026-10-10', 'no la pone el sábado: se cruza con la clase de las 18:00');
    assert.equal(lectura.hora_inicio, '18:00', 'respeta la hora');
});

test('liberar: prefiere días con menos carga y cercanos; ocio/deporte no van a días saturados', () => {
    const acts = [
        A('Mover', '2026-10-08', '2026-10-08', 2, 1),
        A('Fútbol', '2026-10-08', '2026-10-08', -2, 1),
        A('Saturado', '2026-10-09', '2026-10-09', 3, 3)
    ];
    const r = liberarDia({ actividades: acts, fecha: '2026-10-08', hoy: HOY });
    const futbol = r.mover.find((m) => m.titulo === 'Fútbol');
    assert.notEqual(futbol.cambios.fecha_inicio, '2026-10-09', 'el viernes está al 90 %');
    const mover = r.mover.find((m) => m.titulo === 'Mover');
    assert.equal(mover.cambios.fecha_inicio, '2026-10-10', 'el día libre más cercano');
});

test('liberar: una actividad de rango se desplaza completa conservando su duración', () => {
    const acts = [A('Informe', '2026-10-07', '2026-10-09', 2, 1)];
    const r = liberarDia({ actividades: acts, fecha: '2026-10-08', hoy: HOY });
    const c = r.mover[0].cambios;
    assert.equal(rangoFechas(c.fecha_inicio, c.fecha_fin).length, 3);
    assert.ok(c.fecha_inicio > '2026-10-08', 'el nuevo rango ya no incluye el día liberado');
});

test('liberar: si nada cabe, propone lo menos malo y lo avisa', () => {
    const acts = [A('Grande', '2026-10-08', '2026-10-08', 2, 5)];          // 100 pts: no cabe en ningún día sin pasar del 85 %
    for (let i = 1; i <= 8; i++) acts.push(A(`Lleno ${i}`, sumarDias('2026-10-08', i), sumarDias('2026-10-08', i), 3, 3));
    const r = liberarDia({ actividades: acts, fecha: '2026-10-08', hoy: HOY });
    assert.equal(r.mover.length, 1);
    assert.ok(r.avisos.some((a) => a.includes('lo menos malo')));
});

test('liberar con modo eliminar: todas van a la papelera; los hitos, desmarcados', () => {
    const acts = [A('Taller', '2026-10-08', '2026-10-08', 2, 1), A('Examen final', '2026-10-08', '2026-10-08', 2, 1)];
    const r = liberarDia({ actividades: acts, fecha: '2026-10-08', hoy: HOY, modo: 'eliminar' });
    assert.deepEqual(r.eliminar.map((e) => [e.titulo, e.marcado]).sort(), [['Examen final', false], ['Taller', true]]);
    assert.equal(r.mover.length, 0);
});

test('urgencia: liberar nunca aplaza una tarea más allá de su fecha de vencimiento y coloca primero lo urgente', () => {
    const acts = [
        A('Informe urgente', '2026-10-08', '2026-10-08', 2, 2, { fecha_vencimiento: '2026-10-09' }),
        A('Lectura sin prisa', '2026-10-08', '2026-10-08', 1, 2)
    ];
    const r = liberarDia({ actividades: acts, fecha: '2026-10-08', hoy: HOY });
    assert.equal(r.mover[0].titulo, 'Informe urgente', 'lo urgente se reubica primero');
    assert.equal(r.mover[0].cambios.fecha_inicio, '2026-10-09', 'como tarde el día que vence');
});

test('horarios libres: 2-3 sugerencias (mañana, tarde, noche) sin cruzarse y después de la hora actual', () => {
    const acts = [A('Clase', '2026-10-08', '2026-10-08', 2, 2, { hora_inicio: '08:00', hora_fin: '10:00' }), A('Turno', '2026-10-08', '2026-10-08', 2, 3, { hora_inicio: '14:00', hora_fin: '17:00' })];
    const h = horariosLibres({ actividades: acts, fecha: '2026-10-08', horas: 1, hoy: HOY });
    assert.deepEqual(h, ['10:00', '13:00', '18:00'], 'esquiva la clase (8-10) y el turno (14-17)');
    const hoyTarde = horariosLibres({ actividades: [], fecha: HOY, horas: 1, hoy: HOY, horaActual: '15:10' });
    assert.ok(hoyTarde.every((x) => x >= '16:00') && hoyTarde.length >= 2, hoyTarde.join(','));
    assert.deepEqual(horariosLibres({ actividades: [], fecha: HOY, horas: 1, hoy: HOY, horaActual: '23:00' }), [], 'de noche ya no queda hueco hoy');
});

test('liberar respeta la fecha límite de un proyecto (no aplaza más allá de su entrega)', () => {
    const acts = [A('Avance', '2026-10-08', '2026-10-08', 2, 1, { proyecto: 'Tesis' }), A('Entrega tesis', '2026-10-10', '2026-10-10', 3, 1, { proyecto: 'Tesis' }), A('Ocupa 9', '2026-10-09', '2026-10-09', 3, 3)];
    const r = liberarDia({ actividades: acts, fecha: '2026-10-08', hoy: HOY });
    assert.ok(r.mover[0].cambios.fecha_inicio <= '2026-10-09');
});

test('reorganizar: baja los días > 85 % y, si no se puede, inserta descanso', () => {
    const acts = [A('A', '2026-10-08', '2026-10-08', 2, 3), A('B', '2026-10-08', '2026-10-08', 2, 2), A('Examen', '2026-10-09', '2026-10-09', 3, 4)];
    const r = reorganizar({ actividades: acts, desde: HOY, hasta: '2026-10-13', hoy: HOY });
    const despues = aplicar(acts, r);
    assert.ok(cargaDelDia(despues, '2026-10-08').porcentaje <= 85);
    assert.ok(r.crear.some((c) => c.datos.fecha_inicio === '2026-10-09' && c.datos.tipo === 'ocio' && c.datos.exigencia === -2), 'descanso el día del examen (no se puede mover)');
    const equilibrada = reorganizar({ actividades: [A('Poco', HOY, HOY, 1, 1)], desde: HOY, hasta: '2026-10-13', hoy: HOY });
    assert.equal(equilibrada.mover.length + equilibrada.crear.length, 0);
});

test('proyecto: tareas en orden antes de la fecha límite con 1 día de colchón, ≤ horas/día y ≤ 85 %', () => {
    const tareas = [
        { titulo: 'Investigar', tipo: 'estudio', exigencia: 1, horas: 2, orden: 1 },
        { titulo: 'Diseñar', tipo: 'estudio', exigencia: 2, horas: 3, orden: 2 },
        { titulo: 'Construir', tipo: 'estudio', exigencia: 3, horas: 4, orden: 3 },
        { titulo: 'Entrega final', tipo: 'estudio', exigencia: 3, horas: 1, orden: 4, hito: true }
    ];
    const base = [A('Clase', '2026-10-08', '2026-10-08', 2, 3)];
    const r = planificarProyecto({ actividades: base, tareas, nombre: 'Robótica', fechaLimite: '2026-10-20', horasDia: 2, hoy: HOY });
    const creadas = r.crear.map((c) => c.datos);
    assert.ok(creadas.every((a) => a.proyecto === 'Robótica'), 'campo proyecto → el Timeline las agrupa');
    const trabajo = creadas.filter((a) => !a.fija);
    assert.ok(trabajo.every((a) => a.fecha_fin <= '2026-10-18'), 'termina antes del colchón (19) y la entrega (20)');
    const hito = creadas.find((a) => a.fija);
    assert.equal(hito.fecha_inicio, '2026-10-20');
    const despues = [...base, ...creadas.map((a, i) => ({ ...a, id: `n${i}` }))];
    for (const d of rangoFechas(HOY, '2026-10-18')) {
        const delProyecto = actividadesDelDia(despues, d).filter((a) => a.proyecto === 'Robótica').reduce((s, a) => s + a.horas, 0);
        assert.ok(delProyecto <= 2, `${d}: ${delProyecto} h del proyecto`);
        assert.ok(cargaDelDia(despues, d).porcentaje <= 85, `${d} ≤ 85 %`);
    }
    const horasTotales = trabajo.reduce((s, a) => s + a.horas * rangoFechas(a.fecha_inicio, a.fecha_fin).length, 0);
    assert.equal(horasTotales, 9, 'se agendan todas las horas');
    const orden = ['Investigar', 'Diseñar', 'Construir'].map((t) => trabajo.find((a) => a.titulo.startsWith(t)).fecha_inicio);
    assert.deepEqual([...orden].sort(), orden, 'respeta el orden');
    assert.ok(trabajo.some((a) => a.fecha_fin > a.fecha_inicio), 'agrupa días consecutivos en un rango');
});

test('proyecto con poco tiempo: avisa y coloca lo que no cabe en lo menos malo', () => {
    const tareas = [{ titulo: 'Todo', tipo: 'estudio', exigencia: 3, horas: 8, orden: 1 }, { titulo: 'Entrega', tipo: 'estudio', exigencia: 3, horas: 1, orden: 2, hito: true }];
    const r = planificarProyecto({ actividades: [], tareas, nombre: 'Urgente', fechaLimite: '2026-10-09', horasDia: 2, hoy: HOY });
    assert.ok(r.avisos.length > 0);
    const trabajo = r.crear.filter((c) => !c.datos.fija);
    assert.equal(trabajo.reduce((s, c) => s + c.datos.horas * rangoFechas(c.datos.fecha_inicio, c.datos.fecha_fin).length, 0), 8);
});

test('proyecto en franja horaria: respeta la hora y evita solapes', () => {
    const tareas = [{ titulo: 'Leer', tipo: 'estudio', exigencia: 1, horas: 4, orden: 1 }];
    const base = [A('Clase 18h', '2026-10-08', '2026-10-08', 1, 1, { hora_inicio: '18:00', hora_fin: '19:00' })];
    const r = planificarProyecto({ actividades: base, tareas, nombre: 'P', fechaLimite: '2026-10-20', horasDia: 2, hoy: HOY, horario: { hora_inicio: '18:00', hora_fin: '20:00' } });
    assert.ok(r.crear.every((c) => c.datos.hora_inicio === '18:00'));
    assert.ok(!r.crear.some((c) => c.datos.fecha_inicio <= '2026-10-08' && c.datos.fecha_fin >= '2026-10-08'), 'el 8 se cruza con la clase');
});

test('mejorDia y desplazar conservan duración; cargas antes/después', () => {
    const acts = [A('Uno', '2026-10-08', '2026-10-10', 2, 1)];
    const { movimiento } = mejorDia({ actividades: acts, id: acts[0].id, hoy: HOY });
    assert.equal(rangoFechas(movimiento.cambios.fecha_inicio, movimiento.cambios.fecha_fin).length, 3);
    const d = desplazar({ actividades: acts, ids: [acts[0].id], delta: 7 })[0];
    assert.deepEqual([d.cambios.fecha_inicio, d.cambios.fecha_fin], ['2026-10-15', '2026-10-17']);
    const cargas = cargasAntesDespues(acts, simularOperaciones(acts, [{ op: 'eliminar', id: acts[0].id }]), ['2026-10-08']);
    assert.deepEqual([cargas[0].antes, cargas[0].despues], [20, 0]);
});
