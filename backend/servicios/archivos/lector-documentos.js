// Carga de archivos EN MEMORIA (nunca se escriben en disco ni se registran en logs).
// Máx. 5 MB y 1 archivo; se valida la firma (magic bytes) además de la extensión; límite de páginas y caracteres.
// Las librerías de PDF y DOCX se cargan de forma diferida: si no están instaladas (o la versión de Node no las
// admite), ese formato se desactiva con un mensaje claro en lugar de fingir que funciona.
import { ErrorConEstado } from '../../errores.js';

export const LIMITE_BYTES = 5 * 1024 * 1024;
const MAX_PAGINAS = 30;
export const MAX_CARACTERES = 24000;
const TAM_FRAGMENTO = 6000;
const MAX_FRAGMENTOS = 4;

const EXT_DOCUMENTO = ['.txt', '.md', '.csv', '.ics', '.pdf', '.docx'];
const EXT_IMAGEN = ['.png', '.jpg', '.jpeg', '.webp'];

export class ErrorArchivo extends ErrorConEstado {}

const empieza = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
const FIRMAS_BINARIAS = [
    [0x25, 0x50, 0x44, 0x46], [0x50, 0x4b, 0x03, 0x04], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff],
    [0x47, 0x49, 0x46, 0x38], [0x7f, 0x45, 0x4c, 0x46], [0x4d, 0x5a], [0x1f, 0x8b], [0x52, 0x49, 0x46, 0x46]
];

let modPdf, modDocx;
// pdfjs-dist 5.4 exige Node >= 20.16: en versiones anteriores el PDF se desactiva con un mensaje claro
const [mayor, menor] = process.versions.node.split('.').map(Number);
const nodeAdmitePdf = mayor > 20 || (mayor === 20 && menor >= 16);

async function cargarPdf() {
    if (modPdf !== undefined) return modPdf;
    if (!nodeAdmitePdf) { modPdf = null; console.warn(`Soporte PDF desactivado: requiere Node 20.16 o superior (tienes ${process.versions.node}).`); return modPdf; }
    try { modPdf = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
    catch (e) { modPdf = null; console.warn('Soporte PDF desactivado:', e.message.split('\n')[0]); }
    return modPdf;
}
async function cargarDocx() {
    if (modDocx !== undefined) return modDocx;
    try { modDocx = (await import('mammoth')).default; }
    catch (e) { modDocx = null; console.warn('Soporte DOCX desactivado:', e.message.split('\n')[0]); }
    return modDocx;
}

/** Qué formatos están realmente disponibles en este servidor */
export async function capacidadesArchivos({ vision = false } = {}) {
    const [pdf, docx] = await Promise.all([cargarPdf(), cargarDocx()]);
    const formatos = ['.txt', '.md', '.csv', '.ics', ...(pdf ? ['.pdf'] : []), ...(docx ? ['.docx'] : []), ...(vision ? EXT_IMAGEN : [])];
    return { pdf: Boolean(pdf), docx: Boolean(docx), imagenes: Boolean(vision), formatos, maxBytes: LIMITE_BYTES };
}

function extension(nombre) {
    const n = String(nombre ?? '').toLowerCase();
    const i = n.lastIndexOf('.');
    return i >= 0 ? n.slice(i) : '';
}

/** Comprueba extensión + firma. Devuelve { tipo: 'texto'|'ics'|'pdf'|'docx'|'imagen', ext, mime? } o lanza ErrorArchivo */
export function detectarTipo(nombre, buf, { vision = false } = {}) {
    const ext = extension(nombre);
    if (!buf || buf.length === 0) throw new ErrorArchivo('El archivo está vacío.');
    if (buf.length > LIMITE_BYTES) throw new ErrorArchivo('El archivo supera el máximo de 5 MB.', 413);
    if (EXT_IMAGEN.includes(ext)) {
        if (!vision) throw new ErrorArchivo('Las imágenes no están disponibles: el servidor no tiene un modelo de visión configurado (OLLAMA_VISION_MODEL). Usa PDF, DOCX, TXT, MD, CSV o ICS.', 415);
        if (ext === '.png' && empieza(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { tipo: 'imagen', ext, mime: 'image/png' };
        if ((ext === '.jpg' || ext === '.jpeg') && empieza(buf, [0xff, 0xd8, 0xff])) return { tipo: 'imagen', ext, mime: 'image/jpeg' };
        if (ext === '.webp' && empieza(buf, [0x52, 0x49, 0x46, 0x46]) && buf.toString('latin1', 8, 12) === 'WEBP') return { tipo: 'imagen', ext, mime: 'image/webp' };
        throw new ErrorArchivo('El contenido de la imagen no coincide con su extensión.', 415);
    }
    if (!EXT_DOCUMENTO.includes(ext)) throw new ErrorArchivo('Formato no admitido. Usa .txt, .md, .csv, .ics, .pdf o .docx.', 415);
    if (ext === '.pdf') {
        if (!empieza(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new ErrorArchivo('El archivo no es un PDF válido (la firma no coincide con la extensión).', 415);
        return { tipo: 'pdf', ext };
    }
    if (ext === '.docx') {
        if (!empieza(buf, [0x50, 0x4b, 0x03, 0x04]) || !buf.includes('word/')) throw new ErrorArchivo('El archivo no es un DOCX válido (la firma no coincide con la extensión).', 415);
        return { tipo: 'docx', ext };
    }
    // Texto plano: sin firmas binarias, sin bytes nulos y UTF-8 válido
    if (FIRMAS_BINARIAS.some((f) => empieza(buf, f)) || buf.includes(0)) throw new ErrorArchivo('El archivo no es texto plano (la firma no coincide con la extensión).', 415);
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { throw new ErrorArchivo('El archivo de texto no está en UTF-8.', 415); }
    if (ext === '.ics') {
        if (!/^﻿?\s*BEGIN:VCALENDAR/i.test(buf.toString('utf8', 0, 200))) throw new ErrorArchivo('El archivo .ics no empieza por BEGIN:VCALENDAR.', 415);
        return { tipo: 'ics', ext };
    }
    return { tipo: 'texto', ext };
}

function recortar(texto) {
    const limpio = texto.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return limpio.length > MAX_CARACTERES ? { texto: limpio.slice(0, MAX_CARACTERES), truncado: true } : { texto: limpio, truncado: false };
}

/** Extrae el texto (en memoria). Devuelve { texto, truncado, paginas } */
export async function extraerTexto({ tipo }, buf) {
    if (tipo === 'texto' || tipo === 'ics') return { ...recortar(buf.toString('utf8')), paginas: null };
    if (tipo === 'docx') {
        const mammoth = await cargarDocx();
        if (!mammoth) throw new ErrorArchivo('El soporte de DOCX no está instalado en este servidor (falta la dependencia "mammoth").', 501);
        try {
            const { value } = await mammoth.extractRawText({ buffer: buf });
            return { ...recortar(value), paginas: null };
        } catch { throw new ErrorArchivo('No pude leer el DOCX (¿está dañado o protegido?).', 422); }
    }
    if (tipo === 'pdf') {
        const pdfjs = await cargarPdf();
        if (!pdfjs) throw new ErrorArchivo('El soporte de PDF no está disponible en este servidor (requiere "pdfjs-dist" y Node 20.16 o superior).', 501);
        let doc;
        try {
            doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
        } catch { throw new ErrorArchivo('No pude abrir el PDF (¿está dañado o cifrado?).', 422); }
        try {
            const paginas = Math.min(doc.numPages, MAX_PAGINAS);
            let texto = '';
            for (let i = 1; i <= paginas && texto.length < MAX_CARACTERES; i++) {
                const pagina = await doc.getPage(i);
                const contenido = await pagina.getTextContent();
                texto += contenido.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
                pagina.cleanup();
            }
            const r = recortar(texto);
            return { ...r, truncado: r.truncado || doc.numPages > MAX_PAGINAS, paginas: doc.numPages };
        } finally { await doc.destroy(); }
    }
    throw new ErrorArchivo('Formato no admitido.', 415);
}

/** Divide el texto en fragmentos (por líneas) para procesarlos por separado y fusionar los resultados */
export function fragmentar(texto) {
    const fragmentos = [];
    let actual = '';
    for (const linea of texto.split('\n')) {
        if ((actual + linea).length > TAM_FRAGMENTO && actual) { fragmentos.push(actual); actual = ''; }
        actual += (actual ? '\n' : '') + linea.slice(0, TAM_FRAGMENTO);
        if (fragmentos.length >= MAX_FRAGMENTOS) break;
    }
    if (actual && fragmentos.length < MAX_FRAGMENTOS) fragmentos.push(actual);
    return fragmentos;
}

/** ¿La cita aparece (normalizada) en el documento? Detecta citas inventadas por el modelo. */
export function citaVerificada(cita, texto) {
    const n = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
    const c = n(cita);
    if (c.length < 4) return false;
    return n(texto).includes(c);
}
