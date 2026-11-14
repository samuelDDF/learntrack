// Regla ÚNICA de carga (compartido/carga.js) y regresión del defecto 2-d (panel y agenda calculaban distinto).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cargaDelDia, actividadesDelDia, puntosActividad, capacidadDe, nivelCarga, cargasPorDia, esHito, normalizarActividad, porcentajeCarga } from '../../compartido/carga.js';

const act = (extra) => ({ id: String(Math.random()), titulo: 'X', tipo: 'estudio', exigencia: 2, horas: 1, fecha_inicio: '2026-10-07', fecha_fin: '2026-10-07', estado: 'pendiente', ...extra });

test('puntos = exigencia × horas × 10; ocio/deporte restan', () => {
    assert.equal(puntosActividad(act({ exigencia: 3, horas: 2 })), 60);
    assert.equal(puntosActividad(act({ exigencia: -2, horas: 1.5 })), -30);
    assert.equal(puntosActividad(act({ exigencia: 'x' })), 0);
});

test('capacidad por check-in: alto 120, medio 100, bajo 70; sin check-in 100', () => {
    assert.equal(capacidadDe({ animo: 'alto' }), 120);
    assert.equal(capacidadDe('bajo'), 70);
    assert.equal(capacidadDe(null), 100);
    assert.equal(porcentajeCarga(-50, 100), 0, 'nunca negativa');
});

test('semáforo: <50 verde, 50-85 amarillo, >85 rojo', () => {
    assert.equal(nivelCarga(49), 'verde');
    assert.equal(nivelCarga(50), 'amarillo');
    assert.equal(nivelCarga(85), 'amarillo');
    assert.equal(nivelCarga(86), 'rojo');
});

test('una actividad de rango aporta sus horas a CADA día del rango (horas = horas por día)', () => {
    const lista = [act({ fecha_inicio: '2026-10-05', fecha_fin: '2026-10-09', horas: 2, exigencia: 2 })];
    for (const d of ['2026-10-05', '2026-10-07', '2026-10-09']) assert.equal(cargaDelDia(lista, d).porcentaje, 40, d);
    assert.equal(cargaDelDia(lista, '2026-10-10').porcentaje, 0);
    assert.equal(cargaDelDia(lista, '2026-10-04').porcentaje, 0);
});

test('rangos que cruzan de mes', () => {
    const lista = [act({ fecha_inicio: '2026-10-30', fecha_fin: '2026-11-02', horas: 1, exigencia: 3 })];
    assert.deepEqual(cargasPorDia(lista, ['2026-10-29', '2026-10-31', '2026-11-01', '2026-11-03']).map((c) => c.porcentaje), [0, 30, 30, 0]);
});

test('las completadas siguen contando (la energía ya se gastó); las eliminadas no', () => {
    const lista = [act({ estado: 'completado', horas: 2 }), act({ horas: 1, eliminadaEn: new Date() })];
    assert.equal(cargaDelDia(lista, '2026-10-07').porcentaje, 40);
    assert.equal(actividadesDelDia(lista, '2026-10-07').length, 1);
});

test('las actividades antiguas (solo `fecha`) cuentan igual', () => {
    const antigua = { id: 'a', titulo: 'Vieja', tipo: 'estudio', exigencia: 2, horas: 1, fecha: '2026-10-07' };
    assert.equal(cargaDelDia([antigua], '2026-10-07').porcentaje, 20);
    const n = normalizarActividad(antigua);
    assert.equal(n.fecha_inicio, '2026-10-07'); assert.equal(n.fecha_fin, '2026-10-07'); assert.equal(n.estado, 'pendiente'); assert.equal(n.proyecto, '');
});

test('capacidades por día (check-in de ese día o 100)', () => {
    const lista = [act({ fecha_inicio: '2026-10-07', fecha_fin: '2026-10-08', horas: 3.5, exigencia: 2 })];
    const r = cargasPorDia(lista, ['2026-10-07', '2026-10-08'], { '2026-10-07': { animo: 'bajo' } });
    assert.deepEqual(r.map((c) => [c.porcentaje, c.nivel]), [[100, 'rojo'], [70, 'amarillo']]);
});

test('esHito: misma regla que la vista Eventos + campo `fija`', () => {
    assert.ok(esHito({ titulo: 'Parcial de redes', exigencia: 2 }));
    assert.ok(esHito({ titulo: 'Entrega del taller', exigencia: 1 }));
    assert.ok(esHito({ titulo: 'Lectura', exigencia: 3 }));
    assert.ok(esHito({ titulo: 'Lectura', exigencia: 1, fija: true }));
    assert.ok(!esHito({ titulo: 'Lectura', exigencia: 2 }));
});

test('regresión 2-d: panel, agenda y servidor usan el MISMO módulo (sin reglas propias)', () => {
    const leer = (ruta) => fs.readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
    const panel = leer('frontend-react/src/privado/paginas/panel/Panel.jsx');
    const agenda = leer('frontend-react/src/privado/paginas/agenda/Agenda.jsx');
    const historial = leer('backend/rutas/bienestar.rutas.js');
    const planificador = leer('backend/servicios/asistente/planificador.js');
    for (const [nombre, src] of [['Panel.jsx', panel], ['Agenda.jsx', agenda]]) {
        assert.match(src, /from ['"]@compartido\/carga\.js['"]/, `${nombre} importa la regla compartida`);
        assert.match(src, /cargaDelDia\(/, `${nombre} usa cargaDelDia`);
        // Se ignoran las líneas de festivos: «f.fecha === fechaHoy» filtra feriados del día, no calcula carga
        const sinFestivos = src.split('\n').filter((l) => !/festivo/i.test(l)).join('\n');
        assert.doesNotMatch(sinFestivos, /act\.fecha === |\.fecha === fechaHoy|exigencia\) \* parseFloat/, `${nombre} no calcula por su cuenta`);
    }
    assert.match(historial, /from '(\.\.\/)+compartido\/carga\.js'/, 'el historial del servidor usa la regla compartida');
    assert.match(planificador, /from '(\.\.\/)+compartido\/carga\.js'/, 'el planificador usa la regla compartida');
    // Mismo resultado con los datos que pintaría cada pantalla: el panel pide la carga de hoy y la agenda la de la celda de hoy
    const datos = [act({ fecha_inicio: '2026-10-06', fecha_fin: '2026-10-08', horas: 1, exigencia: 1, estado: 'completado' }), act({ horas: 2, exigencia: 2 })];
    const cap = capacidadDe({ animo: 'bajo' });
    const panelPct = cargaDelDia(datos, '2026-10-07', cap).porcentaje;
    const agendaPct = cargasPorDia(datos, ['2026-10-06', '2026-10-07', '2026-10-08'], { '2026-10-07': 'bajo' })[1].porcentaje;
    assert.equal(panelPct, agendaPct);
    assert.equal(panelPct, 71);
});
