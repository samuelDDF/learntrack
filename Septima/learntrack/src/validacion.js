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

export function validarActividad(body) {
    const titulo = limpiarTextoVisible(body?.titulo, 100);
    const horas = Number(body?.horas);
    const exigencia = Number(body?.exigencia);
    const tipo = body?.tipo;
    const fecha = body?.fecha;

    if (titulo.length === 0) return { error: 'El título es obligatorio (máx. 100 caracteres).' };
    if (!TIPOS.includes(tipo)) return { error: 'Tipo de actividad no válido.' };
    if (!EXIGENCIAS.includes(exigencia)) return { error: 'Nivel de exigencia no válido.' };
    if (!Number.isFinite(horas) || horas < 0.5 || horas > 12) return { error: 'Las horas deben estar entre 0.5 y 12.' };
    if (!esFechaValida(fecha)) return { error: 'Fecha no válida.' };

    return { valor: { titulo, tipo, exigencia, horas, fecha } };
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
