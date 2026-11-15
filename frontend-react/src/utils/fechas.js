// Fecha y hora LOCALES del navegador (nunca toISOString/UTC: en Bogotá a las 8 p. m. el UTC ya es mañana).
// Las cuentas con fechas (sumar días, semanas, rangos) están en compartido/fechas.js, que usan servidor y navegador.

export function hoyISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const tzOffset = () => new Date().getTimezoneOffset();
/** Zona horaria IANA del navegador (p. ej. America/Bogota) o '' si no se conoce */
export const zonaHoraria = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
/** Hora local "HH:MM" */
export const horaLocal = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** 'YYYY-MM-DD' → Date a mediodía local (evita saltos de día por horario de verano) */
export const aFecha = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d, 12); };
export const formatear = (iso, opciones) => aFecha(iso).toLocaleDateString('es', opciones);
export const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
export const mesAnio = (iso) => capitalizar(formatear(iso, { month: 'long', year: 'numeric' }));
export const diaLargo = (iso) => capitalizar(formatear(iso, { weekday: 'long', day: 'numeric', month: 'long' }));
export const diaCorto = (iso) => formatear(iso, { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
export const horasTxt = (n) => `${Number.isInteger(n) ? n : Number(n).toFixed(1)} h`;
