// Avisos entre piezas de la zona privada que no comparten árbol de estado (p. ej. el importador de festivos de la
// barra y la agenda). En la 3.4.2 el emisor y el oyente usaban nombres distintos y la agenda no se enteraba.
const oyentes = new Map();

export function emitir(evento, datos) {
    for (const fn of oyentes.get(evento) ?? []) fn(datos);
}
export function escuchar(evento, fn) {
    if (!oyentes.has(evento)) oyentes.set(evento, new Set());
    oyentes.get(evento).add(fn);
    return () => oyentes.get(evento)?.delete(fn);
}
export const FESTIVOS_ACTUALIZADOS = 'festivos-actualizados';
