// Servicio HTTP ÚNICO del frontend React. Mismo contrato HTTP que utilizaba la interfaz anterior: devuelve { ok, status, data } y lanza solo si no hay conexión.
//  · Cabecera X-Zona-Horaria (zona IANA del navegador): el servidor la usa para «hoy», el auto-estado y el chat.
//  · Cuerpo JSON, FormData (archivos) o Blob (foto de perfil, con su Content-Type).
//  · La cookie de sesión es HttpOnly; las llamadas al API remoto usan credentials: include y nunca leen el token desde JS.
//  · 401 en la zona privada → emite «sesión caducada»; AuthContext lo escucha y la SPA lleva a /login SIN recargar.
//  · Tiempo máximo de espera configurable (el asistente puede tardar: el servidor espera a Ollama).
//  · Los errores se describen en services/errores.js (un único sitio para los mensajes que ve la persona).
import { zonaHoraria } from '../utils/fechas.js';
import { ErrorConexion } from './errores.js';

const ESPERA_POR_DEFECTO = 20000;
const API_BASE = String(import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
export const urlApi = (ruta) => `${API_BASE}${ruta}`;

/** Evento de window que se emite cuando el servidor responde 401 a una petición de la zona privada */
export const EVENTO_SESION_CADUCADA = 'learntrack:sesion-caducada';
/**
 * v3.13: el servidor pide algo antes de seguir (aceptar una versión nueva de los documentos legales, la autorización
 * del representante de un menor) o la cuenta es solo de administración. AuthContext vuelve a pedir /api/auth/me y
 * RutaPrivada muestra la pantalla que corresponde.
 */
export const EVENTO_CUENTA_PENDIENTE = 'learntrack:cuenta-pendiente';
const CODIGOS_PENDIENTE = ['aceptacion_pendiente', 'autorizacion_representante', 'solo_admin'];

/**
 * @param {string} url             ruta de la API (siempre del mismo origen: /api/…)
 * @param {*} [cuerpo]             objeto (JSON), FormData o Blob; undefined = sin cuerpo
 * @param {string} [metodo]        por defecto GET sin cuerpo y POST con cuerpo
 * @param {object} [opciones]
 * @param {boolean} [opciones.redirigir401=true]  false en la zona pública (login con clave errónea también es 401): no avisa de sesión caducada
 * @param {number} [opciones.espera]              milisegundos antes de abandonar (por defecto 20 s)
 * @param {AbortSignal} [opciones.signal]
 * @param {Record<string,string>} [opciones.cabeceras]
 */
export async function api(url, cuerpo, metodo = cuerpo === undefined ? 'GET' : 'POST', opciones = {}) {
    const { redirigir401 = true, espera = ESPERA_POR_DEFECTO, signal, cabeceras = {} } = opciones;
    if (typeof url !== 'string' || !url.startsWith('/api/')) throw new TypeError('La API solo admite rutas propias (/api/…).');
    const init = { method: metodo, headers: { ...cabeceras }, credentials: API_BASE ? 'include' : 'same-origin' };
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
        res = await fetch(urlApi(url), init);
    } catch (e) {
        if (signal?.aborted) throw e;
        throw new ErrorConexion(agotado ? 'El servidor tardó demasiado en responder.' : 'No se pudo conectar con el servidor.', { tiempoAgotado: agotado });
    } finally {
        if (temporizador) clearTimeout(temporizador);
        signal?.removeEventListener('abort', alAbortar);
    }
    if (res.status === 401 && redirigir401) {
        window.dispatchEvent(new CustomEvent(EVENTO_SESION_CADUCADA));
        throw new ErrorConexion('Tu sesión terminó. Vuelve a iniciar sesión.');
    }
    const data = await res.json().catch(() => ({}));
    if ((res.status === 428 || res.status === 403) && CODIGOS_PENDIENTE.includes(data?.codigo)) {
        window.dispatchEvent(new CustomEvent(EVENTO_CUENTA_PENDIENTE));
    }
    return { ok: res.ok, status: res.status, data };
}

/** Atajos con el método explícito */
export const apiGet = (url, op) => api(url, undefined, 'GET', op);
export const apiPost = (url, cuerpo = {}, op) => api(url, cuerpo, 'POST', op);
export const apiPut = (url, cuerpo, op) => api(url, cuerpo, 'PUT', op);
export const apiDelete = (url, cuerpo, op) => api(url, cuerpo, 'DELETE', op);


/** Descarga una imagen privada usando la cookie HttpOnly y devuelve una URL blob revocable. */
export async function cargarImagenPrivada(ruta) {
    if (typeof ruta !== 'string' || !ruta.startsWith('/api/')) throw new TypeError('La imagen debe pertenecer a /api/…');
    const res = await fetch(urlApi(ruta), { credentials: API_BASE ? 'include' : 'same-origin' });
    if (!res.ok) throw new Error('No se pudo cargar la imagen privada.');
    return URL.createObjectURL(await res.blob());
}

/** Codifica un identificador para usarlo en la ruta */
export const id = (valor) => encodeURIComponent(String(valor));
