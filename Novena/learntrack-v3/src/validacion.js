// Validación y sanitización de entradas. Todo lo que llega del cliente pasa por aquí.

const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g; // control + caracteres bidi/invisibles
const ANGULARES = /[<>]/g;

// Normaliza, quita caracteres de control y espacios repetidos. No admite objetos ni arreglos.
export function limpiarTexto(valor, max) {
    if (typeof valor !== 'string') return '';
    return valor.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Texto libre que luego se muestra en pantalla: además se eliminan < y > (defensa en profundidad;
// el frontend ya usa textContent, que nunca interpreta HTML)
export function limpiarTextoVisible(valor, max) {
    return limpiarTexto(valor, max).replace(ANGULARES, '').trim();
}

export const TIPOS = ['estudio', 'trabajo', 'ocio', 'deporte'];
export const EXIGENCIAS = [3, 2, 1, -2];
export const ANIMOS = ['alto', 'medio', 'bajo'];

const REGEX_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const REGEX_EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const REGEX_NOMBRE = /^[\p{L}\p{M}0-9 .'’-]{2,60}$/u;

// Fecha real del calendario (rechaza 2026-13-45 o 2026-02-31)
export function esFechaValida(valor) {
    if (typeof valor !== 'string') return false;
    const m = REGEX_FECHA.exec(valor);
    if (!m) return false;
    const [, a, mes, d] = m.map(Number);
    const fecha = new Date(Date.UTC(a, mes - 1, d));
    return fecha.getUTCFullYear() === a && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === d;
}

export function normalizarEmail(valor) {
    return limpiarTexto(valor, 254).toLowerCase();
}

export function validarRegistro(body) {
    const nombre = limpiarTexto(body?.nombre, 60);
    const email = normalizarEmail(body?.email);
    const password = body?.password;

    if (!REGEX_NOMBRE.test(nombre)) {
        return { error: 'El nombre debe tener entre 2 y 60 caracteres (letras, números, espacios, punto, apóstrofo o guion).' };
    }
    if (!REGEX_EMAIL.test(email) || email.length > 254) {
        return { error: 'Escribe un correo electrónico válido.' };
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return { error: 'La contraseña debe tener entre 8 y 128 caracteres.' };
    }
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
        return { error: 'La contraseña debe incluir al menos una letra y un número.' };
    }
    return { valor: { nombre, email, password } };
}

export function validarLogin(body) {
    const email = normalizarEmail(body?.email);
    const password = body?.password;
    if (!REGEX_EMAIL.test(email) || typeof password !== 'string' || password.length === 0 || password.length > 128) {
        return { error: 'Correo o contraseña no válidos.' };
    }
    return { valor: { email, password } };
}

export const ESTADOS = ['pendiente', 'en_proceso', 'completado'];
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const esHoraValida = (v) => typeof v === 'string' && REGEX_HORA.test(v);
const aMinutos = (h) => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };

// Horas entre dos HH:MM, redondeadas al múltiplo de 0.5 más cercano y dentro de [0.5, 12]
export function horasEntre(inicio, fin) {
    const horas = (aMinutos(fin) - aMinutos(inicio)) / 60;
    return Math.min(12, Math.max(0.5, Math.round(horas * 2) / 2));
}

const tiene = (body, clave) => body && Object.prototype.hasOwnProperty.call(body, clave)
    && body[clave] !== undefined && body[clave] !== null && body[clave] !== '';

/**
 * Valida una actividad.
 *  - completa = true  (POST): exige los campos base y rellena valores por defecto de los campos nuevos.
 *  - completa = false (PUT) : acepta cambios parciales; solo se devuelven (y se validan) los campos enviados,
 *    así un PUT del dashboard antiguo no borra estado, horario ni proyecto.
 * Campos: titulo, tipo, exigencia, horas, fecha (= fecha_inicio, alias retrocompatible), fecha_inicio, fecha_fin,
 *         hora_inicio, hora_fin, estado, proyecto.
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

    // ---- Fechas (fecha es alias de fecha_inicio) ----
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
        if (body && Object.prototype.hasOwnProperty.call(body, clave)) {
            if (!tiene(body, clave)) v[clave] = null;                 // vacío = sin hora (también permite borrar)
            else if (!esHoraValida(body[clave])) return { error: 'La hora debe tener formato HH:MM (24 h).' };
            else v[clave] = body[clave];
        } else if (completa) v[clave] = null;
    }
    if (v.hora_inicio && v.hora_fin && aMinutos(v.hora_fin) <= aMinutos(v.hora_inicio)) {
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

    // ---- Estado y proyecto ----
    if (tiene(body, 'estado')) {
        if (!ESTADOS.includes(body.estado)) return { error: 'Estado no válido.' };
        v.estado = body.estado;
    } else if (completa) v.estado = 'pendiente';

    if (body && Object.prototype.hasOwnProperty.call(body, 'proyecto')) v.proyecto = limpiarTextoVisible(body.proyecto, 60);
    else if (completa) v.proyecto = '';

    // ---- Fija (opcional): el planificador no la mueve ----
    if (body && Object.prototype.hasOwnProperty.call(body, 'fija')) {
        if (typeof body.fija !== 'boolean') return { error: 'El campo "fija" debe ser verdadero o falso.' };
        v.fija = body.fija;
    } else if (completa) v.fija = false;

    return { valor: v };
}

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

// Exigencia coherente con el tipo (sección 4): estudio/trabajo en {1,2,3}; ocio/deporte -2 (recarga) salvo que
// el usuario indique cansancio o un entrenamiento duro (nivel 2 o 3, calculado en interpretar.js).
export function exigenciaCoherente(tipo, exigencia, cansancio = 0) {
    const e = Number(exigencia);
    if (tipo === 'ocio' || tipo === 'deporte') {
        if (cansancio >= 2) return e === 3 || cansancio >= 3 ? 3 : 2;
        return -2;
    }
    return [1, 2, 3].includes(e) ? e : 2;
}

const textoMin = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');

/**
 * Convierte la salida (no confiable) del modelo en una actividad NUEVA que cumple validarActividad.
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

    let hora_inicio = esHoraValida(crudo.hora_inicio) ? crudo.hora_inicio : null;
    let hora_fin = esHoraValida(crudo.hora_fin) ? crudo.hora_fin : null;
    if (hora_inicio && hora_fin && aMinutos(hora_fin) <= aMinutos(hora_inicio)) hora_fin = null;

    let horas = Number(crudo.horas);
    if (hora_inicio && hora_fin) horas = horasEntre(hora_inicio, hora_fin);
    else if (!Number.isFinite(horas) || horas <= 0) horas = 1;
    horas = Math.min(12, Math.max(0.5, Math.round(horas * 2) / 2));

    // Con hora de inicio y duración conocida se completa la hora de fin (si no pasa de medianoche)
    if (hora_inicio && !hora_fin) {
        const fin = aMinutos(hora_inicio) + Math.round(horas * 60);
        if (fin < 24 * 60) hora_fin = `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
    }

    const estado = SINONIMOS_ESTADO[textoMin(crudo.estado)] ?? 'pendiente';
    const proyecto = limpiarTextoVisible(typeof crudo.proyecto === 'string' ? crudo.proyecto : '', 60);

    return { titulo, tipo, exigencia, horas, fecha: fecha_inicio, fecha_inicio, fecha_fin, hora_inicio, hora_fin, estado, proyecto, fija: false };
}

const CAMPOS_PARCHE = ['titulo', 'tipo', 'exigencia', 'horas', 'fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin', 'estado', 'proyecto', 'fija'];

/**
 * EDICIÓN por IA con semántica de PARCHE (defecto 2-a): devuelve SOLO los campos que el modelo envió,
 * normalizados y coherentes con la actividad actual. Nunca rellena con valores por defecto, así
 * "mueve el entrenamiento al viernes" cambia las fechas y nada más.
 * Reglas de coherencia (solo sobre campos relacionados con lo que cambió):
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
    if ((p.tipo || p.exigencia !== undefined) && !(respetarExigencia && p.exigencia !== undefined && (p.tipo ?? actual.tipo) !== undefined
        && (['ocio', 'deporte'].includes(tipoFinal) || [1, 2, 3].includes(p.exigencia)))) {
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
        if (finNuevo && finNuevo >= iniNuevo) p.fecha_fin = finNuevo;
        else p.fecha_fin = sumarDiasISO(iniNuevo, diasEntreISO(iniActual, finActual));
    } else if (finNuevo && finNuevo !== finActual && finNuevo >= iniActual) {
        p.fecha_fin = finNuevo;
    }

    // Horario
    const hiNuevo = viene('hora_inicio') ? (esHoraValida(crudo.hora_inicio) ? crudo.hora_inicio : (crudo.hora_inicio === null || crudo.hora_inicio === '' ? null : undefined)) : undefined;
    const hfNuevo = viene('hora_fin') ? (esHoraValida(crudo.hora_fin) ? crudo.hora_fin : (crudo.hora_fin === null || crudo.hora_fin === '' ? null : undefined)) : undefined;
    if (hiNuevo !== undefined && hiNuevo !== actual.hora_inicio) {
        p.hora_inicio = hiNuevo;
        if (hiNuevo === null) { if (hfNuevo === undefined) p.hora_fin = null; }
        else if (hfNuevo === undefined && actual.hora_inicio && actual.hora_fin) {
            const dur = aMinutos(actual.hora_fin) - aMinutos(actual.hora_inicio);
            const fin = aMinutos(hiNuevo) + dur;
            p.hora_fin = fin < 24 * 60 ? `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}` : null;
        }
    }
    if (hfNuevo !== undefined && hfNuevo !== actual.hora_fin) p.hora_fin = hfNuevo;
    const hi = p.hora_inicio !== undefined ? p.hora_inicio : actual.hora_inicio;
    const hf = p.hora_fin !== undefined ? p.hora_fin : actual.hora_fin;
    if (hi && hf && aMinutos(hf) <= aMinutos(hi)) { delete p.hora_fin; }

    if (viene('horas')) {
        const h = Number(crudo.horas);
        if (Number.isFinite(h) && h >= 0.5 && h <= 12) { const r = Math.round(h * 2) / 2; if (r !== Number(actual.horas)) p.horas = r; }
    } else if ((p.hora_inicio || p.hora_fin) && hi && hf && aMinutos(hf) > aMinutos(hi)) {
        const r = horasEntre(hi, hf);
        if (r !== Number(actual.horas)) p.horas = r;
    }

    for (const k of Object.keys(p)) if (!CAMPOS_PARCHE.includes(k) && k !== 'fecha') delete p[k];
    return p;
}

function sumarDiasISO(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
function diasEntreISO(a, b) {
    const ms = (iso) => { const [x, y, z] = iso.split('-').map(Number); return Date.UTC(x, y - 1, z); };
    return Math.round((ms(b) - ms(a)) / 86400000);
}

const RE_ID_ACTIVIDAD = /^[A-Za-z0-9_-]{1,64}$/;
const RE_ID_ALEATORIO = /^[a-f0-9]{32}$/;
const RE_ID_LOTE = /^[a-f0-9]{24}$/;
export const esIdActividad = (v) => typeof v === 'string' && RE_ID_ACTIVIDAD.test(v);
export const esIdPropuesta = (v) => typeof v === 'string' && RE_ID_ALEATORIO.test(v);
export const esIdLote = (v) => typeof v === 'string' && RE_ID_LOTE.test(v);

/** Fecha local del cliente: OBLIGATORIA (el servidor ya no cae a la fecha UTC; en Bogotá a las 8 p. m. sería mañana) */
export function validarFechaHoy(body) {
    return esFechaValida(body?.fechaHoy) ? body.fechaHoy : null;
}
/** Desfase horario del navegador (Date#getTimezoneOffset, minutos). Opcional; por defecto 0. */
export function validarTzOffset(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= -840 && n <= 840 ? n : 0;
}

/**
 * Entrada de POST /api/ia/chat. El cliente envía los últimos 6 turnos; aquí se validan y recortan.
 */
export function validarEntradaChat(body) {
    const fechaHoy = validarFechaHoy(body);
    if (!fechaHoy) return { error: 'Falta la fecha local (fechaHoy, YYYY-MM-DD).' };
    const texto = limpiarTextoVisible(body?.texto, 500);
    const aclaracionId = esIdPropuesta(body?.aclaracionId) ? body.aclaracionId : null;
    const respuestas = {};
    if (aclaracionId && body?.respuestas && typeof body.respuestas === 'object' && !Array.isArray(body.respuestas)) {
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
            texto, fechaHoy, tzOffset: validarTzOffset(body?.tzOffset), historial,
            propuestaPendiente: esIdPropuesta(body?.propuestaPendiente) ? body.propuestaPendiente : null,
            aclaracionId, respuestas
        }
    };
}

export const SUENOS = ['bien', 'regular', 'mal'];
export const ENFOQUES = ['avanzar', 'mantener', 'descansar'];
export function validarCheckin(body) {
    if (!esFechaValida(body?.fecha)) return { error: 'Fecha del check-in no válida.' };
    if (!ANIMOS.includes(body?.animo) || !SUENOS.includes(body?.sueno) || !ENFOQUES.includes(body?.enfoque)) {
        return { error: 'Responde las tres preguntas del check-in.' };
    }
    return { valor: { fecha: body.fecha, animo: body.animo, sueno: body.sueno, enfoque: body.enfoque } };
}

// El porcentaje ya no lo manda el cliente: el servidor lo calcula con la regla única (compartido/carga.js).
// El historial solo se guarda para días <= hoy (fecha local del cliente).
export function validarHistorial(body) {
    const fechaHoy = validarFechaHoy(body);
    if (!esFechaValida(body?.fecha) || !fechaHoy) return { error: 'Datos de historial no válidos.' };
    if (body.fecha > fechaHoy) return { error: 'Solo se guarda el historial de hoy o de días pasados.' };
    return { valor: { fecha: body.fecha, fechaHoy } };
}

export function validarContacto(body) {
    const nombre = limpiarTextoVisible(body?.nombre, 80);
    const email = normalizarEmail(body?.correo);
    const mensaje = limpiarTextoVisible(body?.mensaje, 1000);
    if (nombre.length < 2 || !REGEX_EMAIL.test(email) || mensaje.length < 5) {
        return { error: 'Completa nombre, un correo válido y un mensaje de al menos 5 caracteres.' };
    }
    return { valor: { nombre, email, mensaje } };
}

export function validarConsultaIA(body) {
    const porcentaje = Number(body?.porcentajeCarga);
    if (!ANIMOS.includes(body?.estadoAnimo) || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 1000) {
        return { error: 'Datos de entrada no válidos.' };
    }
    const actividades = Array.isArray(body?.actividades)
        ? body.actividades.slice(0, 20).map(a => limpiarTextoVisible(a, 150)).filter(Boolean)
        : [];
    return { valor: { estadoAnimo: body.estadoAnimo, porcentajeCarga: Math.round(porcentaje), actividades } };
}
