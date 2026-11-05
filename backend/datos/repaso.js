// Capa de datos del repaso espaciado: lee y escribe los campos `repaso` de una Actividad.
// No contiene lógica de cálculo (esa está en servicios/repaso-espaciado.js); solo acceso a la base de datos.
import Actividad from '../modelos/Actividad.js';
import { esTexto, confiable } from './utilidades.js';

const ACTIVA = { eliminadaEn: null, archivadaEn: null };
const SIN_INTERNOS = { _id: 0, userId: 0 };

/**
 * Activar el repaso espaciado en una actividad existente (la "inscribe" al sistema SR).
 * Se usa cuando el usuario quiere empezar a repasar un tema. `proximaFecha` es la fecha
 * del primer repaso (normalmente "hoy").
 */
export async function activarRepasoBD(userId, actividadId, proximaFecha) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const resultado = await Actividad.findOneAndUpdate(
        { userId, id: actividadId, ...ACTIVA },
        {
            $set: {
                'repaso': {
                    facilidad: 2.5,
                    intervalo: 0,
                    repeticiones: 0,
                    proximaFecha,
                    ultimoRepaso: null,
                    ultimaCalificacion: null
                }
            }
        },
        { new: true }
    ).select(SIN_INTERNOS).lean();
    return resultado;
}

/**
 * Desactivar el repaso espaciado de una actividad (ya no se repasa).
 */
export async function desactivarRepasoBD(userId, actividadId) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const resultado = await Actividad.findOneAndUpdate(
        { userId, id: actividadId, ...ACTIVA },
        { $set: { repaso: null } },
        { new: true }
    ).select(SIN_INTERNOS).lean();
    return resultado;
}

/**
 * Actualizar los parámetros de repaso tras una calificación.
 * Recibe los valores YA CALCULADOS por el servicio (no calcula nada).
 */
export async function actualizarRepasoBD(userId, actividadId, { facilidad, intervalo, repeticiones, proximaFecha, ultimoRepaso, ultimaCalificacion }) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const resultado = await Actividad.findOneAndUpdate(
        { userId, id: actividadId, ...ACTIVA, repaso: confiable({ $ne: null }) },
        {
            $set: {
                'repaso.facilidad': facilidad,
                'repaso.intervalo': intervalo,
                'repaso.repeticiones': repeticiones,
                'repaso.proximaFecha': proximaFecha,
                'repaso.ultimoRepaso': ultimoRepaso,
                'repaso.ultimaCalificacion': ultimaCalificacion
            }
        },
        { new: true }
    ).select(SIN_INTERNOS).lean();
    return resultado;
}

/**
 * Obtener las actividades con repaso pendiente (proximaFecha ≤ hoy) para un usuario.
 * Las ordena por fecha más antigua primero (las más atrasadas se repasan antes).
 */
export async function obtenerRepasosPendientesBD(userId, hoy) {
    if (!esTexto(userId)) return [];
    return Actividad.find({
        userId, ...ACTIVA,
        repaso: confiable({ $ne: null }),
        'repaso.proximaFecha': confiable({ $lte: hoy })
    }).select(SIN_INTERNOS).sort({ 'repaso.proximaFecha': 1 }).lean();
}

/**
 * Obtener TODAS las actividades con repaso activo de un usuario (pendientes y futuras).
 */
export async function obtenerActividadesConRepasoBD(userId) {
    if (!esTexto(userId)) return [];
    return Actividad.find({
        userId, ...ACTIVA,
        repaso: confiable({ $ne: null })
    }).select(SIN_INTERNOS).sort({ 'repaso.proximaFecha': 1 }).lean();
}

/**
 * Obtener una actividad por ID verificando que tenga repaso activo.
 */
export async function obtenerActividadConRepasoBD(userId, actividadId) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    return Actividad.findOne({
        userId, id: actividadId, ...ACTIVA,
        repaso: confiable({ $ne: null })
    }).select(SIN_INTERNOS).lean();
}

