// Capa de acceso a datos (MongoDB Atlas + Mongoose). Mantiene los mismos nombres y resultados que la
// versión basada en data_store.json, pero ahora todas las funciones son asíncronas.
import Usuario from '../models/Usuario.js';
import Sesion from '../models/Sesion.js';
import Actividad from '../models/Actividad.js';
import Historial from '../models/Historial.js';
import Mensaje from '../models/Mensaje.js';

// Defensa contra inyección NoSQL: todo valor externo que llega a un filtro debe ser una cadena simple.
// (Si fuera un objeto como { $ne: null }, Mongoose lo interpretaría como operador.)
const esTexto = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max;

// Construye los índices (únicos y TTL) antes de atender peticiones, para que el control de duplicados funcione
export async function prepararIndices() {
    await Promise.all([Usuario, Sesion, Actividad, Historial, Mensaje].map((m) => m.init()));
}

// ====== USUARIOS ======
export async function buscarUsuarioPorEmail(email) {
    if (!esTexto(email, 254)) return null;
    return Usuario.findOne({ email }).select('-_id').lean();
}

export async function buscarUsuarioPorId(id) {
    if (!esTexto(id)) return null;
    return Usuario.findOne({ id }).select('-_id -passwordHash').lean();
}

// Devuelve null si el correo ya existe (índice único), igual que antes
export async function crearUsuarioBD(usuario) {
    try {
        await Usuario.create(usuario);
        return usuario;
    } catch (e) {
        if (e?.code === 11000) return null;
        throw e;
    }
}

// ====== SESIONES ======
const MAX_SESIONES_POR_USUARIO = 5;

export async function crearSesionBD({ tokenHash, userId, expira }) {
    await Sesion.deleteMany({ expira: { $lte: new Date() } });

    const propias = await Sesion.find({ userId }).sort({ expira: 1 }).select('_id').lean();
    const sobrantes = propias.length - MAX_SESIONES_POR_USUARIO + 1;
    if (sobrantes > 0) {
        await Sesion.deleteMany({ _id: { $in: propias.slice(0, sobrantes).map((s) => s._id) } });
    }

    await Sesion.create({ tokenHash, userId, expira });
}

export async function buscarSesionBD(tokenHash) {
    if (!esTexto(tokenHash)) return null;
    return Sesion.findOne({ tokenHash, expira: { $gt: new Date() } }).select('-_id').lean();
}

export async function eliminarSesionBD(tokenHash) {
    if (!esTexto(tokenHash)) return;
    await Sesion.deleteMany({ tokenHash });
}

// ====== ACTIVIDADES (CRUD) ======
const SIN_INTERNOS = { _id: 0, userId: 0 };

export async function obtenerActividadesBD(userId) {
    if (!esTexto(userId)) return [];
    return Actividad.find({ userId }).select(SIN_INTERNOS).sort({ _id: 1 }).lean();
}

export async function guardarActividadBD(userId, actividad) {
    await Actividad.create({ ...actividad, userId });
    return obtenerActividadesBD(userId);
}

// Edición parcial: solo se modifican los campos recibidos (ya validados) y luego se reconcilian fechas/horario
export async function actualizarActividadBD(userId, actividadId, datosActualizados) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const actividad = await Actividad.findOne({ id: actividadId, userId });
    if (!actividad) return null;

    const { id: _id, userId: _userId, ...cambios } = datosActualizados;
    actividad.set(cambios);

    const inicio = actividad.fecha_inicio ?? actividad.fecha;
    if (inicio && (!actividad.fecha_fin || actividad.fecha_fin < inicio)) actividad.fecha_fin = inicio;
    if (actividad.hora_inicio && actividad.hora_fin && actividad.hora_fin <= actividad.hora_inicio) actividad.hora_fin = null;

    await actividad.save();
    return obtenerActividadesBD(userId);
}

export async function eliminarActividadBD(userId, actividadId) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const { deletedCount } = await Actividad.deleteMany({ id: actividadId, userId });
    if (deletedCount === 0) return null;
    return obtenerActividadesBD(userId);
}

// Borrado de varias actividades en una sola consulta (lo usa el chat de IA). Los ids vienen del modelo de
// lenguaje, así que se descarta todo lo que no sea texto y se limita la cantidad.
export async function eliminarActividadesBD(userId, ids) {
    const limpios = (Array.isArray(ids) ? ids : []).filter((id) => esTexto(id)).slice(0, 50);
    if (!esTexto(userId) || limpios.length === 0) return { eliminadas: 0, actividades: await obtenerActividadesBD(userId) };
    const { deletedCount } = await Actividad.deleteMany({ userId, id: { $in: limpios } });
    return { eliminadas: deletedCount, actividades: await obtenerActividadesBD(userId) };
}

// ====== HISTORIAL ======
// En la BD es una colección plana { userId, fecha, porcentaje }; la API sigue devolviendo { 'YYYY-MM-DD': porcentaje }
export async function obtenerHistorialBD(userId) {
    if (!esTexto(userId)) return {};
    const filas = await Historial.find({ userId }).select({ _id: 0, fecha: 1, porcentaje: 1 }).sort({ fecha: 1 }).lean();
    return Object.fromEntries(filas.map((f) => [f.fecha, f.porcentaje]));
}

export async function guardarHistorialBD(userId, fecha, porcentaje) {
    await Historial.updateOne({ userId, fecha }, { $set: { porcentaje } }, { upsert: true, runValidators: true });
    return obtenerHistorialBD(userId);
}

// ====== CONTACTO ======
export async function guardarMensajeBD(mensaje) {
    await Mensaje.create(mensaje);
}
