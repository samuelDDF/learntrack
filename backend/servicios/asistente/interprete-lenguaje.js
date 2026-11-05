// Interpretación DETERMINISTA del español: fechas relativas, rangos de horas y duraciones.
// Llama 3.2 (3B) se equivoca con la aritmética de calendario, así que estas cosas se calculan aquí y
// el modelo solo clasifica y extrae texto. Todas las funciones son puras (reciben `hoy` como YYYY-MM-DD local).
import {
    sumarDias, diaSemana, inicioSemana, crearISO, esISO, diasEntre, ultimoDiaMes,
    deMinutos, redondearMedia
} from '../../../compartido/fechas.js';

const quitarTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** minúsculas, sin tildes (la ñ pasa a n), espacios simples */
export const normalizarTexto = (t) => quitarTildes(String(t ?? '').toLowerCase()).replace(/[¿¡]/g, ' ').replace(/\s+/g, ' ').trim();

const DIAS_N = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const MESES_N = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
    septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12
};
const NUMEROS = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
    once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30
};
const RX_DIA = '(lunes|martes|miercoles|jueves|viernes|sabado|domingo)';
const RX_MES = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
const RX_NUM = '(\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta)';

const aNumero = (t) => (t in NUMEROS ? NUMEROS[t] : Number(String(t).replace(',', '.')));

/** Próxima fecha con ese día de la semana. incluirHoy: si hoy es ese día, devuelve hoy. */
export function proximoDia(hoy, dow, incluirHoy = false) {
    let delta = (dow - diaSemana(hoy) + 7) % 7;
    if (delta === 0 && !incluirHoy) delta = 7;
    return sumarDias(hoy, delta);
}
/** Última fecha (pasada) con ese día de la semana. incluirHoy: si hoy es ese día, devuelve hoy. */
function ultimoDia(hoy, dow, incluirHoy = true) {
    let delta = (diaSemana(hoy) - dow + 7) % 7;
    if (delta === 0 && !incluirHoy) delta = 7;
    return sumarDias(hoy, -delta);
}

// Año para "15 de octubre" sin año: este año; si ya pasó hace más de 60 días, el siguiente
// (o el anterior si preferirPasado y la fecha queda en el futuro).
function conAnio(hoy, mes, dia, anioExplicito, preferirPasado) {
    const anioHoy = Number(hoy.slice(0, 4));
    if (anioExplicito) {
        const a = Number(anioExplicito) < 100 ? 2000 + Number(anioExplicito) : Number(anioExplicito);
        return crearISO(a, mes, dia);
    }
    let iso = crearISO(anioHoy, mes, dia);
    if (!iso) return null;
    if (preferirPasado) { if (iso > hoy) iso = crearISO(anioHoy - 1, mes, dia); }
    else if (diasEntre(iso, hoy) > 60) iso = crearISO(anioHoy + 1, mes, dia);
    return iso;
}

/**
 * Busca expresiones de fecha en el texto. Devuelve [{ inicio, fin, texto, indice }] ordenadas por posición.
 * "mañana" no se confunde con "por la mañana" / "en la mañana" / "esta mañana" (esas no son fechas).
 */
export function buscarFechas(texto, hoy, { preferirPasado = false } = {}) {
    const t = normalizarTexto(texto);
    const hallazgos = [];
    const ocupado = [];
    const libre = (i, f) => !ocupado.some(([a, b]) => i < b && f > a);
    const agregar = (m, inicio, fin = inicio) => {
        if (!inicio || !fin || !esISO(inicio) || !esISO(fin)) return;
        const i = m.index, f = m.index + m[0].length;
        if (!libre(i, f)) return;
        ocupado.push([i, f]);
        hallazgos.push({ inicio, fin: fin < inicio ? inicio : fin, texto: m[0].trim(), indice: i });
    };
    const cada = (patron, fn) => { for (const m of t.matchAll(new RegExp(patron, 'g'))) fn(m); };
    const diaEnSemana = (base, dow) => sumarDias(inicioSemana(base), (dow + 6) % 7);
    const elegirDia = (dow, modificador) => {
        if (/pasado|anterior/.test(modificador ?? '')) return ultimoDia(hoy, dow, false);
        if (preferirPasado && !/proximo|siguiente|que viene|este|esta/.test(modificador ?? '')) return ultimoDia(hoy, dow, true);
        return proximoDia(hoy, dow, /\beste\b|\besta\b/.test(modificador ?? ''));
    };

    // 1) ISO explícito
    cada('\\b(\\d{4})-(\\d{2})-(\\d{2})\\b', (m) => agregar(m, `${m[1]}-${m[2]}-${m[3]}`));
    // 2a) "del 28 de octubre al 3 de noviembre" (rango que cambia de mes)
    cada(`\\bdel? (\\d{1,2}) de ${RX_MES} (?:al?|hasta el) (\\d{1,2}) de ${RX_MES}(?: (?:de|del) (\\d{4}))?`, (m) => {
        const ini = conAnio(hoy, MESES_N[m[2]], Number(m[1]), m[5], preferirPasado);
        let fin = conAnio(hoy, MESES_N[m[4]], Number(m[3]), m[5], preferirPasado);
        if (ini && fin && fin < ini) fin = crearISO(Number(fin.slice(0, 4)) + 1, MESES_N[m[4]], Number(m[3]));
        agregar(m, ini, fin);
    });
    // 2) "del 15 al 20 de octubre (de 2026)"
    cada(`\\bdel? (\\d{1,2}) (?:al?|hasta el) (\\d{1,2}) de ${RX_MES}(?: (?:de|del) (\\d{4}))?`, (m) => {
        const mes = MESES_N[m[3]];
        agregar(m, conAnio(hoy, mes, Number(m[1]), m[4], preferirPasado), conAnio(hoy, mes, Number(m[2]), m[4], preferirPasado));
    });
    // 3) "15 de octubre (de 2026)" y "octubre 15"
    cada(`\\b(\\d{1,2}) de ${RX_MES}(?: (?:de|del) (\\d{4}))?`, (m) => agregar(m, conAnio(hoy, MESES_N[m[2]], Number(m[1]), m[3], preferirPasado)));
    cada(`\\b${RX_MES} (\\d{1,2})\\b`, (m) => agregar(m, conAnio(hoy, MESES_N[m[1]], Number(m[2]), null, preferirPasado)));
    // 4) "15/10", "15-10-2026" (día/mes, como se escribe en Colombia)
    cada('\\b(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b', (m) => {
        if (Number(m[2]) > 12) return;
        agregar(m, conAnio(hoy, Number(m[2]), Number(m[1]), m[3], preferirPasado));
    });
    // 5) rangos de días: "del lunes al viernes", "de lunes a viernes"
    cada(`\\b(?:del?|desde el) (proximo |este )?${RX_DIA} (?:al?|hasta el) ${RX_DIA}\\b`, (m) => {
        const ini = proximoDia(hoy, DIAS_N[m[2]], !/proximo/.test(m[1] ?? ''));
        let fin = proximoDia(ini, DIAS_N[m[3]], true);
        agregar(m, ini, fin);
    });
    // 6a) día de la semana con modificadores
    cada(`\\b(?:(el|este|esta|el proximo|el siguiente|proximo|el pasado)\\s+)?${RX_DIA}(\\s+(?:que viene|pasado|de la (?:otra|proxima|siguiente) semana|de esta semana|de la semana pasada))?\\b`, (m) => {
        const dow = DIAS_N[m[2]];
        const mod = `${m[1] ?? ''} ${m[3] ?? ''}`;
        let iso;
        if (/de la (?:otra|proxima|siguiente) semana/.test(mod)) iso = diaEnSemana(sumarDias(hoy, 7), dow);
        else if (/de esta semana/.test(mod)) iso = diaEnSemana(hoy, dow);
        else if (/de la semana pasada/.test(mod)) iso = diaEnSemana(sumarDias(hoy, -7), dow);
        else iso = elegirDia(dow, mod);
        agregar(m, iso);
    });
    // 6) semanas y fines de semana
    cada('\\b(?:la )?(?:proxima|siguiente|otra) semana\\b|\\bla semana que viene\\b', (m) => {
        const lunes = sumarDias(inicioSemana(hoy), 7);
        agregar(m, lunes, sumarDias(lunes, 6));
    });
    cada('\\b(?:la )?semana pasada\\b', (m) => { const lunes = sumarDias(inicioSemana(hoy), -7); agregar(m, lunes, sumarDias(lunes, 6)); });
    cada('\\besta semana\\b', (m) => { const lunes = inicioSemana(hoy); agregar(m, lunes, sumarDias(lunes, 6)); });
    cada('\\b(?:este |el )?fin de semana(?: pasado)?\\b', (m) => {
        const pasado = /pasado/.test(m[0]) || preferirPasado;
        const dow = diaSemana(hoy);
        let sabado;
        if (pasado) sabado = dow === 6 ? hoy : dow === 0 ? sumarDias(hoy, -1) : ultimoDia(hoy, 6, false);
        else sabado = dow === 6 ? hoy : dow === 0 ? sumarDias(hoy, -1) : proximoDia(hoy, 6, false);
        agregar(m, sabado, sumarDias(sabado, 1));
    });
    cada('\\b(?:este|el) mes\\b|\\bfin de mes\\b', (m) => agregar(m, /fin de mes/.test(m[0]) ? ultimoDiaMes(hoy) : hoy, ultimoDiaMes(hoy)));
    // 7) "en 3 días", "dentro de dos semanas", "hace 2 días"
    cada(`\\b(?:en|dentro de) ${RX_NUM} (dias?|semanas?)\\b`, (m) => agregar(m, sumarDias(hoy, Math.round(aNumero(m[1]) * (m[2].startsWith('semana') ? 7 : 1)))));
    cada(`\\bhace ${RX_NUM} (dias?|semanas?)\\b`, (m) => agregar(m, sumarDias(hoy, -Math.round(aNumero(m[1]) * (m[2].startsWith('semana') ? 7 : 1)))));
    // 8) palabras relativas
    cada('\\bpasado manana\\b', (m) => agregar(m, sumarDias(hoy, 2)));
    cada('\\b(?:anteayer|antier|antes de ayer)\\b', (m) => agregar(m, sumarDias(hoy, -2)));
    cada('\\bayer\\b', (m) => agregar(m, sumarDias(hoy, -1)));
    cada('\\bhoy\\b|\\besta (?:noche|tarde)\\b', (m) => agregar(m, hoy));
    for (const m of t.matchAll(/\bmanana\b/g)) {
        const antes = t.slice(Math.max(0, m.index - 12), m.index);
        if (/\b(la|esta|las|cada|toda la|pasado)\s+$/.test(antes)) continue;    // "por la mañana", "esta mañana"
        agregar(m, sumarDias(hoy, 1));
    }
    // 10) "el 15" (solo el número del día)
    cada('\\bel (\\d{1,2})\\b(?!\\s*(?:de|:|h\\b|horas?|am|pm|a\\.?m|p\\.?m|y media))', (m) => {
        const dia = Number(m[1]);
        if (dia < 1 || dia > 31) return;
        const [a, mes] = hoy.split('-').map(Number);
        let iso = crearISO(a, mes, dia);
        if (preferirPasado) { if (!iso || iso > hoy) iso = crearISO(mes === 1 ? a - 1 : a, mes === 1 ? 12 : mes - 1, dia); }
        else if (!iso || iso < hoy) iso = crearISO(mes === 12 ? a + 1 : a, mes === 12 ? 1 : mes + 1, dia);
        agregar(m, iso);
    });
    return hallazgos.sort((x, y) => x.indice - y.indice);
}

/** Primera fecha (o rango) del texto; null si no hay */
export function resolverFecha(texto, hoy, opciones) {
    const [primera] = buscarFechas(texto, hoy, opciones);
    return primera ?? null;
}

/** Rango de días mencionado; si hay dos fechas sueltas ("del lunes" … "hasta el jueves") forma un rango */
export function resolverRango(texto, hoy, opciones) {
    const lista = buscarFechas(texto, hoy, opciones);
    if (lista.length === 0) return null;
    if (lista.length >= 2 && /\bhasta\b/.test(normalizarTexto(texto)) && lista[1].fin >= lista[0].inicio) {
        return { inicio: lista[0].inicio, fin: lista[1].fin, texto: `${lista[0].texto} … ${lista[1].texto}` };
    }
    return lista[0];
}

// ---------------- Horas ----------------
const RX_MER = '(a\\.? ?m\\.?|p\\.? ?m\\.?|de la manana|de la tarde|de la noche|de la madrugada|del mediodia)';
const RX_H = '(\\d{1,2})(?::(\\d{2})|h(\\d{2})| y (media|cuarto))?';

function minutosDe(h, mm, mmH, fraccion) {
    let min = 0;
    if (mm) min = Number(mm); else if (mmH) min = Number(mmH);
    else if (fraccion === 'media') min = 30; else if (fraccion === 'cuarto') min = 15;
    return { h: Number(h), min };
}
function convertir({ h, min }, mer) {
    if (h > 24 || min > 59) return null;
    let hh = h;
    const m = (mer ?? '').replace(/[\s.]/g, '');
    if (/^pm$|tarde|noche/.test(m)) { if (hh < 12) hh += 12; else if (hh === 12 && /noche/.test(m)) hh = 0; }
    else if (/^am$|manana|madrugada/.test(m)) { if (hh === 12) hh = 0; }
    else if (/mediodia/.test(m)) { /* 12 del mediodía */ }
    if (hh === 24) hh = 0;
    return hh * 60 + min;
}
// Sin am/pm: 1–6 se asume de la tarde (un estudiante rara vez agenda a las 3 a. m.)
function suponer({ h, min }) {
    if (h >= 13 || h === 0) return h * 60 + min;
    if (h >= 1 && h <= 6) return (h + 12) * 60 + min;
    return h * 60 + min;
}

/**
 * Busca un horario en el texto: "de 2 a 4 pm", "de 10 pm a 1 am" (cruza medianoche), "a las 3 y media",
 * "15:30", "a mediodía". Devuelve { hora_inicio, hora_fin|null, duracion|null, cruzaMedianoche } o null.
 */
export function buscarHoras(texto) {
    const t = normalizarTexto(texto);
    const resultado = (ini, fin) => {
        if (ini === null) return null;
        if (fin === null || fin === undefined) return { hora_inicio: deMinutos(ini), hora_fin: null, duracion: null, cruzaMedianoche: false };
        let dur = fin - ini;
        const cruza = dur <= 0;
        if (cruza) dur += 1440;
        return { hora_inicio: deMinutos(ini), hora_fin: deMinutos(fin), duracion: dur / 60, cruzaMedianoche: cruza };
    };

    // rango "de 2 a 4 pm", "desde las 10:00 hasta las 12", "entre 6 y 8 de la noche"
    const rxRango = new RegExp(`\\b(?:de|desde|entre)(?: las| la)? ${RX_H}(?: ?${RX_MER})? (?:a|hasta|y)(?: las| la)? ${RX_H}(?: ?${RX_MER})?`);
    const r = rxRango.exec(t);
    if (r) {
        const a = minutosDe(r[1], r[2], r[3], r[4]);
        const b = minutosDe(r[6], r[7], r[8], r[9]);
        const merA = r[5], merB = r[10];
        let ini, fin;
        if (merA && merB) { ini = convertir(a, merA); fin = convertir(b, merB); }
        else if (merB) {
            fin = convertir(b, merB);
            const candidato = convertir(a, merB);
            ini = candidato !== null && candidato < fin ? candidato : convertir(a, 'am');
            if (ini !== null && ini >= fin && /pm|tarde|noche/.test(merB)) ini = candidato; // "de 10 a 1 de la noche"
        } else if (merA) {
            ini = convertir(a, merA);
            const mismo = convertir(b, merA);
            fin = mismo !== null && mismo > ini ? mismo : (b.h <= 12 ? convertir(b, b.h === 12 ? 'pm' : 'am') : b.h * 60 + b.min);
            if (fin !== null && fin <= ini && mismo !== null && mismo > ini) fin = mismo;
        } else {
            ini = suponer(a);
            fin = suponer(b);
            if (fin <= ini && b.h < 12 && b.h + 12 > ini / 60) fin = (b.h + 12) * 60 + b.min;
        }
        if (ini !== null && fin !== null) return resultado(ini, fin);
    }
    if (/\bmediodia\b/.test(t) && !/del mediodia/.test(t)) return resultado(12 * 60, null);
    if (/\bmedianoche\b|\bmedia noche\b/.test(t)) return resultado(0, null);
    // hora suelta: "a las 3 pm", "a las 15:30", "3:30 de la tarde", "8am"
    const rxSuelta = new RegExp(`\\b(?:a las|a la|las|tipo|como a las)? ?${RX_H}(?: ?${RX_MER})`);
    const s1 = rxSuelta.exec(t);
    if (s1) return resultado(convertir(minutosDe(s1[1], s1[2], s1[3], s1[4]), s1[5]), null);
    const s2 = new RegExp(`\\b(?:a las|a la) ${RX_H}\\b`).exec(t);
    if (s2) return resultado(suponer(minutosDe(s2[1], s2[2], s2[3], s2[4])), null);
    const s3 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
    if (s3) return resultado(Number(s3[1]) * 60 + Number(s3[2]), null);
    return null;
}

// ---------------- Duraciones ----------------
/**
 * "1 hora y media" → 1.5 · "hora y media" → 1.5 · "media hora" → 0.5 · "90 minutos" → 1.5 · "2h30" → 2.5
 * Devuelve { horas, porDia } (redondeado a 0.5) o null. No confunde "a las 2" (hora) con una duración.
 */
export function buscarDuracion(texto) {
    const t = normalizarTexto(texto);
    const porDia = /\b(diari[oa]s?|al dia|por dia|cada dia|todos los dias)\b/.test(t);
    const fin = (h) => (Number.isFinite(h) && h > 0 ? { horas: Math.max(0.5, redondearMedia(h)), porDia } : null);

    let m = new RegExp(`\\b${RX_NUM} (?:horas?|hrs?|h)\\b(?: y (media|cuarto|${RX_NUM} (?:minutos?|min)))?`).exec(t);
    if (m) {
        let h = aNumero(m[1]);
        if (m[2] === 'media') h += 0.5; else if (m[2] === 'cuarto') h += 0.25; else if (m[3]) h += aNumero(m[3]) / 60;
        return fin(h);
    }
    m = /\b(\d{1,2})h(\d{2})\b/.exec(t);
    if (m) return fin(Number(m[1]) + Number(m[2]) / 60);
    if (/\b(?:una )?hora y media\b/.test(t)) return fin(1.5);
    if (/\bmedia hora\b/.test(t)) return fin(0.5);
    if (/\b(?:una|la) hora\b/.test(t) && !/\ba la hora\b/.test(t)) return fin(1);
    m = new RegExp(`\\b${RX_NUM} (?:minutos?|min)\\b`).exec(t);
    if (m) return fin(aNumero(m[1]) / 60);
    return null;
}

// ---------------- Señales del texto ----------------
const RX_CANSANCIO_FUERTE = /\b(exhaust[oa]|agotad[oa]|reventad[oa]|molid[oa]|muert[oa] de cansancio|durisim[oa]|al limite|muy (duro|intenso|pesado|fuerte))\b/;
const RX_CANSANCIO = /\b(cansad[oa]|cansancio|cansa|agota|exhaust|reventad|molid|duro|dura|intens[oa]|pesad[oa]|fuerte|exigente|maraton)\b/;

/** 0 = no indica cansancio · 2 = cansado / entrenamiento duro · 3 = agotador */
export function nivelCansancio(texto) {
    const t = normalizarTexto(texto);
    if (RX_CANSANCIO_FUERTE.test(t)) return 3;
    if (RX_CANSANCIO.test(t)) return 2;
    return 0;
}

/** "ya hice", "terminé", "acabé", "hoy jugué…" → completado */
export function indicaCompletado(texto) {
    const t = normalizarTexto(texto);
    return /\b(ya (hice|termine|acabe|complete|estudie|jugue|entrene|fui|corri|trabaje|lei|entregue|presente)|termine|acabe|complete|hice|jugue|entrene|corri|estudie|entregue|presente)\b/.test(t);
}

/**
 * Para "libera / elimina / borra lo del jueves": 'eliminar' solo si lo dice de forma explícita,
 * 'aplazar' si pide mover o simplemente liberar, 'ambiguo' si dice eliminar/borrar sin más.
 */
export function modoLiberacion(texto) {
    const t = normalizarTexto(texto);
    if (/\b(definitiva(mente)?|para siempre|permanente(mente)?|no (la|las|lo|los) voy a hacer|sin aplazar|no (las|los|la|lo) muevas|no reprogram|elimina(las|los)? del todo|borra(las|los)? del todo|que desaparezca)\b/.test(t)) return 'eliminar';
    if (/\b(aplaz|pospon|posterg|mueve|muevelo|muevelas|movel|pasa(las|los|lo|la)? a|reprogram|reubic|corre(las|los)?|libera|liberar|despeja|no puedo|no voy a poder|me (enferme|siento mal)|tengo un imprevisto)/.test(t)) return 'aplazar';
    if (/\b(elimina|eliminar|borra|borrar|quita|quitar|cancela|cancelar|suprime)/.test(t)) return 'ambiguo';
    return null;
}

export const esAfirmacion = (texto) => /^(si|sí|dale|ok|okay|okey|vale|de una|hagale|hágale|listo|confirmo|confirmar|aplica|aplicar|aplicalo|aplícalo|hazlo|claro|perfecto|adelante|correcto|si,? (aplica|hazlo|dale|por favor))[\s.!]*$/i
    .test(String(texto ?? '').trim()) || /^s[ií][\s.!]*$/i.test(String(texto ?? '').trim());
export const esNegacion = (texto) => /^(no|nop|nel|cancela|cancelar|mejor no|no gracias|déjalo|dejalo|olvídalo|olvidalo)[\s.!]*$/i.test(String(texto ?? '').trim());
export const pideDeshacer = (texto) => /\b(deshaz|deshacer|deshace|revierte|revertir|vuelve atr[aá]s|devuelve(lo)? como estaba)\b/i.test(quitarTildes(String(texto ?? '')).toLowerCase())
    || /\bdeshaz\b/i.test(String(texto ?? ''));

/**
 * Campos de una actividad que el texto del usuario menciona. Sirve de filtro contra el modelo: en una edición
 * solo se aceptan los campos que el usuario pidió cambiar (aunque el modelo devuelva el registro entero).
 */
export function camposMencionados(texto, { hayFecha = false, hayHora = false, hayDuracion = false } = {}) {
    const t = normalizarTexto(texto);
    const c = new Set();
    if (hayFecha || /\b(fecha|dia|semana|mueve|muevel|pasa(la|lo)? (al|para)|aplaza|pospon|adelanta|reprograma|cambia(la|lo)? (al|para))\b/.test(t)) { c.add('fecha_inicio'); c.add('fecha_fin'); }
    if (hayHora || /\b(hora|horario|a las|empieza|termina|inicio|fin)\b/.test(t)) { c.add('hora_inicio'); c.add('hora_fin'); }
    if (hayDuracion || /\b(dura|duracion|horas?|minutos?|mas tiempo|menos tiempo|alarga|acorta)\b/.test(t)) c.add('horas');
    if (/\b(exigencia|intens|dificil|facil|pesad|suave|liviana|liviano|cansad|agot|exhaust|duro|dura|alta|media|baja|recarga|ligera|ligero)\b/.test(t)) c.add('exigencia');
    if (/\b(tipo|estudio|estudiar|trabajo|laboral|ocio|deporte|ejercicio|gimnasio|descanso)\b/.test(t)) c.add('tipo');
    if (/\b(estado|complet|termin|acabe|hecho|hecha|lista|listo|en proceso|empece|empezado|pendiente|por hacer|ya hice|hice)\b/.test(t)) c.add('estado');
    if (/\b(nombre|titulo|llamal|renombr|ponle de nombre|cambia(le)? el nombre|que se llame)\b/.test(t)) c.add('titulo');
    if (/\b(proyecto)\b/.test(t)) c.add('proyecto');
    if (/\b(fija|fijo|no la muevas|no lo muevas|no se mueve|bloquea|desbloquea|movible)\b/.test(t)) c.add('fija');
    return c;
}
