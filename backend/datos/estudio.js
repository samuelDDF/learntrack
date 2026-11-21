// Capa de datos del módulo Estudio (v3.12): objetivos de aprendizaje y acceso a sus sesiones.
// Toda consulta filtra por userId (una cuenta nunca ve ni toca los objetivos de otra). Sin lógica de negocio:
// el plan de sesiones está en servicios/estudio/planificador-estudio.js y la validación en validacion/estudio.js.
import Objetivo from '../modelos/Objetivo.js';
import Actividad from '../modelos/Actividad.js';
import { normalizarActividad } from '../../compartido/carga.js';
import { claveTema } from '../../compartido/estudio.js';
import { esTexto, nuevoId, confiable, ErrorDatos } from './utilidades.js';

const SIN_INTERNOS = { _id: 0, userId: 0, claveTema: 0 };
export const MAX_OBJETIVOS = 300;

export async function listarObjetivosBD(userId) {
    if (!esTexto(userId)) return [];
    return Objetivo.find({ userId }).select(SIN_INTERNOS).sort({ creadoEn: 1 }).limit(MAX_OBJETIVOS).lean();
}

export async function obtenerObjetivoBD(userId, id) {
    if (!esTexto(userId) || !esTexto(id, 64)) return null;
    return Objetivo.findOne({ userId, id }).select(SIN_INTERNOS).lean();
}

/** Varios objetivos del usuario en UNA consulta; devuelve null si alguno no existe o no es suyo */
export async function obtenerObjetivosBD(userId, ids) {
    if (!esTexto(userId) || !Array.isArray(ids) || ids.length === 0 || ids.some((x) => !esTexto(x, 64))) return null;
    const unicos = [...new Set(ids)];
    const lista = await Objetivo.find({ userId, id: confiable({ $in: unicos }) }).select(SIN_INTERNOS).lean();
    return lista.length === unicos.length ? lista : null;
}

/** El objetivo con el mismo tema (sin importar mayúsculas, tildes o plurales), si existe */
export async function buscarObjetivoPorTemaBD(userId, tema) {
    if (!esTexto(userId)) return null;
    const clave = claveTema(tema);
    if (!clave) return null;
    return Objetivo.findOne({ userId, claveTema: clave }).select(SIN_INTERNOS).lean();
}

/**
 * Crea un objetivo. Si ya existe uno con el mismo tema:
 *  · si estaba sugerido o descartado y ahora lo crea la persona (o lo vuelve a pedir explícitamente) → se reactiva
 *    con los datos nuevos;
 *  · si ya estaba activo o completado → no se duplica: se devuelve { existente } para avisar.
 */
export async function crearObjetivoBD(userId, datos) {
    if (!esTexto(userId)) throw new ErrorDatos('usuario', 'Usuario no válido.', 401);
    const total = await Objetivo.countDocuments({ userId });
    const clave = claveTema(datos.tema);
    const previo = await Objetivo.findOne({ userId, claveTema: clave }).lean();
    if (previo) {
        if (['sugerido', 'descartado'].includes(previo.estado)) {
            const cambios = { ...datos, menciones: (previo.menciones ?? 1) + 1, posponerHasta: null, actualizadoEn: new Date() };
            await Objetivo.updateOne({ userId, id: previo.id }, { $set: cambios });
            return { objetivo: await obtenerObjetivoBD(userId, previo.id), reactivado: true };
        }
        return { objetivo: await obtenerObjetivoBD(userId, previo.id), existente: true };
    }
    if (total >= MAX_OBJETIVOS) throw new ErrorDatos('limite', `Puedes tener como máximo ${MAX_OBJETIVOS} temas de estudio.`, 400);
    const id = nuevoId();
    await Objetivo.create({ ...datos, id, userId, claveTema: clave, creadoEn: new Date(), actualizadoEn: new Date() });
    return { objetivo: await obtenerObjetivoBD(userId, id), creado: true };
}

/**
 * Registra una SUGERENCIA de la IA (estado «sugerido»). Nunca pisa lo que la persona ya decidió:
 *  · tema nuevo → sugerencia nueva;
 *  · ya sugerido → suma una mención (dificultad repetida) y actualiza el motivo;
 *  · descartado → solo vuelve a sugerirse si `explicita` (la persona lo dijo de nuevo); si no, se respeta;
 *  · activo o completado → no se toca (se devuelve para decir «ya lo tienes en Estudio»).
 */
export async function registrarSugerenciaBD(userId, datos, { explicita = false } = {}) {
    if (!esTexto(userId)) throw new ErrorDatos('usuario', 'Usuario no válido.', 401);
    const clave = claveTema(datos.tema);
    const previo = await Objetivo.findOne({ userId, claveTema: clave }).lean();
    if (!previo) {
        if (await Objetivo.countDocuments({ userId }) >= MAX_OBJETIVOS) return { omitida: true };
        const id = nuevoId();
        await Objetivo.create({ ...datos, id, userId, claveTema: clave, estado: 'sugerido', creadoEn: new Date(), actualizadoEn: new Date() });
        return { objetivo: await obtenerObjetivoBD(userId, id), nueva: true };
    }
    if (previo.estado === 'sugerido' || (previo.estado === 'descartado' && explicita)) {
        const cambios = { estado: 'sugerido', menciones: (previo.menciones ?? 1) + 1, posponerHasta: null, actualizadoEn: new Date() };
        if (datos.motivo) cambios.motivo = datos.motivo;
        if (datos.fechaLimite) cambios.fechaLimite = datos.fechaLimite;
        if (datos.proyecto && !previo.proyecto) cambios.proyecto = datos.proyecto;
        await Objetivo.updateOne({ userId, id: previo.id }, { $set: cambios });
        return { objetivo: await obtenerObjetivoBD(userId, previo.id), repetida: true };
    }
    if (previo.estado === 'descartado') return { objetivo: null, descartada: true };
    return { objetivo: await obtenerObjetivoBD(userId, previo.id), existente: true };
}

export async function actualizarObjetivoBD(userId, id, cambios) {
    if (!esTexto(userId) || !esTexto(id, 64)) return null;
    const set = { ...cambios, actualizadoEn: new Date() };
    if (cambios.tema) {
        set.claveTema = claveTema(cambios.tema);
        const choque = await Objetivo.findOne({ userId, claveTema: set.claveTema, id: confiable({ $ne: id }) }).lean();
        if (choque) throw new ErrorDatos('duplicado', `Ya tienes un tema llamado «${choque.tema}».`, 409);
    }
    const r = await Objetivo.updateOne({ userId, id }, { $set: set });
    return r.matchedCount ? obtenerObjetivoBD(userId, id) : null;
}

/** Elimina un objetivo. Sus sesiones siguen en el calendario como actividades normales (se desvinculan). */
export async function eliminarObjetivoBD(userId, id) {
    if (!esTexto(userId) || !esTexto(id, 64)) return false;
    const r = await Objetivo.deleteOne({ userId, id });
    if (!r.deletedCount) return false;
    await Actividad.updateMany({ userId, objetivoId: id }, { $set: { objetivoId: null } });
    return true;
}

/** Sesiones de estudio (actividades con objetivoId) del usuario: activas y archivadas, no las de la papelera */
export async function obtenerSesionesEstudioBD(userId) {
    if (!esTexto(userId)) return [];
    const lista = await Actividad.find({ userId, eliminadaEn: null, objetivoId: confiable({ $ne: null }) })
        .select({ _id: 0, userId: 0 }).sort({ fecha_inicio: 1, hora_inicio: 1 }).lean();
    return lista.map((a) => normalizarActividad(a));
}
