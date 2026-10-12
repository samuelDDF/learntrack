// PRIORIDAD POR URGENCIA (módulo ES puro): la usan el planificador, el asistente y las pantallas.
// Regla única: cuanto más cerca está la fecha de vencimiento de una tarea pendiente, más prioridad tiene.
//   · vencida (ya pasó)       → 'urgente'      · vence en 0–2 días → 'urgente'
//   · vence en 3–7 días       → 'alta'         · exigencia alta sin vencimiento cercano → 'alta'
//   · ocio/deporte de recarga → 'baja'         · el resto → 'media'      · completada → 'ninguna'
import { diasEntre } from './fechas.js';
import { esHito } from './carga.js';

export const DIAS_URGENTE = 2;
export const DIAS_PRONTO = 7;
export const ORDEN_PRIORIDAD = { urgente: 0, alta: 1, media: 2, baja: 3, ninguna: 4 };
export const NOMBRE_PRIORIDAD = { urgente: 'Urgente', alta: 'Alta', media: 'Media', baja: 'Baja', ninguna: '—' };

/** Fecha límite efectiva: la de vencimiento; si no tiene, la de un hito (examen, entrega…) es su propio día */
export function vencimientoDe(a) {
    if (a?.fecha_vencimiento) return a.fecha_vencimiento;
    return esHito(a) ? (a.fecha_fin || a.fecha_inicio || null) : null;
}

/** { nivel, dias (hasta el vencimiento, negativo si pasó), vencimiento } */
export function prioridadDe(a, hoy) {
    const vencimiento = vencimientoDe(a);
    const dias = vencimiento ? diasEntre(hoy, vencimiento) : null;
    let nivel;
    if (a?.estado === 'completado') nivel = 'ninguna';
    else if (dias !== null && dias <= DIAS_URGENTE) nivel = 'urgente';
    else if (dias !== null && dias <= DIAS_PRONTO) nivel = 'alta';
    else if (Number(a?.exigencia) === 3) nivel = 'alta';
    else if (Number(a?.exigencia) < 0) nivel = 'baja';
    else nivel = 'media';
    return { nivel, dias, vencimiento };
}

/** Comparador: primero lo más urgente; a igual prioridad, lo que vence antes */
export function porUrgencia(hoy) {
    return (x, y) => {
        const a = prioridadDe(x, hoy), b = prioridadDe(y, hoy);
        return ORDEN_PRIORIDAD[a.nivel] - ORDEN_PRIORIDAD[b.nivel]
            || (a.vencimiento ?? '9999').localeCompare(b.vencimiento ?? '9999');
    };
}

/** Texto corto para tarjetas: «vence hoy», «vence en 3 días», «venció hace 2 días» */
export function textoVencimiento({ dias }) {
    if (dias === null || dias === undefined) return '';
    if (dias < 0) return `venció hace ${-dias} ${dias === -1 ? 'día' : 'días'}`;
    if (dias === 0) return 'vence hoy';
    if (dias === 1) return 'vence mañana';
    return `vence en ${dias} días`;
}
