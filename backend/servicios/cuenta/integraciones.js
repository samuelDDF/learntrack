// Cuentas vinculadas (YouTube, GitHub, Discord, Spotify, Steam y Xbox).
import { ErrorConEstado } from '../../errores.js';

export const NOMBRES_SERVICIO = { youtube: 'YouTube', github: 'GitHub', discord: 'Discord', spotify: 'Spotify', steam: 'Steam', xbox: 'Xbox' };

export class ErrorIntegracion extends ErrorConEstado {}

/**
 * Modo de las integraciones (variable INTEGRACIONES_MODO):
 *  - "simulado":    solo marca la cuenta como vinculada, SIN hablar con el servicio externo. Es el valor por defecto
 *                   fuera de producción, para poder probar la interfaz. La pantalla lo avisa.
 *  - "desactivado": rechaza vincular (501). Es el valor por defecto en producción hasta que implementes OAuth.
 */
export function modoIntegraciones() {
    const m = String(process.env.INTEGRACIONES_MODO ?? '').toLowerCase();
    if (m === 'simulado' || m === 'desactivado') return m;
    return process.env.NODE_ENV === 'production' ? 'desactivado' : 'simulado';
}

/**
 * PUNTO DE ENGANCHE para OAuth real. Hoy solo existe el modo simulado.
 * Para conectar un servicio de verdad: (1) registra la app en el panel de desarrolladores del servicio,
 * (2) aquí devuelve { tipo: 'oauth', url } con la URL de autorización (con `state` aleatorio guardado en la sesión),
 * (3) añade una ruta de callback que cambie el código por tokens, los CIFRE y los guarde, y llame a fijarCuentaVinculadaBD.
 */
export async function iniciarVinculacion(servicio) {
    if (!(servicio in NOMBRES_SERVICIO)) throw new ErrorIntegracion('Servicio no válido.', 400);
    if (modoIntegraciones() === 'simulado') return { tipo: 'simulada', cuentaExterna: '' };
    throw new ErrorIntegracion(`La vinculación con ${NOMBRES_SERVICIO[servicio]} aún no está configurada en este servidor.`, 501);
}
