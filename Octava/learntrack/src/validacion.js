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

/**
 * Convierte la salida (no confiable) del modelo en un objeto que cumple validarActividad.
 * Un modelo pequeño se equivoca a menudo: aquí se corrigen tipos, se descartan valores inválidos y se usan
 * valores por defecto razonables, en lugar de rechazar toda la actividad.
 */
export function normalizarActividadIA(crudo, fechaHoy) {
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return null;
    const hoy = esFechaValida(fechaHoy) ? fechaHoy : new Date().toISOString().slice(0, 10);
    const texto = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');

    const titulo = limpiarTextoVisible(typeof crudo.titulo === 'string' ? crudo.titulo : '', 100);
    if (!titulo) return null;

    const tipo = SINONIMOS_TIPO[texto(crudo.tipo)] ?? 'estudio';

    let exigencia = Number(crudo.exigencia);
    if (!EXIGENCIAS.includes(exigencia)) exigencia = (tipo === 'ocio' || tipo === 'deporte') ? -2 : 2;

    const fecha_inicio = esFechaValida(crudo.fecha_inicio) ? crudo.fecha_inicio
        : esFechaValida(crudo.fecha) ? crudo.fecha : hoy;
    const fecha_fin = esFechaValida(crudo.fecha_fin) && crudo.fecha_fin >= fecha_inicio ? crudo.fecha_fin : fecha_inicio;

    let hora_inicio = esHoraValida(crudo.hora_inicio) ? crudo.hora_inicio : null;
    let hora_fin = esHoraValida(crudo.hora_fin) ? crudo.hora_fin : null;
    if (hora_inicio && hora_fin && aMinutos(hora_fin) <= aMinutos(hora_inicio)) hora_fin = null;

    let horas = Number(crudo.horas);
    if (hora_inicio && hora_fin) horas = horasEntre(hora_inicio, hora_fin);
    else if (!Number.isFinite(horas) || horas <= 0) horas = 1;
    horas = Math.min(12, Math.max(0.5, horas));

    // Con hora de inicio y duración conocida se completa la hora de fin (si no pasa de medianoche)
    if (hora_inicio && !hora_fin) {
        const fin = aMinutos(hora_inicio) + Math.round(horas * 60);
        if (fin < 24 * 60) hora_fin = `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
    }

    const estado = SINONIMOS_ESTADO[texto(crudo.estado)] ?? 'pendiente';
    const proyecto = limpiarTextoVisible(typeof crudo.proyecto === 'string' ? crudo.proyecto : '', 60);

    return { titulo, tipo, exigencia, horas, fecha: fecha_inicio, fecha_inicio, fecha_fin, hora_inicio, hora_fin, estado, proyecto };
}

export function validarTextoChat(body) {
    const texto = limpiarTextoVisible(body?.texto, 500);
    if (texto.length < 3) return { error: 'Escribe una frase con la actividad (mínimo 3 caracteres).' };
    const fechaHoy = esFechaValida(body?.fechaHoy) ? body.fechaHoy : null;
    return { valor: { texto, fechaHoy } };
}

export function validarHistorial(body) {
    const porcentaje = Number(body?.porcentaje);
    if (!esFechaValida(body?.fecha) || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 1000) {
        return { error: 'Datos de historial no válidos.' };
    }
    return { valor: { fecha: body.fecha, porcentaje: Math.round(porcentaje) } };
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
