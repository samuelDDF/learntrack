// Validación de los datos del repaso espaciado que llegan del cliente.
import { esFechaValida } from './texto.js';

/**
 * Valida la calificación de un repaso (0–5, entero).
 * @param {*} valor  Valor del cuerpo de la petición
 * @returns {{ error?: string, calificacion?: number }}
 */
export function validarCalificacion(valor) {
    // v3.6: solo números o cadenas de UN dígito. Antes Number('') = 0, Number(null) = 0, Number(true) = 1 y
    // Number([3]) = 3 pasaban como calificaciones válidas y reiniciaban o avanzaban la tarjeta sin querer.
    const n = typeof valor === 'number' ? valor
        : typeof valor === 'string' && /^\s*\d\s*$/.test(valor) ? Number(valor)
            : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 5) {
        return { error: 'La calificación debe ser un entero entre 0 y 5.' };
    }
    return { calificacion: n };
}

/**
 * Fecha del primer repaso al activar: opcional (por defecto `hoy`); si llega, debe ser una fecha real YYYY-MM-DD
 * y no más de un año antes o después de hoy.
 * @returns {{ error?: string, proximaFecha?: string }}
 */
export function validarProximaFecha(valor, hoy) {
    if (valor === undefined || valor === null || valor === '') return { proximaFecha: hoy };
    if (!esFechaValida(valor)) return { error: 'Fecha no válida (formato YYYY-MM-DD).' };
    const [a] = hoy.split('-').map(Number);
    const limiteInf = `${a - 1}${hoy.slice(4)}`, limiteSup = `${a + 1}${hoy.slice(4)}`;
    if (valor < limiteInf || valor > limiteSup) return { error: 'La fecha del primer repaso debe estar dentro de un año desde hoy.' };
    return { proximaFecha: valor };
}


