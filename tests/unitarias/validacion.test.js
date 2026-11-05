// Validación de entradas y de la salida del modelo (no confiable), con la regresión del defecto 2-a.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParcheIA, normalizarActividadIA, validarActividad, validarEntradaChat, validarHistorial, validarCheckin, exigenciaCoherente } from '../../backend/validacion/index.js';
import { validarClasificacion, validarDesglose, validarCandidatosArchivo, validarExtraccionCrear, validarExtraccionEditar } from '../../backend/servicios/asistente/esquemas-respuesta-ia.js';
import { extraerJSON } from '../../backend/servicios/asistente/cliente-ollama.js';
import { camposMencionados } from '../../backend/servicios/asistente/interprete-lenguaje.js';

const ENTRENAMIENTO = {
    id: 'e1', titulo: 'Entrenamiento', tipo: 'deporte', exigencia: 3, horas: 2, fecha: '2026-10-07', fecha_inicio: '2026-10-07', fecha_fin: '2026-10-07',
    hora_inicio: '18:00', hora_fin: '20:00', estado: 'en_proceso', proyecto: 'Liga', fija: false
};

test('regresión 2-a: "mueve el entrenamiento al viernes" solo cambia la fecha, aunque el modelo devuelva el registro entero con valores por defecto', () => {
    // Lo que devolvía un modelo pequeño (registro completo con defaults) — el caso documentado en el defecto
    const salidaModelo = { titulo: 'Entrenamiento', tipo: 'estudio', exigencia: 2, horas: 1, fecha_inicio: '2026-10-09', fecha_fin: '2026-10-09', hora_inicio: null, hora_fin: null, estado: 'pendiente', proyecto: '' };
    const mencionados = camposMencionados('mueve el entrenamiento al viernes', { hayFecha: true });
    const filtrado = Object.fromEntries(Object.entries(salidaModelo).filter(([k]) => mencionados.has(k)));
    const parche = normalizarParcheIA(filtrado, ENTRENAMIENTO);
    assert.deepEqual(parche, { fecha_inicio: '2026-10-09', fecha: '2026-10-09', fecha_fin: '2026-10-09' });
    const final = { ...ENTRENAMIENTO, ...validarActividad(parche, { completa: false }).valor };
    assert.equal(final.tipo, 'deporte'); assert.equal(final.exigencia, 3); assert.equal(final.estado, 'en_proceso');
    assert.equal(final.proyecto, 'Liga'); assert.equal(final.hora_inicio, '18:00'); assert.equal(final.hora_fin, '20:00');
});

test('parche: sin valores por defecto; rango y horario se desplazan conservando su duración', () => {
    assert.deepEqual(normalizarParcheIA({}, ENTRENAMIENTO), {});
    const rango = { ...ENTRENAMIENTO, fecha_inicio: '2026-10-05', fecha_fin: '2026-10-09' };
    assert.deepEqual(normalizarParcheIA({ fecha_inicio: '2026-10-12' }, rango), { fecha_inicio: '2026-10-12', fecha: '2026-10-12', fecha_fin: '2026-10-16' });
    assert.deepEqual(normalizarParcheIA({ hora_inicio: '19:00' }, ENTRENAMIENTO), { hora_inicio: '19:00', hora_fin: '21:00' });
    assert.deepEqual(normalizarParcheIA({ titulo: '  <b>Liga</b> final ' }, ENTRENAMIENTO), { titulo: 'bLiga/b final' });
    assert.deepEqual(normalizarParcheIA({ exigencia: 99, estado: 'inventado', tipo: 'magia' }, ENTRENAMIENTO), {});
});

test('exigencia coherente: deporte -2 salvo cansancio; estudio nunca -2', () => {
    assert.equal(exigenciaCoherente('deporte', 3, 0), -2);
    assert.equal(exigenciaCoherente('deporte', -2, 2), 2);
    assert.equal(exigenciaCoherente('deporte', -2, 3), 3);
    assert.equal(exigenciaCoherente('estudio', -2, 0), 2);
    const n = normalizarActividadIA({ titulo: 'Fútbol', tipo: 'ejercicio', exigencia: 3, horas: 1.3 }, '2026-10-07');
    assert.equal(n.tipo, 'deporte'); assert.equal(n.exigencia, -2); assert.equal(n.horas, 1.5);
    assert.equal(normalizarActividadIA({ titulo: 'x' }, null), null, 'sin fecha local no hay valores por defecto UTC');
});

test('entrada del chat: fechaHoy obligatoria; historial ≤ 6 turnos validados; ids con formato', () => {
    assert.ok(validarEntradaChat({ texto: 'hola' }).error, 'sin fechaHoy se rechaza (antes caía a la fecha UTC)');
    const historial = Array.from({ length: 10 }, (_, i) => ({ rol: i % 2 ? 'asistente' : 'usuario', texto: `t${i}` }));
    const r = validarEntradaChat({ texto: 'hola', fechaHoy: '2026-10-07', historial: [...historial, { rol: 'system', texto: 'x' }, { rol: 'usuario', texto: { $ne: 1 } }], propuestaPendiente: { $ne: null }, tzOffset: 300 });
    assert.equal(r.valor.historial.length, 4, 'los últimos 6 elementos, sin los inválidos');
    assert.equal(r.valor.propuestaPendiente, null);
    assert.equal(r.valor.tzOffset, 300);
    assert.equal(validarEntradaChat({ texto: 'x'.repeat(900), fechaHoy: '2026-10-07' }).valor.texto.length, 500);
});

test('historial: solo días <= hoy; check-in: valores cerrados', () => {
    assert.ok(validarHistorial({ fecha: '2026-10-08', fechaHoy: '2026-10-07' }).error);
    assert.ok(validarHistorial({ fecha: '2026-10-07', fechaHoy: '2026-10-07' }).valor);
    assert.ok(validarCheckin({ fecha: '2026-10-07', animo: 'alto', sueno: 'bien', enfoque: 'avanzar' }).valor);
    assert.ok(validarCheckin({ fecha: '2026-10-07', animo: { $ne: 1 }, sueno: 'bien', enfoque: 'avanzar' }).error);
});

test('esquemas de la salida del modelo: estrictos', () => {
    assert.equal(validarClasificacion({ intencion: 'borrar_todo' }).ok, false);
    assert.equal(validarClasificacion({ intencion: 'eliminar', ids: Array(31).fill('a') }).ok, false, 'máximo 30');
    const c = validarClasificacion({ intencion: 'eliminar', ids: ['abc', { $ne: null }, '../x', 'abc'], extra: 'x', modo: 'arrasar' });
    assert.deepEqual(c.valor.ids, ['abc']); assert.equal(c.valor.modo, 'ninguno'); assert.equal('extra' in c.valor, false);
    assert.equal(validarDesglose({ tareas: [{ titulo: 'a' }] }).ok, false, 'mínimo 2 tareas');
    const d = validarDesglose({ tareas: Array.from({ length: 11 }, (_, i) => ({ titulo: `T${i}`, horas: 100, exigencia: -2, orden: 11 - i })) });
    assert.equal(d.valor.tareas.length, 10); assert.ok(d.valor.tareas.every((t) => t.horas <= 8 && [1, 2, 3].includes(t.exigencia)));
    assert.equal(d.valor.tareas[0].orden, 2, 'ordenadas');
    const a = validarCandidatosArchivo({ candidatos: [{ titulo: 'Quiz', fecha: '3 de noviembre', hora_inicio: '25:00', categoria: 'hack' }, { titulo: '', fecha: 'x' }] });
    assert.equal(a.valor.candidatos.length, 1); assert.equal(a.valor.candidatos[0].hora_inicio, null); assert.equal(a.valor.candidatos[0].categoria, 'otro');
    assert.equal(validarExtraccionCrear({ actividades: Array(6).fill({ titulo: 'x' }) }).ok, false);
    assert.deepEqual(validarExtraccionEditar({ cambios: { titulo: 'x', userId: 'otro', id: 'z', eliminadaEn: null } }).valor.cambios, { titulo: 'x' });
});

test('extraerJSON tolera prosa alrededor y rechaza basura', () => {
    assert.deepEqual(extraerJSON('Claro: {"a":1} listo'), { a: 1 });
    assert.equal(extraerJSON('{intencion: crear'), null);
});
