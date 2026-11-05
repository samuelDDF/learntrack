// Servicio HTTP ÚNICO del frontend React. Mismo contrato que api() del frontend clásico
// (frontend/privado/comun/utilidades.js): devuelve { ok, status, data } y lanza solo si no hay conexión.
//  · Cabecera X-Zona-Horaria (zona IANA del navegador): el servidor la usa para «hoy», el auto-estado y el chat.
//  · Cuerpo JSON, FormData (archivos) o Blob (foto de perfil, con su Content-Type).
//  · La cookie de sesión es HttpOnly y SameSite=Strict: viaja sola (mismo origen); JavaScript no la ve.
//  · 401 en la zona privada → al inicio con el acceso abierto (como el frontend clásico).
//  · Tiempo máximo de espera configurable (el asistente puede tardar: el servidor espera a Ollama).
import { zonaHoraria } from '../comun/fechas-locales.js';

export const RUTA_ACCESO = '/?acceso=login';
const ESPERA_POR_DEFECTO = 20000;

export class ErrorConexion extends Error {
    constructor(mensaje, { tiempoAgotado = false } = {}) {
        super(mensaje);
        this.name = 'ErrorConexion';
        this.tiempoAgotado = tiempoAgotado;
    }
}

/** Redirección al acceso (se puede sustituir en las pruebas) */
export const navegador = {
    irA: (url) => window.location.assign(url)
};

/**
 * @param {string} url             ruta de la API (siempre del mismo origen: /api/…)
 * @param {*} [cuerpo]             objeto (JSON), FormData o Blob; undefined = sin cuerpo
 * @param {string} [metodo]        por defecto GET sin cuerpo y POST con cuerpo
 * @param {object} [opciones]
 * @param {boolean} [opciones.redirigir401=true]  false en la zona pública (login con clave errónea también es 401)
 * @param {number} [opciones.espera]              milisegundos antes de abandonar (por defecto 20 s)
 * @param {AbortSignal} [opciones.signal]
 * @param {Record<string,string>} [opciones.cabeceras]
 */
export async function api(url, cuerpo, metodo = cuerpo === undefined ? 'GET' : 'POST', opciones = {}) {
    const { redirigir401 = true, espera = ESPERA_POR_DEFECTO, signal, cabeceras = {} } = opciones;
    if (typeof url !== 'string' || !url.startsWith('/api/')) throw new TypeError('La API solo admite rutas propias (/api/…).');
    const init = { method: metodo, headers: { ...cabeceras }, credentials: 'same-origin' };
    const zona = zonaHoraria();
    if (zona) init.headers['X-Zona-Horaria'] = zona;
    if (cuerpo instanceof FormData) init.body = cuerpo;
    else if (typeof Blob !== 'undefined' && cuerpo instanceof Blob) {
        init.body = cuerpo;
        init.headers['Content-Type'] ??= cuerpo.type || 'application/octet-stream';
    } else if (cuerpo !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(cuerpo);
    }

    const control = new AbortController();
    let agotado = false;
    const temporizador = espera > 0 ? setTimeout(() => { agotado = true; control.abort(); }, espera) : null;
    const alAbortar = () => control.abort();
    signal?.addEventListener('abort', alAbortar, { once: true });
    init.signal = control.signal;

    let res;
    try {
        res = await fetch(url, init);
    } catch (e) {
        if (signal?.aborted) throw e;
        throw new ErrorConexion(agotado ? 'El servidor tardó demasiado en responder.' : 'No se pudo conectar con el servidor.', { tiempoAgotado: agotado });
    } finally {
        if (temporizador) clearTimeout(temporizador);
        signal?.removeEventListener('abort', alAbortar);
    }
    if (res.status === 401 && redirigir401) {
        navegador.irA(RUTA_ACCESO);
        throw new ErrorConexion('Tu sesión terminó. Vuelve a iniciar sesión.');
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

/** Mensaje de error legible para la persona a partir de una respuesta o una excepción */
export function mensajeDeError(resultadoOError, porDefecto = 'No se pudo completar la acción.') {
    if (resultadoOError instanceof ErrorConexion) return resultadoOError.message;
    if (resultadoOError instanceof Error) return 'No se pudo conectar con el servidor.';
    return resultadoOError?.data?.error || porDefecto;
}

/** Atajos con el método explícito */
export const apiGet = (url, op) => api(url, undefined, 'GET', op);
export const apiPost = (url, cuerpo = {}, op) => api(url, cuerpo, 'POST', op);
export const apiPut = (url, cuerpo, op) => api(url, cuerpo, 'PUT', op);
export const apiDelete = (url, cuerpo, op) => api(url, cuerpo, 'DELETE', op);

/** Codifica un identificador para usarlo en la ruta */
export const id = (valor) => encodeURIComponent(String(valor));
