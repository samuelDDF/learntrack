// Peticiones a APIs públicas externas (Nager.Date, Colormind) con tiempo límite y tamaño máximo.
// Su respuesta es ENTRADA NO CONFIABLE: quien llama la valida antes de usarla.
import { ErrorConEstado } from '../../errores.js';

export class ErrorServicioExterno extends ErrorConEstado {
    constructor(servicio, detalle = '') { super(`${servicio} no está disponible ahora mismo. Inténtalo más tarde.`, 503); this.detalle = detalle; }
}

const MAX_BYTES = 512 * 1024;

/** GET/POST que devuelve JSON. Lanza ErrorServicioExterno si no responde a tiempo, falla o devuelve algo raro. */
export async function pedirJSON(servicio, url, { method = 'GET', body = undefined, ms = 8000 } = {}) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), ms);
    try {
        const res = await fetch(url, {
            method, signal: control.signal, redirect: 'error',
            headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        if (res.status === 204 || res.status === 404) return null;            // Nager: país sin datos
        if (!res.ok) throw new ErrorServicioExterno(servicio, `HTTP ${res.status}`);
        const texto = await res.text();
        if (texto.length > MAX_BYTES) throw new ErrorServicioExterno(servicio, 'respuesta demasiado grande');
        return JSON.parse(texto);
    } catch (e) {
        if (e instanceof ErrorServicioExterno) throw e;
        throw new ErrorServicioExterno(servicio, e.name === 'AbortError' ? 'tiempo agotado' : e.message);
    } finally {
        clearTimeout(temporizador);
    }
}
