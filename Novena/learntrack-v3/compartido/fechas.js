// Utilidades de calendario puras (sin zona horaria): todas las fechas son cadenas "YYYY-MM-DD" y las horas "HH:MM".
// Las usan el servidor (Node) y el navegador (se sirve en /app/compartido/fechas.js). No importan nada.

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const dosCifras = (n) => String(n).padStart(2, '0');

/** ¿Es una fecha real del calendario? (rechaza 2026-02-31) */
export function esISO(valor) {
    if (typeof valor !== 'string') return false;
    const m = RE_ISO.exec(valor);
    if (!m) return false;
    const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const f = new Date(Date.UTC(a, mes - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d;
}

export const esHora = (v) => typeof v === 'string' && RE_HORA.test(v);

export function crearISO(anio, mes, dia) {
    const iso = `${anio}-${dosCifras(mes)}-${dosCifras(dia)}`;
    return esISO(iso) ? iso : null;
}

function aUTC(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
}
const deUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export const sumarDias = (iso, n) => deUTC(aUTC(iso) + n * 86400000);
export const diasEntre = (desde, hasta) => Math.round((aUTC(hasta) - aUTC(desde)) / 86400000);
/** 0 = domingo … 6 = sábado */
export const diaSemana = (iso) => new Date(aUTC(iso)).getUTCDay();
/** Lunes de la semana de `iso` */
export const inicioSemana = (iso) => sumarDias(iso, -((diaSemana(iso) + 6) % 7));
export const ultimoDiaMes = (iso) => { const [a, m] = iso.split('-').map(Number); return deUTC(Date.UTC(a, m, 0)); };

export function rangoFechas(desde, hasta, maximo = 400) {
    const lista = [];
    for (let iso = desde, i = 0; iso <= hasta && i < maximo; iso = sumarDias(iso, 1), i++) lista.push(iso);
    return lista;
}

/**
 * Fecha local de un instante, dado el desfase que devuelve Date#getTimezoneOffset() en el navegador
 * (minutos; Bogotá = 300). Así el servidor razona en el día del usuario y no en UTC.
 */
export function fechaLocal(instante, tzOffsetMin = 0) {
    return deUTC(new Date(instante).getTime() - tzOffsetMin * 60000);
}
/** Instante UTC en que empieza el día local `iso` */
export function inicioDiaLocal(iso, tzOffsetMin = 0) {
    return new Date(aUTC(iso) + tzOffsetMin * 60000);
}

export function aMinutos(hora) { const [h, m] = hora.split(':').map(Number); return h * 60 + m; }
export function deMinutos(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${dosCifras(Math.floor(m / 60))}:${dosCifras(m % 60)}`;
}

/** Redondea al múltiplo de 0.5 más cercano */
export const redondearMedia = (horas) => Math.round(Number(horas) * 2) / 2;

/** "jueves 9 de octubre" */
export function fechaLarga(iso) {
    const [, m, d] = iso.split('-').map(Number);
    return `${DIAS[diaSemana(iso)]} ${d} de ${MESES[m - 1]}`;
}
/** "jue 9" */
export function fechaCorta(iso) {
    return `${DIAS_CORTOS[diaSemana(iso)]} ${Number(iso.slice(8, 10))}`;
}

/**
 * Tabla de los próximos `dias` días para el prompt del modelo (los modelos pequeños fallan con la aritmética
 * de fechas, así que se la damos hecha).
 */
export function tablaFechas(hoy, dias = 14) {
    const filas = [];
    for (let i = 0; i <= dias; i++) {
        const iso = sumarDias(hoy, i);
        const etiqueta = i === 0 ? ' (hoy)' : i === 1 ? ' (mañana)' : i === 2 ? ' (pasado mañana)' : '';
        filas.push(`${DIAS[diaSemana(iso)]} ${iso}${etiqueta}`);
    }
    return filas.join('; ');
}
