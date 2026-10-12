// Colecciones "checkins" (cómo te sientes cada día) e "historial" (porcentaje de carga de cada día).
import Checkin from '../modelos/Checkin.js';
import Historial from '../modelos/Historial.js';
import { esTexto, confiable } from './utilidades.js';

const SIN_INTERNOS = { _id: 0, userId: 0, actualizado: 0 };

export async function obtenerCheckinBD(userId, fecha) {
    if (!esTexto(userId) || !esTexto(fecha, 10)) return null;
    return Checkin.findOne({ userId, fecha }).select(SIN_INTERNOS).lean();
}
export async function obtenerCheckinsBD(userId, desde, hasta) {
    if (!esTexto(userId) || !esTexto(desde, 10) || !esTexto(hasta, 10)) return [];
    return Checkin.find({ userId, fecha: confiable({ $gte: desde, $lte: hasta }) }).select(SIN_INTERNOS).sort({ fecha: 1 }).limit(400).lean();
}
export async function guardarCheckinBD(userId, { fecha, animo, sueno, enfoque }) {
    await Checkin.updateOne({ userId, fecha }, { $set: { animo, sueno, enfoque, actualizado: new Date() } }, { upsert: true, runValidators: true });
    return obtenerCheckinBD(userId, fecha);
}

// En la BD es una colección plana { userId, fecha, porcentaje }; la API devuelve { 'YYYY-MM-DD': porcentaje }
export async function obtenerHistorialBD(userId) {
    if (!esTexto(userId)) return {};
    const filas = await Historial.find({ userId }).select({ _id: 0, fecha: 1, porcentaje: 1 }).sort({ fecha: 1 }).lean();
    return Object.fromEntries(filas.map((f) => [f.fecha, f.porcentaje]));
}
export async function guardarHistorialBD(userId, fecha, porcentaje) {
    await Historial.updateOne({ userId, fecha }, { $set: { porcentaje } }, { upsert: true, runValidators: true });
    return obtenerHistorialBD(userId);
}
