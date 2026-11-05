// Colección "sesiones": solo se guarda el SHA-256 del token (la cookie lleva el token en claro).
import Sesion from '../modelos/Sesion.js';
import { esTexto, confiable } from './utilidades.js';

const MAX_SESIONES_POR_USUARIO = 5;

export async function crearSesionBD({ tokenHash, userId, expira }) {
    await Sesion.deleteMany({ expira: confiable({ $lte: new Date() }) });
    // Como máximo 5 sesiones por usuario: se cierran las más antiguas
    const propias = await Sesion.find({ userId }).sort({ expira: 1 }).select('_id').lean();
    const sobrantes = propias.length - MAX_SESIONES_POR_USUARIO + 1;
    if (sobrantes > 0) {
        await Sesion.deleteMany({ _id: confiable({ $in: propias.slice(0, sobrantes).map((s) => s._id) }) });
    }
    await Sesion.create({ tokenHash, userId, expira });
}

export async function buscarSesionBD(tokenHash) {
    if (!esTexto(tokenHash)) return null;
    return Sesion.findOne({ tokenHash, expira: confiable({ $gt: new Date() }) }).select('-_id').lean();
}

export async function eliminarSesionBD(tokenHash) {
    if (!esTexto(tokenHash)) return;
    await Sesion.deleteMany({ tokenHash });
}

/** Cierra todas las sesiones del usuario salvo la actual (tras cambiar la contraseña) */
export async function eliminarOtrasSesionesBD(userId, tokenHashActual) {
    if (!esTexto(userId)) return;
    await Sesion.deleteMany({ userId, tokenHash: confiable({ $ne: String(tokenHashActual ?? '') }) });
}
