// Módulo Estudio (v3.12): validación de lo que envía el navegador. Nada llega a la base de datos sin pasar por aquí.
import { CATEGORIAS_OBJETIVO, NIVELES, PRIORIDADES_OBJETIVO, ESTADOS_OBJETIVO } from '../../compartido/estudio.js';
import { sumarDias } from '../../compartido/fechas.js';
import { limpiarTextoVisible, esFechaValida, esHoraValida, tiene, esObjeto } from './texto.js';

const RE_ID = /^[a-f0-9]{24}$/;
export const esIdObjetivo = (v) => typeof v === 'string' && RE_ID.test(v);
export const MAX_SESIONES_POR_ENVIO = 30;
export const MAX_IDS_PLAN = 10;
const trae = (body, clave) => body && Object.prototype.hasOwnProperty.call(body, clave);

/** Estados que la persona puede poner a mano (sugerido y descartado los gestiona el flujo de sugerencias) */
const ESTADOS_EDITABLES = ['pendiente', 'en_curso', 'completado'];

/**
 * Objetivo de aprendizaje.
 *  - completa = true  (POST): exige el tema y rellena valores por defecto.
 *  - completa = false (PUT) : solo se validan y devuelven los campos enviados.
 * `hoy` limita las fechas límite a un rango razonable (de hace un año a dentro de cinco).
 */
export function validarObjetivo(body, { completa = true, hoy } = {}) {
    if (!esObjeto(body)) return { error: 'Datos no válidos.' };
    const v = {};
    if (completa || tiene(body, 'tema')) {
        v.tema = limpiarTextoVisible(body.tema, 100);
        if (v.tema.length < 2) return { error: 'Escribe el tema que quieres aprender (2 a 100 caracteres).' };
    }
    if (completa || trae(body, 'categoria')) {
        const c = body.categoria ?? 'tema';
        if (!CATEGORIAS_OBJETIVO.includes(c)) return { error: 'Categoría no válida.' };
        v.categoria = c;
    }
    if (completa || trae(body, 'descripcion')) v.descripcion = limpiarTextoVisible(body.descripcion ?? '', 500);
    for (const clave of ['nivelActual', 'nivelObjetivo']) {
        if (completa || trae(body, clave)) {
            const n = body[clave] ?? '';
            if (!NIVELES.includes(n)) return { error: 'Nivel de conocimiento no válido.' };
            v[clave] = n;
        }
    }
    if (completa || trae(body, 'fechaLimite')) {
        const f = body.fechaLimite ?? null;
        if (f === null || f === '') v.fechaLimite = null;
        else if (!esFechaValida(f)) return { error: 'Fecha límite no válida.' };
        else if (hoy && (f < sumarDias(hoy, -366) || f > sumarDias(hoy, 365 * 5))) return { error: 'La fecha límite está fuera de rango.' };
        else v.fechaLimite = f;
    }
    if (completa || trae(body, 'prioridad')) {
        const p = Number(body.prioridad ?? 2);
        if (!PRIORIDADES_OBJETIVO.includes(p)) return { error: 'Prioridad no válida.' };
        v.prioridad = p;
    }
    if (completa || trae(body, 'horasEstimadas')) {
        const h = Number(body.horasEstimadas ?? 4);
        if (!Number.isFinite(h) || h < 0.5 || h > 200) return { error: 'Las horas estimadas deben estar entre 0,5 y 200.' };
        v.horasEstimadas = Math.round(h * 2) / 2;
    }
    if (trae(body, 'progresoManual')) {
        const p = body.progresoManual;
        if (p === null || p === '') v.progresoManual = null;
        else {
            const n = Number(p);
            if (!Number.isInteger(n) || n < 0 || n > 100) return { error: 'El progreso debe ser un número entero entre 0 y 100.' };
            v.progresoManual = n;
        }
    }
    if (trae(body, 'estado')) {
        if (!ESTADOS_EDITABLES.includes(body.estado)) return { error: 'Estado no válido.' };
        v.estado = body.estado;
    } else if (completa) v.estado = 'pendiente';
    if (completa || trae(body, 'proyecto')) v.proyecto = limpiarTextoVisible(body.proyecto ?? '', 60);
    return { valor: v };
}

/** Respuesta a una sugerencia de la IA */
export function validarAccionSugerencia(body) {
    const accion = body?.accion;
    if (!['aceptar', 'descartar', 'posponer'].includes(accion)) return { error: 'Acción no válida (aceptar, descartar o posponer).' };
    const dias = Number(body?.dias ?? 7);
    if (accion === 'posponer' && (!Number.isInteger(dias) || dias < 1 || dias > 60)) return { error: 'Puedes posponer entre 1 y 60 días.' };
    return { valor: { accion, dias, planificar: body?.planificar === true } };
}

/** Petición de un plan de sesiones (no escribe nada) */
export function validarPeticionPlan(body) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    if (ids.length === 0 || ids.length > MAX_IDS_PLAN || !ids.every(esIdObjetivo)) return { error: `Elige entre 1 y ${MAX_IDS_PLAN} temas para planificar.` };
    const horasPorSesion = Number(body?.horasPorSesion ?? 1);
    if (![0.5, 1, 1.5, 2, 2.5, 3].includes(horasPorSesion)) return { error: 'La duración de cada sesión debe estar entre 0,5 y 3 horas (en medias horas).' };
    const maxPorDia = Number(body?.maxPorDia ?? 2);
    if (!Number.isInteger(maxPorDia) || maxPorDia < 1 || maxPorDia > 4) return { error: 'Las sesiones por día deben estar entre 1 y 4.' };
    return { valor: { ids: [...new Set(ids)], horasPorSesion, maxPorDia } };
}

/**
 * Sesiones que la persona CONFIRMA (tras revisar y ajustar el plan). Cada una: { objetivoId, fecha, hora_inicio, horas }.
 * La comprobación contra la agenda (huecos, duplicados, fechas pasadas) la hace la ruta con los datos actuales.
 */
export function validarSesionesConfirmadas(body) {
    const lista = body?.sesiones;
    if (!Array.isArray(lista) || lista.length === 0) return { error: 'No hay sesiones que guardar.' };
    if (lista.length > MAX_SESIONES_POR_ENVIO) return { error: `Como máximo ${MAX_SESIONES_POR_ENVIO} sesiones a la vez.` };
    const valor = [];
    for (const [i, s] of lista.entries()) {
        const n = i + 1;
        if (!esObjeto(s) || !esIdObjetivo(s.objetivoId)) return { error: `Sesión ${n}: tema no válido.` };
        if (!esFechaValida(s.fecha)) return { error: `Sesión ${n}: fecha no válida.` };
        if (!esHoraValida(s.hora_inicio)) return { error: `Sesión ${n}: hora de inicio no válida (HH:MM).` };
        const horas = Number(s.horas);
        if (!Number.isFinite(horas) || horas < 0.5 || horas > 4 || Math.round(horas * 2) !== horas * 2) return { error: `Sesión ${n}: la duración debe estar entre 0,5 y 4 horas (en medias horas).` };
        valor.push({ objetivoId: s.objetivoId, fecha: s.fecha, hora_inicio: s.hora_inicio, horas });
    }
    return { valor };
}

const TIPOS_FECHA_ACADEMICA = ['entrega', 'examen', 'publicacion', 'inicio', 'realizacion', 'otro'];
export { TIPOS_FECHA_ACADEMICA };

/**
 * Lo que la persona confirma tras revisar el análisis de un documento:
 * { objetivos: [{ tema, motivo, horasEstimadas, nivelObjetivo, prioridad }], fechaLimite, entrega: { titulo, fecha, hora_inicio } | null }
 */
export function validarLoteDocumento(body, { hoy } = {}) {
    const lista = body?.objetivos;
    if (!Array.isArray(lista) || lista.length === 0 || lista.length > 15) return { error: 'Elige entre 1 y 15 temas.' };
    let fechaLimite = null;
    if (body.fechaLimite) {
        if (!esFechaValida(body.fechaLimite)) return { error: 'Fecha límite no válida.' };
        if (hoy && body.fechaLimite < hoy) return { error: 'La fecha límite ya pasó: corrígela o déjala vacía.' };
        fechaLimite = body.fechaLimite;
    }
    const objetivos = [];
    for (const o of lista) {
        const { error, valor } = validarObjetivo({
            tema: o?.tema, descripcion: o?.motivo ?? '', horasEstimadas: o?.horasEstimadas ?? 4, nivelObjetivo: o?.nivelObjetivo ?? '',
            prioridad: o?.prioridad ?? 2, fechaLimite, proyecto: body.proyecto ?? ''
        }, { hoy });
        if (error) return { error: `«${limpiarTextoVisible(o?.tema, 40)}»: ${error}` };
        valor.motivo = limpiarTextoVisible(o?.motivo ?? '', 300);
        objetivos.push(valor);
    }
    let entrega = null;
    if (body.entrega) {
        const e = body.entrega;
        const titulo = limpiarTextoVisible(e?.titulo, 100);
        if (!titulo) return { error: 'La entrega necesita un título.' };
        if (!esFechaValida(e?.fecha)) return { error: 'Fecha de entrega no válida.' };
        if (hoy && e.fecha < hoy) return { error: 'La fecha de entrega ya pasó.' };
        const hora = e?.hora_inicio ? (esHoraValida(e.hora_inicio) ? e.hora_inicio : 'x') : null;
        if (hora === 'x') return { error: 'Hora de entrega no válida.' };
        entrega = { titulo, fecha: e.fecha, hora_inicio: hora };
    }
    return { valor: { objetivos, fechaLimite, entrega } };
}
