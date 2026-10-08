// Importar archivos por la API: PDF y DOCX pasan por el modelo (simulado) con cita; .ics se lee SIN modelo.
// Siempre termina en una propuesta con casillas; las preparaciones sugeridas van desmarcadas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { iniciarEntorno, hoyLocal } from './helpers/entorno.js';
import { capacidadesArchivos } from '../src/archivos.js';

const HOY = hoyLocal(300);
let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

const subir = (c, nombre) => {
    const fd = new FormData();
    fd.append('fechaHoy', HOY); fd.append('tzOffset', '300');
    fd.append('archivo', new Blob([fs.readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url))]), nombre);
    return c.post('/api/ia/archivo', fd);
};

test('PDF → candidatos con cita verificada → propuesta seleccionable', async (t) => {
    if (!(await capacidadesArchivos()).pdf) return t.skip('pdfjs-dist no disponible en esta versión de Node');
    const c = await e.cliente();
    const r = await subir(c, 'cronograma.pdf');
    assert.equal(r.status, 200); assert.equal(r.data.tipo, 'propuesta'); assert.equal(r.data.propuesta.seleccionable, true);
    const titulos = r.data.propuesta.items.map((i) => i.titulo);
    assert.ok(titulos.includes('Parcial 1') && titulos.includes('Entrega del taller 2'));
    const parcial = r.data.propuesta.items.find((i) => i.titulo === 'Parcial 1');
    assert.equal(parcial.marcado, true); assert.match(parcial.motivo, /15 de octubre/);
    const prep = r.data.propuesta.items.filter((i) => i.titulo.startsWith('Preparar:'));
    assert.ok(prep.length > 0 && prep.every((i) => i.marcado === false), 'preparación sugerida, desmarcada');
    assert.equal((await c.get('/api/actividades')).data.length, 0, 'nunca se auto-aplica');
});

test('DOCX → propuesta; aplicar solo lo seleccionado', async () => {
    const c = await e.cliente();
    const r = await subir(c, 'plan.docx');
    assert.equal(r.data.tipo, 'propuesta');
    const quiz = r.data.propuesta.items.find((i) => i.titulo === 'Quiz de bases de datos');
    const ap = await c.post(`/api/propuestas/${r.data.propuesta.id}/aplicar`, { seleccion: [quiz.idx] });
    const lista = ap.data.actividades;
    assert.equal(lista.length, 1); assert.equal(lista[0].titulo, 'Quiz de bases de datos'); assert.equal(lista[0].fija, true);
    assert.equal((await c.post(`/api/propuestas/${r.data.propuesta.id}/aplicar`, { seleccion: [0] })).status, 410);
});

test('.ics se interpreta de forma determinista, sin llamar al modelo', async () => {
    const c = await e.cliente();
    const antes = e.ollama.peticionesDe('archivo').length;
    const r = await subir(c, 'horario.ics');
    assert.equal(r.data.tipo, 'propuesta');
    assert.equal(e.ollama.peticionesDe('archivo').length, antes, 'cero llamadas al LLM');
    const parcial = r.data.propuesta.items.find((i) => i.titulo === 'Parcial de cálculo');
    assert.match(parcial.detalle, /08:00–10:00/, '13:00 UTC = 8:00 en Bogotá');
    assert.ok(r.data.propuesta.avisos.some((a) => /repiten/.test(a)));
});
