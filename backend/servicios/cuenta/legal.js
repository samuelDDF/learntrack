// Aceptación de los documentos legales (v3.13). Las versiones y los textos viven en compartido/legal.js (los mismos
// que ve la persona). Aquí: la HUELLA de cada documento (SHA-256 del texto exacto) y qué falta por aceptar.
import crypto from 'crypto';
import { DOCUMENTOS_LEGALES, VERSIONES_VIGENTES, edadEn, EDAD_MINIMA, MAYORIA_EDAD } from '../../../compartido/legal.js';

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const HUELLAS = Object.fromEntries(Object.entries(DOCUMENTOS_LEGALES).map(([clave, doc]) => [clave, sha256(JSON.stringify(doc))]));

export const huellaDe = (documento) => HUELLAS[documento];
export { VERSIONES_VIGENTES, EDAD_MINIMA, MAYORIA_EDAD, edadEn };

/** Registros de aceptación de la versión VIGENTE de ambos documentos (lo que se guarda en el usuario) */
export function aceptacionesVigentes(via, ahora = new Date()) {
    return Object.keys(VERSIONES_VIGENTES).map((documento) => ({
        documento, version: VERSIONES_VIGENTES[documento], huella: HUELLAS[documento], aceptadoEn: ahora, via
    }));
}

/**
 * Documentos cuya versión vigente esta cuenta aún no ha aceptado (p. ej. cuentas anteriores a la v3.13, o tras
 * publicar una versión nueva). La cuenta de administración no usa la app como usuaria: nunca tiene pendientes.
 */
export function documentosPendientes(usuario) {
    if (!usuario || usuario.rol === 'admin') return [];
    const aceptadas = usuario.aceptacionesLegales ?? [];
    return Object.entries(VERSIONES_VIGENTES)
        .filter(([documento, version]) => !aceptadas.some((a) => a.documento === documento && a.version === version))
        .map(([documento]) => documento);
}

/** ¿Es menor (14–17) y su representante aún no autorizó? Al cumplir 18 años deja de hacer falta. */
export function esperaRepresentante(usuario, hoy) {
    const r = usuario?.representanteLegal;
    if (!r || r.estado === 'autorizado' || !usuario.fechaNacimiento) return false;
    return edadEn(usuario.fechaNacimiento, hoy) < MAYORIA_EDAD;
}
