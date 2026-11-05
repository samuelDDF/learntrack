// Validación de los datos del repaso espaciado que llegan del cliente.
import { esIdActividad } from './actividades.js';
import { esFechaValida } from './texto.js';

/**
 * Valida la calificación de un repaso (0–5, entero).
 * @param {*} valor  Valor del cuerpo de la petición
 * @returns {{ error?: string, calificacion?: number }}
 */
export function validarCalificacion(valor) {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > 5) {
        return { error: 'La calificación debe ser un entero entre 0 y 5.' };
    }
    return { calificacion: n };
}

export { esIdActividad, esFechaValida };

