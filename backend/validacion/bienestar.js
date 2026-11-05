// Check-in diario e historial de carga.
import { ANIMOS, SUENOS, ENFOQUES } from '../../compartido/catalogos.js';
import { esFechaValida } from './texto.js';
import { validarFechaHoy } from './asistente.js';

export function validarCheckin(body) {
    if (!esFechaValida(body?.fecha)) return { error: 'Fecha del check-in no válida.' };
    if (!ANIMOS.includes(body?.animo) || !SUENOS.includes(body?.sueno) || !ENFOQUES.includes(body?.enfoque)) {
        return { error: 'Responde las tres preguntas del check-in.' };
    }
    return { valor: { fecha: body.fecha, animo: body.animo, sueno: body.sueno, enfoque: body.enfoque } };
}

// El porcentaje no lo manda el cliente: el servidor lo calcula con la regla única (compartido/carga.js).
// El historial solo se guarda para días <= hoy (fecha local del cliente).
export function validarHistorial(body) {
    const fechaHoy = validarFechaHoy(body);
    if (!esFechaValida(body?.fecha) || !fechaHoy) return { error: 'Datos de historial no válidos.' };
    if (body.fecha > fechaHoy) return { error: 'Solo se guarda el historial de hoy o de días pasados.' };
    return { valor: { fecha: body.fecha, fechaHoy } };
}
