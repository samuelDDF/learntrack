// Archivos: firma (magic bytes) vs extensión, extracción en memoria, .ics determinista, fragmentos y citas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectarTipo, extraerTexto, fragmentar, citaVerificada, capacidadesArchivos, LIMITE_BYTES, MAX_CARACTERES } from '../../backend/servicios/archivos/lector-documentos.js';
import { parsearICS } from '../../backend/servicios/archivos/lector-ics.js';

const fixture = (n) => fs.readFileSync(new URL(`../archivos-de-prueba/${n}`, import.meta.url));

test('firma vs extensión', () => {
    assert.equal(detectarTipo('a.pdf', fixture('cronograma.pdf')).tipo, 'pdf');
    assert.equal(detectarTipo('a.docx', fixture('plan.docx')).tipo, 'docx');
    assert.equal(detectarTipo('a.ics', fixture('horario.ics')).tipo, 'ics');
    assert.equal(detectarTipo('a.txt', fixture('inyeccion.txt')).tipo, 'texto');
    assert.throws(() => detectarTipo('falso.pdf', fixture('falso.pdf')), /firma no coincide/);
    assert.throws(() => detectarTipo('cronograma.txt', fixture('cronograma.pdf')), /no es texto plano/);
    assert.throws(() => detectarTipo('plan.pdf', fixture('plan.docx')), /no es un PDF/);
    assert.throws(() => detectarTipo('virus.exe', Buffer.from('MZ')), /Formato no admitido/);
    assert.throws(() => detectarTipo('a.txt', Buffer.from([0xff, 0xfe, 0x00, 0x41])), /no es texto plano|UTF-8/);
    assert.throws(() => detectarTipo('foto.png', fixture('imagen.png')), /modelo de visión/);
    assert.equal(detectarTipo('foto.png', fixture('imagen.png'), { vision: true }).mime, 'image/png');
    assert.throws(() => detectarTipo('foto.png', Buffer.from('no soy png'), { vision: true }), /no coincide/);
    assert.throws(() => detectarTipo('a.ics', Buffer.from('hola')), /BEGIN:VCALENDAR/);
    assert.throws(() => detectarTipo('a.txt', Buffer.alloc(LIMITE_BYTES + 1, 65)), /5 MB/);
});

test('extracción en memoria de PDF y DOCX', async () => {
    const caps = await capacidadesArchivos();
    if (caps.pdf) {
        const pdf = await extraerTexto({ tipo: 'pdf' }, fixture('cronograma.pdf'));
        assert.match(pdf.texto, /Parcial 1 el 15 de octubre/);
        assert.equal(pdf.paginas, 1);
    } else console.log('# PDF no disponible en esta versión de Node: prueba omitida');
    const docx = await extraerTexto({ tipo: 'docx' }, fixture('plan.docx'));
    assert.match(docx.texto, /Quiz de bases de datos el 22 de octubre/);
    const largo = await extraerTexto({ tipo: 'texto' }, Buffer.from('a'.repeat(MAX_CARACTERES + 50)));
    assert.equal(largo.truncado, true); assert.equal(largo.texto.length, MAX_CARACTERES);
});

test('.ics determinista: UTC → hora de Bogotá, TZID, todo el día (fin exclusivo), RRULE avisada, cancelados fuera', () => {
    const r = parsearICS(fixture('horario.ics').toString('utf8'), { tzOffset: 300 });
    const porTitulo = Object.fromEntries(r.eventos.map((e) => [e.titulo, e]));
    assert.deepEqual([porTitulo['Parcial de cálculo'].fecha_inicio, porTitulo['Parcial de cálculo'].hora_inicio, porTitulo['Parcial de cálculo'].hora_fin, porTitulo['Parcial de cálculo'].horas], ['2026-10-16', '08:00', '10:00', 2]);
    assert.equal(porTitulo['Parcial de cálculo'].categoria, 'examen');
    assert.deepEqual([porTitulo['Entrega, informe final'].fecha_inicio, porTitulo['Entrega, informe final'].fecha_fin, porTitulo['Entrega, informe final'].categoria], ['2026-10-21', '2026-10-21', 'entrega']);
    const clase = r.eventos.find((e) => e.titulo.startsWith('Clase de inglés'));
    assert.match(clase.titulo, /continúa en otra línea/, 'línea plegada');
    assert.deepEqual([clase.hora_inicio, clase.hora_fin, clase.horas], ['18:30', '20:00', 1.5]);
    assert.ok(!r.eventos.some((e) => e.titulo === 'Fiesta cancelada'));
    assert.ok(r.avisos.some((a) => a.includes('se repiten')));
    // Evento UTC a las 03:00 Z = 22:00 del día ANTERIOR en Bogotá
    const noche = parsearICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Entrega nocturna\nDTSTART:20261101T030000Z\nDTEND:20261101T040000Z\nEND:VEVENT\nEND:VCALENDAR', { tzOffset: 300 });
    assert.deepEqual([noche.eventos[0].fecha_inicio, noche.eventos[0].hora_inicio], ['2026-10-31', '22:00']);
    // Cruza medianoche: se queda en el día de inicio, sin hora de fin
    const cruza = parsearICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Turno\nDTSTART:20261010T230000\nDTEND:20261011T010000\nEND:VEVENT\nEND:VCALENDAR');
    assert.deepEqual([cruza.eventos[0].fecha_inicio, cruza.eventos[0].hora_inicio, cruza.eventos[0].hora_fin, cruza.eventos[0].horas], ['2026-10-10', '23:00', null, 2]);
});

test('fragmentos y verificación de citas', () => {
    const texto = Array.from({ length: 3000 }, (_, i) => `línea ${i} con algo de texto`).join('\n');
    const f = fragmentar(texto);
    assert.ok(f.length >= 2 && f.length <= 4 && f.every((x) => x.length <= 6100));
    assert.ok(citaVerificada('Parcial 1: 15 de octubre', 'El PARCIAL 1 — 15 de octubre, aula 3'));
    assert.ok(!citaVerificada('Examen final el 1 de diciembre', 'Parcial 1: 15 de octubre'));
});
