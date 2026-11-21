// Módulo Estudio (v3.12), funciones puras: detección de necesidades de aprendizaje, clave de tema, resumen de un
// objetivo y planificador determinista de sesiones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { necesidadAprendizaje, pideExplicacion, pidePlanEstudio, pideTemasProyecto } from '../../backend/servicios/asistente/interprete-lenguaje.js';
import { claveTema, resumenObjetivo } from '../../compartido/estudio.js';
import { planificarEstudio, revisarSesionesConfirmadas, ventanaObjetivo } from '../../backend/servicios/estudio/planificador-estudio.js';
import { sumarDias } from '../../compartido/fechas.js';

const HOY = '2026-11-16';

test('necesidad explícita: los ejemplos del requisito y su tipo (dificultad / deseo)', () => {
    const casos = {
        'No entiendo cómo funcionan las API REST': ['API REST', 'dificultad', true],
        'Necesito aprender React': ['React', 'deseo', false],
        'Tengo dificultades con las bases de datos': ['Bases de datos', 'dificultad', false],
        'No sé cómo resolver ejercicios de programación orientada a objetos': ['Programación orientada a objetos', 'dificultad', true],
        'me cuesta mucho entender la recursividad, ¿me ayudas?': ['Recursividad', 'dificultad', false],
        'Sigo sin entender los punteros': ['Punteros', 'dificultad', true],
        'estoy perdido en cálculo integral': ['Cálculo integral', 'dificultad', false],
        'tengo que repasar el tema de derivadas': ['Derivadas', 'deseo', false]
    };
    for (const [frase, [tema, tipo, explicacion]] of Object.entries(casos)) {
        const n = necesidadAprendizaje(frase, HOY);
        assert.ok(n, frase);
        assert.deepEqual([n.tema, n.tipo, n.explicacion], [tema, tipo, explicacion], frase);
    }
    assert.equal(necesidadAprendizaje('Quiero aprender JavaScript antes del 30 de noviembre', HOY).fechaLimite, '2026-11-30');
});

test('NO es una necesidad: preguntas informativas, dudas sobre si hace falta, agenda, temas vacíos o la propia app', () => {
    for (const frase of ['¿Qué es una API REST?', '¿Necesito aprender React?', 'mañana necesito estudiar cálculo 2 horas', 'Necesito repasar mañana a las 3',
        'no entiendo esto', 'no sé qué hacer', 'no entiendo tu respuesta', 'no entiendo por qué no se guardó mi actividad', 'No entiendo cómo funciona LearnTrack']) {
        assert.equal(necesidadAprendizaje(frase, HOY), null, frase);
    }
});

test('peticiones de explicación, plan de estudio y temas de un proyecto', () => {
    assert.ok(pideExplicacion('¿Qué es una API REST?'));
    assert.ok(pideExplicacion('explícame los closures'));
    assert.ok(pideExplicacion('dame ejercicios de arreglos'));
    assert.ok(!pideExplicacion('¿qué tengo mañana?'));
    assert.ok(pidePlanEstudio('planifica mis sesiones de estudio'));
    assert.ok(!pidePlanEstudio('agenda estudio de cálculo mañana a las 5'));
    assert.ok(pideTemasProyecto('¿Qué necesito aprender para este proyecto?'));
});

test('claveTema: mismo tema escrito de otra forma; resumen: progreso, horas y situación', () => {
    assert.equal(claveTema('APIs REST'), claveTema('api rest'));
    assert.equal(claveTema('Programación'), claveTema('programacion'));
    const o = { id: 'o1', tema: 'SQL', estado: 'en_curso', horasEstimadas: 4, fechaLimite: sumarDias(HOY, 5) };
    const sesiones = [
        { objetivoId: 'o1', estado: 'completado', horas: 1, fecha_inicio: sumarDias(HOY, -1) },
        { objetivoId: 'o1', estado: 'pendiente', horas: 2, fecha_inicio: sumarDias(HOY, 1), hora_inicio: '10:00' },
        { objetivoId: 'otro', estado: 'completado', horas: 3, fecha_inicio: HOY }
    ];
    const r = resumenObjetivo(o, sesiones, HOY);
    assert.deepEqual([r.progreso, r.horasCompletadas, r.horasProgramadas, r.horasPendientes, r.situacion, r.diasRestantes], [25, 1, 2, 1, 'proximo', 5]);
    assert.equal(resumenObjetivo({ ...o, estado: 'completado' }, sesiones, HOY).progreso, 100);
    assert.equal(resumenObjetivo({ ...o, fechaLimite: sumarDias(HOY, -1) }, sesiones, HOY).situacion, 'atrasado');
});

test('planificador: ventana antes de la fecha límite, prioridad a lo que vence antes, sin cruces ni días > 85 %', () => {
    assert.deepEqual(ventanaObjetivo({ tema: 'a', fechaLimite: sumarDias(HOY, 4) }, HOY), { desde: HOY, hasta: sumarDias(HOY, 3), aviso: null });
    assert.match(ventanaObjetivo({ tema: 'a', fechaLimite: sumarDias(HOY, -2) }, HOY).aviso, /ya pasó/);
    const ocupado = { id: 'x', titulo: 'Turno', exigencia: 1, horas: 4, fecha_inicio: sumarDias(HOY, 1), fecha_fin: sumarDias(HOY, 1), hora_inicio: '10:00', hora_fin: '14:00', estado: 'pendiente' };
    const objetivos = [
        { id: 'tarde', tema: 'Tarde', estado: 'pendiente', horasEstimadas: 2, fechaLimite: sumarDias(HOY, 10), prioridad: 3 },
        { id: 'pronto', tema: 'Pronto', estado: 'pendiente', horasEstimadas: 2, fechaLimite: sumarDias(HOY, 3), prioridad: 1 }
    ];
    const r = planificarEstudio({ actividades: [ocupado], objetivos, hoy: HOY, horaActual: '23:30', horasPorSesion: 1 });
    assert.equal(r.sesiones.length, 4);
    assert.ok(r.sesiones.filter((s) => s.objetivoId === 'pronto').every((s) => s.fecha < sumarDias(HOY, 3)));
    assert.ok(r.sesiones.every((s) => s.fecha !== HOY), 'hoy ya no queda tiempo (23:30)');
    for (const s of r.sesiones.filter((x) => x.fecha === ocupado.fecha_inicio)) assert.ok(s.hora_inicio >= '14:00' || s.hora_fin <= '10:00', 'no se cruza con el turno');
    assert.match(r.explicaciones.join(' '), /«Pronto»: 2 sesiones/);
    // Sin huecos: lo dice en vez de forzar
    const lleno = Array.from({ length: 3 }, (_, i) => ({ id: `l${i}`, titulo: 'Lleno', exigencia: 3, horas: 9, fecha_inicio: sumarDias(HOY, i), fecha_fin: sumarDias(HOY, i), estado: 'pendiente' }));
    const r2 = planificarEstudio({ actividades: lleno, objetivos: [objetivos[1]], hoy: HOY, horaActual: '07:00' });
    assert.equal(r2.sesiones.length, 0);
    assert.match(r2.avisos.join(' '), /No encontré hueco para 2 h/);
    // Confirmación: un cruce se rechaza
    const rev = revisarSesionesConfirmadas({ actividades: [ocupado], objetivosPorId: new Map([['pronto', objetivos[1]]]), hoy: HOY, horaActual: '07:00',
        sesiones: [{ objetivoId: 'pronto', fecha: ocupado.fecha_inicio, hora_inicio: '11:00', horas: 1 }] });
    assert.match(rev.conflictos[0].motivo, /se cruza con «Turno»/);
});
