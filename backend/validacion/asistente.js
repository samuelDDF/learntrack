// Entradas del asistente de IA: mensaje del chat, consejo del panel, ids de propuestas/lotes y fecha local.
import { ANIMOS } from '../../compartido/catalogos.js';
import { limpiarTextoVisible, esFechaValida, esObjeto } from './texto.js';

const RE_ID_PROPUESTA = /^[a-f0-9]{32}$/;
const RE_ID_LOTE = /^[a-f0-9]{24}$/;
export const esIdPropuesta = (v) => typeof v === 'string' && RE_ID_PROPUESTA.test(v);
export const esIdLote = (v) => typeof v === 'string' && RE_ID_LOTE.test(v);

/** Fecha local del cliente: OBLIGATORIA (el servidor no cae a la fecha UTC; en Bogotá a las 8 p. m. sería mañana) */
export function validarFechaHoy(body) {
    return esFechaValida(body?.fechaHoy) ? body.fechaHoy : null;
}
/** Desfase horario del navegador (Date#getTimezoneOffset, minutos). Opcional; por defecto 0. */
export function validarTzOffset(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= -840 && n <= 840 ? n : 0;
}


/** Contexto opcional de la pantalla desde la que se abre el chat. Solo aporta contexto; nunca concede permisos. */
export function validarContextoChat(valor) {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
    const seccion = ['proyectos', 'estudio'].includes(valor.seccion) ? valor.seccion : null;
    if (!seccion) return null;
    const proyecto = seccion === 'proyectos' ? limpiarTextoVisible(valor.proyecto, 60) : '';
    const tema = seccion === 'estudio' ? limpiarTextoVisible(valor.tema, 100) : '';
    return { seccion, proyecto, tema };
}

/** Entrada de POST /api/ia/chat. El cliente envía los últimos 6 turnos; aquí se validan y recortan. */
/** Hora local del navegador ("HH:MM") para el Prompt Maestro; null si no llega o no es válida */
export const validarHoraLocal = (body) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(body?.horaLocal ?? '') ? body.horaLocal : null);

export function validarEntradaChat(body) {
    const fechaHoy = validarFechaHoy(body);
    if (!fechaHoy) return { error: 'Falta la fecha local (fechaHoy, YYYY-MM-DD).' };
    const texto = limpiarTextoVisible(body?.texto, 500);
    const aclaracionId = esIdPropuesta(body?.aclaracionId) ? body.aclaracionId : null;
    const respuestas = {};
    if (aclaracionId && esObjeto(body?.respuestas)) {
        for (const [k, v] of Object.entries(body.respuestas).slice(0, 2)) {
            if (/^[a-z_]{1,20}$/.test(k) && typeof v === 'string') respuestas[k] = limpiarTextoVisible(v, 80);
        }
    }
    if (texto.length === 0 && !aclaracionId) return { error: 'Escribe un mensaje.' };
    const historial = (Array.isArray(body?.historial) ? body.historial : [])
        .slice(-6)
        .filter((t) => t && typeof t === 'object' && (t.rol === 'usuario' || t.rol === 'asistente') && typeof t.texto === 'string')
        .map((t) => ({ rol: t.rol, texto: limpiarTextoVisible(t.texto, 300) }))
        .filter((t) => t.texto.length > 0);
    return {
        valor: {
            texto, fechaHoy, tzOffset: validarTzOffset(body?.tzOffset), historial, horaLocal: validarHoraLocal(body),
            propuestaPendiente: esIdPropuesta(body?.propuestaPendiente) ? body.propuestaPendiente : null,
            contexto: validarContextoChat(body?.contexto),
            aclaracionId, respuestas
        }
    };
}

/** POST /api/ia/consultar: consejo breve del panel */
export function validarConsultaIA(body) {
    const porcentaje = Number(body?.porcentajeCarga);
    if (!ANIMOS.includes(body?.estadoAnimo) || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 1000) {
        return { error: 'Datos de entrada no válidos.' };
    }
    const actividades = Array.isArray(body?.actividades)
        ? body.actividades.slice(0, 20).map((a) => limpiarTextoVisible(a, 150)).filter(Boolean)
        : [];
    return { valor: { estadoAnimo: body.estadoAnimo, porcentajeCarga: Math.round(porcentaje), actividades } };
}
