// Colección "propuestas": cambios que el asistente propone y el usuario confirma. Un solo uso, caducan a los 10 min.
import Propuesta, { MINUTOS_PROPUESTA } from '../modelos/Propuesta.js';
import { esTexto, confiable, nuevoIdAleatorio } from './utilidades.js';

const esId = (id) => esTexto(id, 64);

export async function crearPropuestaBD(userId, { tipo, operaciones = {}, presentacion = {}, estado = null, seleccionable = false }) {
    const doc = {
        id: nuevoIdAleatorio(), userId, tipo, operaciones, presentacion, estado, seleccionable,
        usada: false, creada: new Date(), expira: new Date(Date.now() + MINUTOS_PROPUESTA * 60000)
    };
    await Propuesta.create(doc);
    return doc;
}

/** Propuesta vigente del usuario (comprueba `expira` en código: el monitor TTL tarda hasta ~60 s) */
export async function obtenerPropuestaBD(userId, id) {
    if (!esTexto(userId) || !esId(id)) return null;
    const p = await Propuesta.findOne({ id, userId, usada: false }).select({ _id: 0 }).lean();
    if (!p || new Date(p.expira).getTime() <= Date.now()) return null;
    return p;
}

/** Reclama la propuesta de forma atómica (un solo uso). Devuelve null si no existe, es de otro usuario, caducó o ya se usó. */
export async function reclamarPropuestaBD(userId, id, session = null) {
    if (!esTexto(userId) || !esId(id)) return null;
    const p = await Propuesta.findOneAndUpdate(
        { id, userId, usada: false, expira: confiable({ $gt: new Date() }) },
        { $set: { usada: true } },
        { new: true, session }
    ).select({ _id: 0 }).lean();
    return p && new Date(p.expira).getTime() > Date.now() ? p : null;
}

export async function liberarPropuestaBD(userId, id) {
    if (!esTexto(userId) || !esId(id)) return;
    await Propuesta.updateOne({ id, userId }, { $set: { usada: false } });
}

export async function cancelarPropuestaBD(userId, id) {
    if (!esTexto(userId) || !esId(id)) return false;
    const r = await Propuesta.updateOne({ id, userId, usada: false }, { $set: { usada: true } });
    return r.modifiedCount > 0;
}
