import test from 'node:test';
import assert from 'node:assert/strict';
import { validarContextoChat, validarEntradaChat } from '../../backend/validacion/asistente.js';
import { validarCandidatosArchivo, validarClasificacion } from '../../backend/servicios/asistente/esquemas-respuesta-ia.js';
import { promptMaestro } from '../../backend/servicios/asistente/prompts.js';

test('el contexto de pantalla solo admite secciones conocidas y limita el nombre del proyecto', () => {
    assert.deepEqual(validarContextoChat({ seccion: 'proyectos', proyecto: 'Proyecto Demo' }), {
        seccion: 'proyectos', proyecto: 'Proyecto Demo', tema: ''
    });
    assert.deepEqual(validarContextoChat({ seccion: 'estudio', tema: 'JavaScript' }), { seccion: 'estudio', proyecto: '', tema: 'JavaScript' });
    assert.equal(validarContextoChat({ seccion: 'administracion', proyecto: 'otro' }), null);
    assert.equal(validarContextoChat('proyectos'), null);
});

test('el endpoint de chat conserva el contexto validado', () => {
    const r = validarEntradaChat({
        texto: 'Ayúdame con este tema',
        fechaHoy: '2026-11-16',
        contexto: { seccion: 'estudio' }
    });
    assert.equal(r.valor.contexto.seccion, 'estudio');
});

test('el lector de documentos valida temas de aprendizaje sin confiar en campos arbitrarios', () => {
    const r = validarCandidatosArchivo({
        candidatos: [],
        temasEstudio: [
            { tema: 'Funciones', motivo: 'Se necesitan para completar el taller', fechaLimite: '25 de noviembre', cita: 'implemente funciones' },
            { tema: '', motivo: 'descartar', fechaLimite: '', cita: 'texto' },
            { tema: 'Inyección', motivo: 'no tiene cita', fechaLimite: '', cita: '' }
        ]
    });
    assert.equal(r.ok, true);
    assert.equal(r.valor.temasEstudio.length, 1);
    assert.equal(r.valor.temasEstudio[0].tema, 'Funciones');
});

test('el prompt del asistente adapta su orientación al módulo Estudio', () => {
    const prompt = promptMaestro({
        nombreIA: 'Nexo',
        ahora: { diaSemana: 'lunes', fecha: '2026-11-16', hora: '12:00', zona: 'America/Bogota' },
        contexto: { seccion: 'estudio', proyecto: '' }
    });
    assert.match(prompt, /CONTEXTO DE PANTALLA.*Estudio/s);
    assert.match(prompt, /paciente y motivador/);
    assert.match(prompt, /No registres automáticamente cada pregunta/);
});

test('la clasificación admite una intención específica para planificar aprendizaje', () => {
    const r = validarClasificacion({
        intencion: 'planificar_estudio',
        ids: [],
        referencia: 'React',
        proyecto: '',
        fecha_objetivo: '30 de noviembre',
        fecha_destino: '',
        modo: 'ninguno'
    });
    assert.equal(r.ok, true);
    assert.equal(r.valor.intencion, 'planificar_estudio');
});
