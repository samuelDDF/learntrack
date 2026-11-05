// Importar archivos por la API: PDF y DOCX pasan por el modelo (simulado) con cita; .ics se lee SIN modelo.
// v3.4: lo fiable (cita comprobada, .ics) se AÑADE SOLO al calendario en un lote con Deshacer; lo dudoso y las
// preparaciones sugeridas quedan en una propuesta con casillas (`siguiente`). El mensaje escrito junto al archivo
// llega al modelo y puede asignar un proyecto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { iniciarEntorno } from '../utilidades/entorno.js';
import { capacidadesArchivos } from '../../backend/servicios/archivos/lector-documentos.js';

// v3.6: fecha FIJA anterior a las fechas de los archivos de prueba (cronograma.pdf: 15 y 20 de octubre de 2026;
// horario.ics: 16–21 de octubre de 2026). Con la fecha real, desde el 23-oct-2026 esos eventos quedaban «en el pasado»
// y las pruebas fallaban según el día en que se ejecutaran.
const HOY = '2026-10-07';
let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const subir = (c, nombre, instruccion = '') => {
    const fd = new FormData();
    fd.append('fechaHoy', HOY); fd.append('tzOffset', '300');
    if (instruccion) fd.append('instruccion', instruccion);
    fd.append('archivo', new Blob([fs.readFileSync(new URL(`../archivos-de-prueba/${nombre}`, import.meta.url))]), nombre);
    return c.post('/api/ia/archivo', fd);
};

test('PDF + mensaje → lo comprobado se añade solo (con Deshacer); preparaciones opcionales en propuesta', async (t) => {
    if (!(await capacidadesArchivos()).pdf) return t.skip('pdfjs-dist no disponible en esta versión de Node');
    const c = await e.cliente();
    const r = await subir(c, 'cronograma.pdf', 'Son de la materia Redes, agrégalos');
    assert.equal(r.status, 200); assert.equal(r.data.tipo, 'aplicado');
    assert.match(r.data.mensaje, /Añadí \d+ elementos? de «cronograma\.pdf»/);
    const lista = (await c.get('/api/actividades')).data;
    const parcial = lista.find((a) => a.titulo === 'Parcial 1');
    assert.ok(parcial && lista.some((a) => a.titulo === 'Entrega del taller 2'), 'añadidos al calendario automáticamente');
    assert.equal(parcial.proyecto, 'Redes', 'el mensaje del usuario asigna la materia como proyecto');
    assert.equal(parcial.fecha_vencimiento, parcial.fecha_fin, 'un examen vence el día en que ocurre');
    assert.equal(parcial.fecha_asignacion, HOY);
    const peticion = e.ollama.peticionesDe('archivo').at(-1);
    assert.match(peticion.usuario, /Petición del usuario: Son de la materia Redes/, 'mensaje + contenido del archivo en la misma llamada');
    const prep = r.data.siguiente?.propuesta?.items ?? [];
    assert.ok(prep.length > 0 && prep.every((i) => i.titulo.startsWith('Preparar:') && i.marcado === false), 'preparación sugerida, desmarcada y aparte');
    const d = await c.post(`/api/operaciones/${r.data.loteId}/deshacer`);
    assert.equal(d.data.actividades.length, 0, 'un Deshacer quita todo lo importado');
});

test('DOCX con una cita que no está en el texto → ese elemento NO se añade solo: queda en propuesta para revisarlo', async () => {
    const c = await e.cliente();
    e.ollama.responder('archivo', { candidatos: [
        { titulo: 'Quiz de bases de datos', categoria: 'examen', fecha: '22 de octubre', hora_inicio: null, hora_fin: null, cita: 'Quiz de bases de datos el 22 de octubre' },
        { titulo: 'Inventado', categoria: 'entrega', fecha: '30 de octubre', hora_inicio: null, hora_fin: null, cita: 'Esto no aparece en el documento' }
    ] });
    const r = await subir(c, 'plan.docx');
    assert.equal(r.data.tipo, 'aplicado');
    const lista = (await c.get('/api/actividades')).data;
    assert.deepEqual(lista.map((a) => a.titulo), ['Quiz de bases de datos']);
    assert.equal(lista[0].fija, true);
    const dudoso = r.data.siguiente.propuesta.items.find((i) => i.titulo === 'Inventado');
    assert.equal(dudoso.marcado, false); assert.match(dudoso.aviso, /cita literal/);
    const ap = await c.post(`/api/propuestas/${r.data.siguiente.propuesta.id}/aplicar`, { seleccion: [dudoso.idx] });
    assert.equal(ap.data.actividades.length, 2, 'solo se añade si el usuario lo marca');
});

test('.ics se interpreta de forma determinista, sin llamar al modelo, y se añade solo', async () => {
    const c = await e.cliente();
    const antes = e.ollama.peticionesDe('archivo').length;
    const r = await subir(c, 'horario.ics');
    assert.equal(r.data.tipo, 'aplicado');
    assert.equal(e.ollama.peticionesDe('archivo').length, antes, 'cero llamadas al LLM');
    const parcial = r.data.actividades.find((a) => a.titulo === 'Parcial de cálculo');
    assert.deepEqual([parcial.hora_inicio, parcial.hora_fin], ['08:00', '10:00'], '13:00 UTC = 8:00 en Bogotá');
    assert.ok(r.data.avisos.some((a) => /repiten/.test(a)));
});
