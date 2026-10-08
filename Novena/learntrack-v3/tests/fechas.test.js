// Fechas, horas y duraciones en español (deterministas): cambio de mes, cruce de medianoche, Bogotá UTC-5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarFechas, resolverFecha, resolverRango, buscarHoras, buscarDuracion, modoLiberacion, nivelCansancio, indicaCompletado, esAfirmacion, pideDeshacer, camposMencionados } from '../src/interpretar.js';
import { sumarDias, diasEntre, inicioSemana, fechaLocal, inicioDiaLocal, tablaFechas, esISO, diaSemana } from '../compartido/fechas.js';

const HOY = '2026-10-07'; // miércoles
const f = (t, hoy = HOY, o) => resolverFecha(t, hoy, o)?.inicio ?? null;

test('hoy, mañana y pasado mañana; "por la mañana" no es una fecha', () => {
    assert.equal(f('hoy estudio'), HOY);
    assert.equal(f('mañana tengo parcial'), '2026-10-08');
    assert.equal(f('pasado mañana'), '2026-10-09');
    assert.equal(f('estudio por la mañana'), null);
    assert.equal(f('esta mañana fui al gimnasio'), null);
    assert.equal(f('en la mañana tengo clase'), null);
    assert.equal(f('mañana por la mañana estudio'), '2026-10-08');
});

test('días de la semana: "el lunes", "este miércoles", "el viernes de la otra semana", pasado', () => {
    assert.equal(f('el lunes'), '2026-10-12');
    assert.equal(f('el miércoles'), '2026-10-14', 'el mismo día de la semana significa la próxima');
    assert.equal(f('este miércoles'), HOY);
    assert.equal(f('el viernes de la otra semana'), '2026-10-16');
    assert.equal(f('el lunes pasado'), '2026-10-05');
    assert.equal(f('lo que borré el lunes', HOY, { preferirPasado: true }), '2026-10-05');
});

test('fechas explícitas, año siguiente y cambio de mes', () => {
    assert.equal(f('15 de octubre'), '2026-10-15');
    assert.equal(f('el 20/10'), '2026-10-20');
    assert.equal(f('el 3 de enero'), '2027-01-03', 'una fecha que ya pasó hace meses es del año siguiente');
    assert.equal(f('el 5', '2026-10-28'), '2026-11-05', '"el 5" a finales de mes es el del mes siguiente');
    assert.equal(f('mañana', '2026-10-31'), '2026-11-01', 'cambio de mes');
    assert.equal(f('mañana', '2026-12-31'), '2027-01-01', 'cambio de año');
    assert.equal(f('el lunes', '2026-02-27'), '2026-03-02', 'cambio de mes en febrero');
    assert.equal(f('31 de febrero'), null, 'fecha imposible');
});

test('rangos de varios días', () => {
    assert.deepEqual(resolverRango('del lunes al viernes trabajo', HOY), { inicio: '2026-10-12', fin: '2026-10-16', texto: 'del lunes al viernes', indice: 0 });
    const r = resolverRango('del 28 de octubre al 3 de noviembre', HOY);
    assert.equal(r.inicio, '2026-10-28'); assert.equal(r.fin, '2026-11-03');
    const s = resolverRango('la próxima semana', HOY);
    assert.equal(s.inicio, '2026-10-12'); assert.equal(s.fin, '2026-10-18');
    const fs = resolverRango('el fin de semana', HOY);
    assert.equal(fs.inicio, '2026-10-10'); assert.equal(fs.fin, '2026-10-11');
});

test('horas: "de 2 a 4 pm", sin am/pm, y cruce de medianoche', () => {
    assert.deepEqual(buscarHoras('de 2 a 4 pm'), { hora_inicio: '14:00', hora_fin: '16:00', duracion: 2, cruzaMedianoche: false });
    assert.equal(buscarHoras('de 6 a 8').hora_inicio, '18:00', 'sin am/pm, 1–6 se asume de la tarde');
    assert.equal(buscarHoras('de 10 a 12').hora_inicio, '10:00');
    assert.deepEqual(buscarHoras('de 10 pm a 1 am'), { hora_inicio: '22:00', hora_fin: '01:00', duracion: 3, cruzaMedianoche: true });
    assert.deepEqual(buscarHoras('de 11 pm a 2'), { hora_inicio: '23:00', hora_fin: '02:00', duracion: 3, cruzaMedianoche: true });
    assert.equal(buscarHoras('a las 3 y media').hora_inicio, '15:30');
    assert.equal(buscarHoras('a las 15:30').hora_inicio, '15:30');
    assert.equal(buscarHoras('3:30 de la tarde').hora_inicio, '15:30');
    assert.equal(buscarHoras('a mediodía').hora_inicio, '12:00');
    assert.equal(buscarHoras('de 9 a 11 de la noche').hora_fin, '23:00');
    assert.equal(buscarHoras('mañana estudio'), null, '"mañana" no es una hora');
});

test('duraciones: "1 hora y media", "media hora", "90 minutos", redondeo a 0.5', () => {
    assert.equal(buscarDuracion('1 hora y media').horas, 1.5);
    assert.equal(buscarDuracion('hora y media').horas, 1.5);
    assert.equal(buscarDuracion('media hora').horas, 0.5);
    assert.equal(buscarDuracion('90 minutos').horas, 1.5);
    assert.equal(buscarDuracion('2h30').horas, 2.5);
    assert.equal(buscarDuracion('dos horas diarias').porDia, true);
    assert.equal(buscarDuracion('3 horas y 10 minutos').horas, 3, '3.17 h se redondea a 3');
    assert.equal(buscarDuracion('a las 2'), null, 'una hora del día no es una duración');
});

test('Bogotá (UTC-5) a las 8 p. m.: el servidor razona en el día LOCAL, no en UTC', () => {
    const instante = Date.UTC(2026, 9, 8, 1, 0);           // 2026-10-08 01:00 UTC = 2026-10-07 20:00 en Bogotá
    assert.equal(new Date(instante).toISOString().slice(0, 10), '2026-10-08', 'en UTC ya es mañana');
    assert.equal(fechaLocal(instante, 300), '2026-10-07', 'en Bogotá sigue siendo hoy');
    assert.equal(inicioDiaLocal('2026-10-07', 300).toISOString(), '2026-10-07T05:00:00.000Z');
    assert.equal(f('mañana', fechaLocal(instante, 300)), '2026-10-08');
});

test('aritmética de calendario pura', () => {
    assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
    assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');
    assert.equal(diasEntre('2026-10-30', '2026-11-02'), 3);
    assert.equal(inicioSemana('2026-10-11'), '2026-10-05');
    assert.equal(diaSemana('2026-10-07'), 3);
    assert.ok(esISO('2026-10-07') && !esISO('2026-02-30'));
    const tabla = tablaFechas(HOY);
    assert.match(tabla, /miércoles 2026-10-07 \(hoy\); jueves 2026-10-08 \(mañana\)/);
    assert.equal(tabla.split(';').length, 15);
});

test('señales del texto: modo de liberación, cansancio, completado, confirmaciones', () => {
    assert.equal(modoLiberacion('elimina todo lo del jueves'), 'ambiguo');
    assert.equal(modoLiberacion('borra definitivamente lo del jueves'), 'eliminar');
    assert.equal(modoLiberacion('libera mi agenda del viernes'), 'aplazar');
    assert.equal(modoLiberacion('hoy no puedo'), 'aplazar');
    assert.equal(nivelCansancio('entreno de fútbol'), 0);
    assert.equal(nivelCansancio('entreno y terminaré cansado'), 2);
    assert.equal(nivelCansancio('entrenamiento durísimo, quedaré exhausto'), 3);
    assert.ok(indicaCompletado('ya terminé el taller'));
    assert.ok(!indicaCompletado('mañana termino el taller'));
    assert.ok(esAfirmacion('sí') && esAfirmacion('Dale') && !esAfirmacion('si mañana estudio'));
    assert.ok(pideDeshacer('deshaz lo último'));
    const c = camposMencionados('mueve el entrenamiento al viernes', { hayFecha: true });
    assert.ok(c.has('fecha_inicio') && !c.has('exigencia') && !c.has('estado') && !c.has('tipo') && !c.has('proyecto'));
});
