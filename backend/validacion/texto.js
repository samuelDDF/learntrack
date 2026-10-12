// Reglas básicas de limpieza y formato que reutilizan los demás validadores.
import { esISO, esHora } from '../../compartido/fechas.js';

const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g; // control + bidi/invisibles
const ANGULARES = /[<>]/g;
const REGEX_EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const REGEX_NOMBRE = /^[\p{L}\p{M}0-9 .'’-]{2,60}$/u;

/** Normaliza, quita caracteres de control y espacios repetidos. No admite objetos ni arreglos. */
export function limpiarTexto(valor, max) {
    if (typeof valor !== 'string') return '';
    return valor.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Texto libre que luego se muestra en pantalla: además se eliminan < y > (defensa en profundidad) */
export function limpiarTextoVisible(valor, max) {
    return limpiarTexto(valor, max).replace(ANGULARES, '').trim();
}

export const normalizarEmail = (valor) => limpiarTexto(valor, 254).toLowerCase();
export const esEmail = (email) => REGEX_EMAIL.test(email) && email.length <= 254;
export const esNombre = (nombre) => REGEX_NOMBRE.test(nombre);
export const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** ¿Trae el cuerpo la clave con un valor no vacío? */
export const tiene = (body, clave) => body && Object.prototype.hasOwnProperty.call(body, clave)
    && body[clave] !== undefined && body[clave] !== null && body[clave] !== '';

export const MENSAJE_NOMBRE = 'El nombre debe tener entre 2 y 60 caracteres (letras, números, espacios, punto, apóstrofo o guion).';
export const MENSAJE_EMAIL = 'Escribe un correo electrónico válido.';

/** Reglas de contraseña (registro y cambio de contraseña): devuelve el mensaje de error o null */
export function errorPassword(password, sujeto = 'La contraseña') {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) return `${sujeto} debe tener entre 8 y 128 caracteres.`;
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) return `${sujeto} debe incluir al menos una letra y un número.`;
    return null;
}
/** Contraseña escrita para confirmar algo (no se comprueba su fuerza, solo que exista) */
export const esPasswordEscrita = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;

/** Fecha real del calendario (rechaza 2026-13-45 o 2026-02-31) y hora HH:MM de 24 h */
export const esFechaValida = esISO;
export const esHoraValida = esHora;
