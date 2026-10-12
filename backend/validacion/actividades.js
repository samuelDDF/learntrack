// Actividades: validación de lo que envía el formulario y normalización de lo que propone el modelo de IA.
import { TIPOS, TIPOS_RECARGA, EXIGENCIAS, ESTADOS } from '../../compartido/catalogos.js';
import { aMinutos, sumarDias, diasEntre, horasEntre, redondearMedia, sumarMinutos } from '../../compartido/fechas.js';
import { limpiarTextoVisible, esFechaValida, esHoraValida, tiene } from './texto.js';

const RE_ID_ACTIVIDAD = /^[A-Za-z0-9_-]{1,64}$/;
export const esIdActividad = (v) => typeof v === 'string' && RE_ID_ACTIVIDAD.test(v);
const trae = (body, clave) => body && Object.prototype.hasOwnProperty.call(body, clave);
const finAntesDeInicio = (inicio, fin) => aMinutos(fin) <= aMinutos(inicio);

/**
 * Valida una actividad.
 *  - completa = true  (POST): exige los campos base y rellena valores por defecto de los opcionales.
 *  - completa = false (PUT) : acepta cambios parciales; solo se devuelven (y se validan) los campos enviados,
 *    así un PUT parcial no borra estado, horario ni proyecto.
 * `fecha` es un alias retrocompatible de `fecha_inicio`.
 */
export function validarActividad(body, { completa = true } = {}) {
    const v = {};

    if (completa || tiene(body, 'titulo')) {
        v.titulo = limpiarTextoVisible(body?.titulo, 100);
        if (v.titulo.length === 0) return { error: 'El título es obligatorio (máx. 100 caracteres).' };
    }
    if (completa || tiene(body, 'tipo')) {
        if (!TIPOS.includes(body?.tipo)) return { error: 'Tipo de actividad no válido.' };
        v.tipo = body.tipo;
    }
    if (completa || tiene(body, 'exigencia')) {
        const exigencia = Number(body?.exigencia);
        if (!EXIGENCIAS.includes(exigencia)) return { error: 'Nivel de exigencia no válido.' };
        v.exigencia = exigencia;
    }

    // ---- Fechas ----
    const inicioEnviado = tiene(body, 'fecha_inicio') ? body.fecha_inicio : (tiene(body, 'fecha') ? body.fecha : undefined);
    if (completa || inicioEnviado !== undefined) {
        if (!esFechaValida(inicioEnviado)) return { error: 'Fecha no válida.' };
        v.fecha_inicio = inicioEnviado;
        v.fecha = inicioEnviado;
    }
    if (tiene(body, 'fecha_fin')) {
        if (!esFechaValida(body.fecha_fin)) return { error: 'Fecha de fin no válida.' };
        v.fecha_fin = body.fecha_fin;
    } else if (completa) {
        v.fecha_fin = v.fecha_inicio;
    }
    if (v.fecha_inicio && v.fecha_fin && v.fecha_fin < v.fecha_inicio) {
        return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
    }

    // ---- Horario (opcional) ----
    for (const clave of ['hora_inicio', 'hora_fin']) {
        if (trae(body, clave)) {
            if (!tiene(body, clave)) v[clave] = null;                 // vacío = sin hora (también permite borrar)
            else if (!esHoraValida(body[clave])) return { error: 'La hora debe tener formato HH:MM (24 h).' };
            else v[clave] = body[clave];
        } else if (completa) v[clave] = null;
    }
    if (v.hora_inicio && v.hora_fin && finAntesDeInicio(v.hora_inicio, v.hora_fin)) {
        return { error: 'La hora de fin debe ser posterior a la hora de inicio.' };
    }

    // ---- Horas: explícitas, o derivadas del horario ----
    if (tiene(body, 'horas')) {
        const horas = Number(body.horas);
        if (!Number.isFinite(horas) || horas < 0.5 || horas > 12) return { error: 'Las horas deben estar entre 0.5 y 12.' };
        v.horas = horas;
    } else if (v.hora_inicio && v.hora_fin) {
        v.horas = horasEntre(v.hora_inicio, v.hora_fin);
    } else if (completa) {
        return { error: 'Indica las horas (entre 0.5 y 12) o un horario de inicio y fin.' };
    }

    // ---- Estado, proyecto y fija ----
    if (tiene(body, 'estado')) {
        if (!ESTADOS.includes(body.estado)) return { error: 'Estado no válido.' };
        v.estado = body.estado;
    } else if (completa) v.estado = 'pendiente';

    if (trae(body, 'proyecto')) v.proyecto = limpiarTextoVisible(body.proyecto, 60);
    else if (completa) v.proyecto = '';

    // ---- Fechas académicas (opcionales): vencimiento (fecha límite) y asignación ----
    for (const clave of ['fecha_vencimiento', 'fecha_asignacion']) {
        if (trae(body, clave)) {
            if (!tiene(body, clave)) v[clave] = null;
            else if (!esFechaValida(body[clave])) return { error: clave === 'fecha_vencimiento' ? 'Fecha de vencimiento no válida.' : 'Fecha de asignación no válida.' };
            else v[clave] = body[clave];
        }
    }
    if (v.fecha_vencimiento && v.fecha_inicio && v.fecha_vencimiento < v.fecha_inicio) {
        return { error: 'La fecha de vencimiento no puede ser anterior al inicio.' };
    }

    if (trae(body, 'fija')) {                       // el planificador no mueve las actividades fijas
        if (typeof body.fija !== 'boolean') return { error: 'El campo "fija" debe ser verdadero o falso.' };
        v.fija = body.fija;
    } else if (completa) v.fija = false;

    return { valor: v };
}

// ====== Salida del modelo de IA (entrada NO confiable) ======
const SINONIMOS_TIPO = {
    estudio: 'estudio', estudiar: 'estudio', academico: 'estudio', académico: 'estudio', universidad: 'estudio', clase: 'estudio',
    trabajo: 'trabajo', trabajar: 'trabajo', laboral: 'trabajo', reunion: 'trabajo', reunión: 'trabajo',
    ocio: 'ocio', descanso: 'ocio', entretenimiento: 'ocio',
    deporte: 'deporte', ejercicio: 'deporte', gimnasio: 'deporte'
};
const SINONIMOS_ESTADO = {
    pendiente: 'pendiente', por_hacer: 'pendiente', todo: 'pendiente',
    en_proceso: 'en_proceso', 'en proceso': 'en_proceso', en_curso: 'en_proceso', en_progreso: 'en_proceso', 'en progreso': 'en_proceso',
    completado: 'completado', completada: 'completado', hecho: 'completado', terminado: 'completado', terminada: 'completado'
};
const textoMin = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');
const horaOpcional = (v) => (esHoraValida(v) ? v : null);

/**
 * Exigencia coherente con el tipo: estudio/trabajo en {1,2,3}; ocio/deporte -2 (recarga) salvo que el usuario
 * indique cansancio o un entrenamiento duro (nivel 2 o 3, calculado en interprete-lenguaje.js).
 */
export function exigenciaCoherente(tipo, exigencia, cansancio = 0) {
    const e = Number(exigencia);
    if (TIPOS_RECARGA.includes(tipo)) {
        if (cansancio >= 2) return e === 3 || cansancio >= 3 ? 3 : 2;
        return -2;
    }
    return [1, 2, 3].includes(e) ? e : 2;
}

/**
 * Convierte la salida del modelo en una actividad NUEVA que cumple validarActividad.
 * Solo para CREAR: aquí sí se usan valores por defecto razonables. `hoy` es obligatorio (fecha local del cliente).
 * `cansancio` (0/2/3) viene del texto del usuario, no del modelo.
 */
export function normalizarActividadIA(crudo, hoy, { cansancio = 0 } = {}) {
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo) || !esFechaValida(hoy)) return null;

    const titulo = limpiarTextoVisible(typeof crudo.titulo === 'string' ? crudo.titulo : '', 100);
    if (!titulo) return null;

    const tipo = SINONIMOS_TIPO[textoMin(crudo.tipo)] ?? 'estudio';
    const exigencia = exigenciaCoherente(tipo, crudo.exigencia, cansancio);

    const fecha_inicio = esFechaValida(crudo.fecha_inicio) ? crudo.fecha_inicio
        : esFechaValida(crudo.fecha) ? crudo.fecha : hoy;
    const fecha_fin = esFechaValida(crudo.fecha_fin) && crudo.fecha_fin >= fecha_inicio ? crudo.fecha_fin : fecha_inicio;

    const hora_inicio = horaOpcional(crudo.hora_inicio);
    let hora_fin = horaOpcional(crudo.hora_fin);
    if (hora_inicio && hora_fin && finAntesDeInicio(hora_inicio, hora_fin)) hora_fin = null;

    let horas = Number(crudo.horas);
    if (hora_inicio && hora_fin) horas = horasEntre(hora_inicio, hora_fin);
    else if (!Number.isFinite(horas) || horas <= 0) horas = 1;
    horas = Math.min(12, Math.max(0.5, redondearMedia(horas)));

    // Con hora de inicio y duración conocida se completa la hora de fin (si no pasa de medianoche)
    if (hora_inicio && !hora_fin) hora_fin = sumarMinutos(hora_inicio, horas * 60);

    const estado = SINONIMOS_ESTADO[textoMin(crudo.estado)] ?? 'pendiente';
    const proyecto = limpiarTextoVisible(typeof crudo.proyecto === 'string' ? crudo.proyecto : '', 60);

    const fecha_vencimiento = esFechaValida(crudo.fecha_vencimiento) && crudo.fecha_vencimiento >= fecha_inicio ? crudo.fecha_vencimiento : null;

    return { titulo, tipo, exigencia, horas, fecha: fecha_inicio, fecha_inicio, fecha_fin, hora_inicio, hora_fin, estado, proyecto, fija: false, fecha_vencimiento, fecha_asignacion: hoy };
}

const CAMPOS_PARCHE = ['titulo', 'tipo', 'exigencia', 'horas', 'fecha', 'fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin', 'estado', 'proyecto', 'fija', 'fecha_vencimiento'];

/**
 * EDICIÓN por IA con semántica de PARCHE: devuelve SOLO los campos que el modelo envió, normalizados y
 * coherentes con la actividad actual. Nunca rellena con valores por defecto, así "mueve el entrenamiento al
 * viernes" cambia las fechas y nada más. Reglas de coherencia (solo sobre campos relacionados con lo que cambió):
 *  - mover fecha_inicio sin fecha_fin desplaza el rango completo conservando su duración;
 *  - cambiar hora_inicio sin hora_fin desplaza la hora de fin conservando la duración;
 *  - si cambian ambas horas y no se envían `horas`, se recalculan.
 */
export function normalizarParcheIA(crudo, actual, { cansancio = 0, respetarExigencia = false } = {}) {
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo) || !actual) return {};
    const p = {};
    const viene = (k) => Object.prototype.hasOwnProperty.call(crudo, k) && crudo[k] !== undefined;

    if (viene('titulo')) { const t = limpiarTextoVisible(typeof crudo.titulo === 'string' ? crudo.titulo : '', 100); if (t) p.titulo = t; }
    if (viene('tipo')) { const t = SINONIMOS_TIPO[textoMin(crudo.tipo)]; if (t && t !== actual.tipo) p.tipo = t; }
    if (viene('exigencia') && EXIGENCIAS.includes(Number(crudo.exigencia))) p.exigencia = Number(crudo.exigencia);
    const tipoFinal = p.tipo ?? actual.tipo;
    if ((p.tipo || p.exigencia !== undefined) && !(respetarExigencia && p.exigencia !== undefined && tipoFinal !== undefined
        && (TIPOS_RECARGA.includes(tipoFinal) || [1, 2, 3].includes(p.exigencia)))) {
        const base = p.exigencia ?? actual.exigencia;
        const coherente = exigenciaCoherente(tipoFinal, base, cansancio);
        if (coherente !== Number(actual.exigencia) || p.exigencia !== undefined) p.exigencia = coherente;
    }
    if (viene('estado')) { const e = SINONIMOS_ESTADO[textoMin(crudo.estado)]; if (e) p.estado = e; }
    if (viene('proyecto') && typeof crudo.proyecto === 'string') p.proyecto = limpiarTextoVisible(crudo.proyecto, 60);
    if (viene('fija') && typeof crudo.fija === 'boolean') p.fija = crudo.fija;

    // Fechas
    const iniActual = actual.fecha_inicio || actual.fecha;
    const finActual = actual.fecha_fin && actual.fecha_fin >= iniActual ? actual.fecha_fin : iniActual;
    const iniNuevo = viene('fecha_inicio') && esFechaValida(crudo.fecha_inicio) ? crudo.fecha_inicio
        : viene('fecha') && esFechaValida(crudo.fecha) ? crudo.fecha : null;
    const finNuevo = viene('fecha_fin') && esFechaValida(crudo.fecha_fin) ? crudo.fecha_fin : null;
    if (iniNuevo && iniNuevo !== iniActual) {
        p.fecha_inicio = iniNuevo; p.fecha = iniNuevo;
        p.fecha_fin = finNuevo && finNuevo >= iniNuevo ? finNuevo : sumarDias(iniNuevo, diasEntre(iniActual, finActual));
    } else if (finNuevo && finNuevo !== finActual && finNuevo >= iniActual) {
        p.fecha_fin = finNuevo;
    }

    if (viene('fecha_vencimiento')) {
        const fv = crudo.fecha_vencimiento;
        if (fv === null || fv === '') { if (actual.fecha_vencimiento) p.fecha_vencimiento = null; }
        else if (esFechaValida(fv) && fv !== actual.fecha_vencimiento) p.fecha_vencimiento = fv;
    }

    // Horario: una hora válida, null/'' para quitarla, o undefined si no se envió (o no es válida)
    const horaEnviada = (k) => (!viene(k) ? undefined : esHoraValida(crudo[k]) ? crudo[k] : (crudo[k] === null || crudo[k] === '' ? null : undefined));
    const hiNuevo = horaEnviada('hora_inicio');
    const hfNuevo = horaEnviada('hora_fin');
    if (hiNuevo !== undefined && hiNuevo !== actual.hora_inicio) {
        p.hora_inicio = hiNuevo;
        if (hiNuevo === null) { if (hfNuevo === undefined) p.hora_fin = null; }
        else if (hfNuevo === undefined && actual.hora_inicio && actual.hora_fin) {
            p.hora_fin = sumarMinutos(hiNuevo, aMinutos(actual.hora_fin) - aMinutos(actual.hora_inicio));
        }
    }
    if (hfNuevo !== undefined && hfNuevo !== actual.hora_fin) p.hora_fin = hfNuevo;
    const hi = p.hora_inicio !== undefined ? p.hora_inicio : actual.hora_inicio;
    const hf = p.hora_fin !== undefined ? p.hora_fin : actual.hora_fin;
    if (hi && hf && finAntesDeInicio(hi, hf)) delete p.hora_fin;

    if (viene('horas')) {
        const h = Number(crudo.horas);
        if (Number.isFinite(h) && h >= 0.5 && h <= 12) { const r = redondearMedia(h); if (r !== Number(actual.horas)) p.horas = r; }
    } else if ((p.hora_inicio || p.hora_fin) && hi && hf && !finAntesDeInicio(hi, hf)) {
        const r = horasEntre(hi, hf);
        if (r !== Number(actual.horas)) p.horas = r;
    }

    for (const k of Object.keys(p)) if (!CAMPOS_PARCHE.includes(k)) delete p[k];
    return p;
}
