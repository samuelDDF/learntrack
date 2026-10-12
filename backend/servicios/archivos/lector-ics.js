// Parser DETERMINISTA de iCalendar (.ics, RFC 5545) — sin LLM.
// Soporta VEVENT con SUMMARY, DTSTART/DTEND (fecha, hora flotante, UTC "Z" y TZID), DURATION y líneas plegadas.
// Las reglas de repetición (RRULE) no se expanden: se importa la primera ocurrencia y se avisa.
import { crearISO, sumarDias, deMinutos, fechaLocal } from '../../../compartido/fechas.js';

const MAX_EVENTOS = 500;

function desplegar(texto) {
    return String(texto).replace(/^﻿/, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function desescapar(v) {
    return v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function leerLinea(linea) {
    const dosPuntos = linea.indexOf(':');
    if (dosPuntos < 0) return null;
    const cabeza = linea.slice(0, dosPuntos);
    const valor = linea.slice(dosPuntos + 1);
    const [nombre, ...params] = cabeza.split(';');
    const parametros = Object.fromEntries(params.map((p) => { const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1).replace(/^"|"$/g, '')]; }));
    return { nombre: nombre.toUpperCase(), parametros, valor };
}

// Desfase (minutos al este de UTC) de una zona IANA en un instante, con Intl. null si la zona no existe.
function desfaseZona(zona, instanteMs) {
    try {
        const partes = new Intl.DateTimeFormat('en-US', {
            timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(new Date(instanteMs));
        const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
        const comoUTC = Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour), Number(v.minute), Number(v.second));
        return Math.round((comoUTC - instanteMs) / 60000);
    } catch { return null; }
}

/**
 * Convierte un valor DATE / DATE-TIME a la fecha y hora LOCAL del usuario.
 * tzOffsetMin: Date#getTimezoneOffset() del navegador (Bogotá = 300).
 */
function aLocal(valor, parametros, tzOffsetMin) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(valor.trim());
    if (!m) return null;
    const [, a, mes, d, hh, mm, , z] = m;
    if (!hh || parametros.VALUE === 'DATE') {
        const iso = crearISO(Number(a), Number(mes), Number(d));
        return iso ? { fecha: iso, minutos: null } : null;
    }
    const muro = Date.UTC(Number(a), Number(mes) - 1, Number(d), Number(hh), Number(mm));
    let instante = null;
    if (z) instante = muro;
    else if (parametros.TZID) {
        const desfase = desfaseZona(parametros.TZID, muro);
        if (desfase !== null) instante = muro - desfaseZona(parametros.TZID, muro - desfase * 60000) * 60000;
    }
    if (instante === null) {        // hora flotante (o zona desconocida): se toma tal cual
        const iso = crearISO(Number(a), Number(mes), Number(d));
        return iso ? { fecha: iso, minutos: Number(hh) * 60 + Number(mm) } : null;
    }
    const local = new Date(instante - tzOffsetMin * 60000);
    return { fecha: fechaLocal(instante, tzOffsetMin), minutos: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

function duracionMin(valor) {
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(valor.trim());
    if (!m) return null;
    const [, w, d, h, mi] = m.map((x) => Number(x) || 0);
    return ((w * 7 + d) * 24 + h) * 60 + mi;
}

export const categoriaDe = (titulo) => {
    const t = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/entrega|deadline|fecha limite|vence/.test(t)) return 'entrega';
    if (/parcial|examen|quiz|prueba|evaluacion|final|sustentacion/.test(t)) return 'examen';
    if (/clase|catedra|laboratorio|seminario|taller/.test(t)) return 'clase';
    return 'evento';
};

/**
 * Devuelve { eventos: [{ titulo, categoria, fecha_inicio, fecha_fin, hora_inicio, hora_fin, horas, cita }], avisos }
 */
export function parsearICS(texto, { tzOffset = 0 } = {}) {
    const lineas = desplegar(texto);
    if (!lineas.some((l) => /^BEGIN:VCALENDAR/i.test(l.trim()))) return { eventos: [], avisos: ['El archivo no es un calendario iCalendar válido.'] };
    const eventos = [];
    const avisos = [];
    let actual = null;
    let recurrentes = 0;
    for (const bruta of lineas) {
        const linea = bruta.trimEnd();
        if (/^BEGIN:VEVENT$/i.test(linea)) { actual = {}; continue; }
        if (/^END:VEVENT$/i.test(linea)) {
            if (actual && eventos.length < MAX_EVENTOS) eventos.push(actual);
            actual = null; continue;
        }
        if (!actual) continue;
        const l = leerLinea(linea);
        if (!l) continue;
        if (l.nombre === 'SUMMARY') actual.titulo = desescapar(l.valor).slice(0, 100);
        else if (l.nombre === 'DTSTART') actual.inicio = aLocal(l.valor, l.parametros, tzOffset);
        else if (l.nombre === 'DTEND') actual.fin = aLocal(l.valor, l.parametros, tzOffset);
        else if (l.nombre === 'DURATION') actual.duracion = duracionMin(l.valor);
        else if (l.nombre === 'RRULE') { actual.rrule = true; recurrentes++; }
        else if (l.nombre === 'STATUS' && /CANCELLED/i.test(l.valor)) actual.cancelado = true;
    }
    if (recurrentes) avisos.push(`${recurrentes} evento(s) se repiten; solo importo su primera fecha.`);
    const salida = [];
    for (const e of eventos) {
        if (!e.titulo || !e.inicio || e.cancelado) continue;
        const todoElDia = e.inicio.minutos === null;
        let fechaFin = e.inicio.fecha;
        let horaIni = null, horaFin = null, horas = 1;
        if (todoElDia) {
            if (e.fin?.fecha && e.fin.fecha > e.inicio.fecha) fechaFin = sumarDias(e.fin.fecha, -1);   // DTEND de fecha es exclusivo
        } else {
            horaIni = deMinutos(e.inicio.minutos);
            let dur = e.duracion ?? null;
            if (dur === null && e.fin) {
                const dias = Math.round((Date.parse(e.fin.fecha) - Date.parse(e.inicio.fecha)) / 86400000);
                dur = dias * 1440 + (e.fin.minutos ?? 0) - e.inicio.minutos;
            }
            if (dur !== null && dur > 0) {
                horas = Math.min(12, Math.max(0.5, Math.round((dur / 60) * 2) / 2));
                const finMin = e.inicio.minutos + dur;
                if (finMin < 1440) horaFin = deMinutos(finMin);     // si cruza medianoche se deja sin hora de fin
            }
        }
        salida.push({
            titulo: e.titulo, categoria: categoriaDe(e.titulo),
            fecha_inicio: e.inicio.fecha, fecha_fin: fechaFin < e.inicio.fecha ? e.inicio.fecha : fechaFin,
            hora_inicio: horaIni, hora_fin: horaFin, horas, todoElDia, cita: `SUMMARY:${e.titulo}`.slice(0, 120)
        });
    }
    if (eventos.length >= MAX_EVENTOS) avisos.push(`El calendario tiene más de ${MAX_EVENTOS} eventos; leí solo los primeros.`);
    return { eventos: salida, avisos };
}
