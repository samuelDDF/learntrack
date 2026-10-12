// Hora local del USUARIO en el servidor. Las fechas de LearnTrack son locales («2026-10-11», «14:00»), así que
// el servidor no puede usar su propio reloj UTC: usa la zona horaria IANA que envía el navegador en la cabecera
// X-Zona-Horaria (p. ej. America/Bogota) o, si no llega o no es válida, ZONA_HORARIA del .env (America/Bogota).
const RE_ZONA = /^[A-Za-z]+(?:[/_-][A-Za-z0-9+_-]+){0,3}$/;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function zonaValida(zona) {
    if (typeof zona !== 'string' || zona.length > 64 || !RE_ZONA.test(zona)) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: zona }); return true; } catch { return false; }
}

export const zonaPorDefecto = () => (zonaValida(process.env.ZONA_HORARIA) ? process.env.ZONA_HORARIA : 'America/Bogota');

/** Zona de la petición (cabecera del navegador) o la del servidor */
export const zonaDe = (req) => {
    const z = req?.get?.('x-zona-horaria');
    return zonaValida(z) ? z : zonaPorDefecto();
};

/** { fecha: 'YYYY-MM-DD', hora: 'HH:MM', diaSemana, zona } en esa zona horaria */
export function ahoraEn(zona = zonaPorDefecto(), instante = new Date()) {
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(instante).map((p) => [p.type, p.value]));
    const fecha = `${partes.year}-${partes.month}-${partes.day}`;
    const [a, m, d] = fecha.split('-').map(Number);
    return { fecha, hora: `${partes.hour}:${partes.minute}`, diaSemana: DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()], zona };
}

/** Día de la semana (en español) de una fecha 'YYYY-MM-DD' */
export function diaSemanaDe(iso) {
    const [a, m, d] = String(iso).split('-').map(Number);
    return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? '';
}

/** Momento del usuario para el Prompt Maestro: su fecha local (fechaHoy) y su hora local (si la envió) */
export function ahoraDelUsuario({ fechaHoy, horaLocal, zona }) {
    const base = ahoraEn(zonaValida(zona) ? zona : zonaPorDefecto());
    const fecha = fechaHoy ?? base.fecha;
    return { fecha, hora: /^([01]\d|2[0-3]):[0-5]\d$/.test(horaLocal ?? '') ? horaLocal : base.hora, diaSemana: diaSemanaDe(fecha), zona: base.zona };
}
