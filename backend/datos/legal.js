// Aceptación de documentos legales y autorización del representante legal (v3.13). Solo escrituras puntuales y
// atómicas sobre el propio usuario; la lógica (versiones, huellas, edades) está en servicios/cuenta/legal.js.
import Usuario from '../modelos/Usuario.js';
import { esTexto, confiable } from './utilidades.js';

/** Añade registros de aceptación (nueva versión aceptada por la persona) */
export async function registrarAceptacionesBD(id, aceptaciones) {
    if (!esTexto(id, 64)) return false;
    const r = await Usuario.updateOne({ id, rol: 'usuario' }, { $push: { aceptacionesLegales: { $each: aceptaciones } } });
    return r.matchedCount === 1;
}

/** Guarda un envío del enlace al representante (solo si sigue pendiente) */
export async function guardarEnvioRepresentanteBD(id, { tokenHash, tokenExpira, ahora = new Date() }) {
    const r = await Usuario.updateOne({ id, 'representanteLegal.estado': 'pendiente' }, {
        $set: { 'representanteLegal.tokenHash': tokenHash, 'representanteLegal.tokenExpira': tokenExpira, 'representanteLegal.ultimoEnvio': ahora },
        $inc: { 'representanteLegal.envios': 1 }
    });
    return r.matchedCount === 1;
}

/** El envío falló: el enlace no llegó a nadie, se anula y no cuenta para la espera */
export async function anularEnvioRepresentanteBD(id, tokenHash) {
    await Usuario.updateOne({ id, 'representanteLegal.tokenHash': tokenHash }, {
        $set: { 'representanteLegal.tokenHash': null, 'representanteLegal.ultimoEnvio': null }, $inc: { 'representanteLegal.envios': -1 }
    });
}

/** La cuenta cuyo representante tiene ESTE enlace vigente (o null) */
export async function cuentaPorTokenRepresentanteBD(tokenHash, ahora = new Date()) {
    if (!esTexto(tokenHash, 64)) return null;
    return Usuario.findOne({
        'representanteLegal.tokenHash': tokenHash, 'representanteLegal.estado': 'pendiente',
        'representanteLegal.tokenExpira': confiable({ $gt: ahora }), rol: 'usuario'
    }).select('id nombre email fechaNacimiento representanteLegal -_id').lean();
}

/**
 * El representante AUTORIZA: se registra la fecha y su aceptación de los documentos vigentes, y el enlace deja de
 * valer. Atómico: solo una petición puede completarlo.
 */
export async function autorizarRepresentanteBD(id, tokenHash, aceptaciones, ahora = new Date()) {
    const r = await Usuario.updateOne({ id, 'representanteLegal.tokenHash': tokenHash, 'representanteLegal.estado': 'pendiente' }, {
        $set: { 'representanteLegal.estado': 'autorizado', 'representanteLegal.autorizadoEn': ahora, 'representanteLegal.tokenHash': null, 'representanteLegal.tokenExpira': null },
        $push: { aceptacionesLegales: { $each: aceptaciones } }
    });
    return r.modifiedCount === 1;
}
