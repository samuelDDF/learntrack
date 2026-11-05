// Colección "actividades" (CRUD, borrado lógico y papelera con TTL) y "operaciones" (diario para deshacer los
// cambios del asistente). Las actividades borradas tienen `eliminadaEn` con fecha; las activas, null.
import mongoose from 'mongoose';
import Actividad from '../modelos/Actividad.js';
import Operacion from '../modelos/Operacion.js';
import { normalizarActividad } from '../../compartido/carga.js';
import { esTexto, confiable, nuevoId, ErrorDatos } from './utilidades.js';

const ACTIVA = { eliminadaEn: null };     // coincide también con documentos antiguos que no tienen el campo
const EN_PAPELERA = { eliminadaEn: confiable({ $ne: null }) };
const SIN_INTERNOS = { _id: 0, userId: 0 };
export const MAX_OPERACIONES = 30;

/** Días que lo borrado permanece en la papelera (PAPELERA_DIAS, 30 por defecto) */
export const diasPapelera = () => {
    const n = Number(process.env.PAPELERA_DIAS);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30;
};

const publica = (a) => { const n = normalizarActividad(a); delete n.eliminadaEn; return n; };

/** Mantiene coherentes el alias `fecha`, el rango de fechas y el horario tras un cambio */
function reconciliar(actividad) {
    const inicio = actividad.fecha_inicio ?? actividad.fecha;
    if (inicio && actividad.fecha !== inicio) actividad.fecha = inicio;
    if (inicio && (!actividad.fecha_fin || actividad.fecha_fin < inicio)) actividad.fecha_fin = inicio;
    if (actividad.hora_inicio && actividad.hora_fin && actividad.hora_fin <= actividad.hora_inicio) actividad.hora_fin = null;
}

/** Edición parcial de un documento: nunca deja tocar id, dueño ni borrado */
function aplicarEdicion(doc, cambios = {}) {
    const { id: _id, userId: _userId, eliminadaEn: _e, ...permitidos } = cambios;
    doc.set(permitidos);
    reconciliar(doc);
}

// ====== Mantenimiento (se ejecuta al arrancar) ======
// El TTL se fija al crear el índice: si PAPELERA_DIAS cambia, se actualiza con collMod (no hace falta recrearlo).
export async function asegurarTtlPapelera() {
    const segundos = diasPapelera() * 86400;
    const coleccion = Actividad.collection;
    const indices = await coleccion.indexes().catch(() => []);
    const actual = indices.find((i) => JSON.stringify(i.key) === JSON.stringify({ eliminadaEn: 1 }));
    if (!actual) {
        await coleccion.createIndex({ eliminadaEn: 1 }, { name: 'papelera_ttl', expireAfterSeconds: segundos });
        return { creado: true, segundos };
    }
    if (actual.expireAfterSeconds !== segundos) {
        await mongoose.connection.db.command({ collMod: coleccion.collectionName, index: { keyPattern: { eliminadaEn: 1 }, expireAfterSeconds: segundos } });
        return { actualizado: true, antes: actual.expireAfterSeconds, segundos };
    }
    return { sinCambios: true, segundos };
}

/**
 * Migración idempotente: las actividades antiguas solo tienen `fecha`. Completa fecha_inicio/fecha_fin y los
 * campos opcionales para que servidor, IA y agenda lean lo mismo. Si no queda nada pendiente, no hace nada.
 */
export async function completarActividadesAntiguasBD() {
    const pendientes = await Actividad.find({
        $or: [
            { fecha_inicio: null }, { fecha_fin: null }, { estado: null }, { proyecto: null },
            { hora_inicio: confiable({ $exists: false }) }, { fija: null }
        ]
    }).select({ _id: 1, fecha: 1, fecha_inicio: 1, fecha_fin: 1, estado: 1, proyecto: 1, hora_inicio: 1, hora_fin: 1, fija: 1 }).lean();
    if (pendientes.length === 0) return { actualizadas: 0 };
    const ops = pendientes.map((a) => {
        const n = normalizarActividad(a);
        const set = {};
        if (!a.fecha_inicio && n.fecha_inicio) set.fecha_inicio = n.fecha_inicio;
        if (!a.fecha && n.fecha_inicio) set.fecha = n.fecha_inicio;
        if ((!a.fecha_fin || a.fecha_fin < n.fecha_inicio) && n.fecha_fin) set.fecha_fin = n.fecha_fin;
        if (!a.estado) set.estado = n.estado;
        if (a.proyecto === undefined || a.proyecto === null) set.proyecto = '';
        if (a.hora_inicio === undefined) set.hora_inicio = null;
        if (a.hora_fin === undefined) set.hora_fin = null;
        if (a.fija === undefined || a.fija === null) set.fija = false;
        return { updateOne: { filter: { _id: a._id }, update: { $set: set } } };
    }).filter((o) => Object.keys(o.updateOne.update.$set).length > 0);
    if (ops.length) await Actividad.bulkWrite(ops, { ordered: false });
    return { actualizadas: ops.length };
}

// ====== CRUD ======
/** Actividades activas del usuario, normalizadas (las antiguas sin fecha_inicio también) */
export async function obtenerActividadesBD(userId) {
    if (!esTexto(userId)) return [];
    const lista = await Actividad.find({ userId, ...ACTIVA }).select(SIN_INTERNOS).sort({ _id: 1 }).lean();
    return lista.map(publica);
}

export async function obtenerActividadBD(userId, id) {
    if (!esTexto(userId) || !esTexto(id)) return null;
    const a = await Actividad.findOne({ userId, id, ...ACTIVA }).select(SIN_INTERNOS).lean();
    return a ? publica(a) : null;
}

/** Verificación en UNA consulta: ¿todos los ids son actividades activas de este usuario? */
export async function verificarIdsBD(userId, ids) {
    if (!esTexto(userId) || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_OPERACIONES || ids.some((id) => !esTexto(id, 64))) return false;
    const unicos = [...new Set(ids)];
    const n = await Actividad.countDocuments({ userId, id: confiable({ $in: unicos }), ...ACTIVA });
    return n === unicos.length;
}

/** Proyectos distintos del usuario (para que el chat reconozca "el proyecto X") */
export async function obtenerProyectosBD(userId) {
    if (!esTexto(userId)) return [];
    const lista = await Actividad.distinct('proyecto', { userId, ...ACTIVA });
    return lista.filter((p) => typeof p === 'string' && p.trim()).sort((a, b) => a.localeCompare(b, 'es'));
}

export async function guardarActividadBD(userId, actividad) {
    await Actividad.create({ ...actividad, userId, eliminadaEn: null });
    return obtenerActividadesBD(userId);
}

/** Edición parcial: solo se modifican los campos recibidos (ya validados) */
export async function actualizarActividadBD(userId, actividadId, cambios) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const actividad = await Actividad.findOne({ id: actividadId, userId, ...ACTIVA });
    if (!actividad) return null;
    aplicarEdicion(actividad, cambios);
    await actividad.save();
    return obtenerActividadesBD(userId);
}

/** Borrado LÓGICO: la actividad pasa a la papelera y se puede restaurar durante PAPELERA_DIAS */
export async function eliminarActividadBD(userId, actividadId) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const { matchedCount } = await Actividad.updateOne({ id: actividadId, userId, ...ACTIVA }, { $set: { eliminadaEn: new Date() } });
    if (matchedCount === 0) return null;
    return obtenerActividadesBD(userId);
}

// ====== Papelera ======
export async function obtenerPapeleraBD(userId) {
    if (!esTexto(userId)) return [];
    const lista = await Actividad.find({ userId, ...EN_PAPELERA }).select(SIN_INTERNOS).sort({ eliminadaEn: -1 }).limit(200).lean();
    const ms = diasPapelera() * 86400000;
    return lista.map((a) => ({
        ...normalizarActividad(a),
        eliminadaEn: a.eliminadaEn,
        purgaEn: new Date(new Date(a.eliminadaEn).getTime() + ms)
    }));
}

/** Busca en la papelera por rango de fecha de borrado (instantes) */
export async function buscarEnPapeleraBD(userId, { desde = null, hasta = null } = {}) {
    if (!esTexto(userId)) return [];
    const rango = {};
    if (desde instanceof Date) rango.$gte = desde;
    if (hasta instanceof Date) rango.$lt = hasta;
    const lista = await Actividad.find({ userId, eliminadaEn: confiable({ $ne: null, ...rango }) })
        .select(SIN_INTERNOS).sort({ eliminadaEn: -1 }).limit(200).lean();
    return lista.map((a) => ({ ...normalizarActividad(a), eliminadaEn: a.eliminadaEn }));
}

export async function restaurarActividadBD(userId, actividadId) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const doc = await Actividad.findOneAndUpdate(
        { id: actividadId, userId, ...EN_PAPELERA },
        { $set: { eliminadaEn: null } },
        { new: true }
    ).select(SIN_INTERNOS).lean();
    return doc ? publica(doc) : null;
}

// ====== Cambios del asistente (con diario para deshacer) ======
const CAMPOS_FOTO = ['titulo', 'tipo', 'exigencia', 'horas', 'fecha', 'fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin', 'estado', 'proyecto', 'fija', 'eliminadaEn'];
const foto = (doc) => Object.fromEntries(CAMPOS_FOTO.map((k) => [k, doc[k] === undefined ? null : doc[k]]));

/**
 * Aplica una lista plana de operaciones sobre las actividades del usuario:
 *   { op: 'crear', datos } · { op: 'editar', id, cambios } · { op: 'eliminar', id } · { op: 'restaurar', id }
 * Seguridad: máximo 30 operaciones; TODOS los ids se verifican en UNA consulta { userId, id: { $in } } y si el
 * número no coincide se rechaza todo (sin IDOR). Cada cambio se anota en el diario con el mismo loteId.
 */
export async function aplicarCambiosBD(userId, operaciones, { origen = 'ia', session = null, loteId = nuevoId() } = {}) {
    if (!esTexto(userId)) throw new ErrorDatos('usuario', 'Usuario no válido.', 401);
    if (!Array.isArray(operaciones) || operaciones.length === 0) throw new ErrorDatos('vacia', 'No hay cambios que aplicar.', 400);
    if (operaciones.length > MAX_OPERACIONES) throw new ErrorDatos('demasiadas', `Una propuesta admite como máximo ${MAX_OPERACIONES} cambios.`, 400);
    if (operaciones.some((o) => !['crear', 'editar', 'eliminar', 'restaurar'].includes(o.op))) throw new ErrorDatos('op', 'Operación no válida.', 400);

    const ids = [...new Set(operaciones.filter((o) => o.op !== 'crear').map((o) => o.id))];
    if (ids.some((id) => !esTexto(id, 64))) throw new ErrorDatos('ids', 'La propuesta contiene identificadores no válidos.', 400);
    const docs = ids.length ? await Actividad.find({ userId, id: confiable({ $in: ids }) }).session(session).lean() : [];
    if (docs.length !== ids.length) throw new ErrorDatos('ids', 'Algunas actividades de la propuesta ya no existen o no son tuyas. Vuelve a pedirlo.');
    const porId = new Map(docs.map((d) => [d.id, d]));
    // Estados comprobados ANTES de escribir nada (en modo sin transacciones así no quedan cambios a medias)
    for (const o of operaciones) {
        const doc = porId.get(o.id);
        if ((o.op === 'editar' || o.op === 'eliminar') && doc.eliminadaEn) throw new ErrorDatos('estado', `«${doc.titulo}» está en la papelera.`);
        if (o.op === 'restaurar' && !doc.eliminadaEn) throw new ErrorDatos('estado', `«${doc.titulo}» no está en la papelera.`);
    }

    const creadas = [];
    let orden = 0;
    const anotar = (tipo, actividadId, antes) => Operacion.create([{ loteId, userId, origen, orden: orden++, tipo, actividadId, antes }], { session });
    for (const o of operaciones) {
        if (o.op === 'crear') {
            const id = nuevoId();
            await Actividad.create([{ ...o.datos, id, userId, eliminadaEn: null }], { session });
            creadas.push(id);
            await anotar('crear', id, null);
            continue;
        }
        if (o.op === 'editar') {
            const act = await Actividad.findOne({ userId, id: o.id }).session(session);
            aplicarEdicion(act, o.cambios);
            await act.save({ session });
        } else {
            await Actividad.updateOne({ userId, id: o.id }, { $set: { eliminadaEn: o.op === 'eliminar' ? new Date() : null } }, { session });
        }
        // El diario se escribe tras cada cambio: si no hay transacciones y algo falla a mitad, se puede compensar
        await anotar(o.op, o.id, foto(porId.get(o.id)));
    }
    return { loteId, creadas, total: operaciones.length };
}

/** Último lote de la IA que se puede deshacer */
export async function ultimoLoteBD(userId) {
    if (!esTexto(userId)) return null;
    const op = await Operacion.findOne({ userId, origen: 'ia', revertida: false }).sort({ creada: -1, orden: -1 }).select({ _id: 0, loteId: 1 }).lean();
    return op?.loteId ?? null;
}

/** Revierte un lote completo (en orden inverso). Devuelve el número de cambios revertidos. */
export async function deshacerLoteBD(userId, loteId, session = null) {
    if (!esTexto(userId) || !esTexto(loteId, 64)) return 0;
    const ops = await Operacion.find({ userId, loteId, revertida: false }).sort({ orden: -1 }).session(session).lean();
    for (const o of ops) {
        if (o.tipo === 'crear') {
            await Actividad.deleteOne({ userId, id: o.actividadId }, { session });
        } else if (o.antes) {
            const { eliminadaEn, ...resto } = o.antes;
            const set = o.tipo === 'editar' ? resto : {};
            set.eliminadaEn = eliminadaEn ?? null;
            await Actividad.updateOne({ userId, id: o.actividadId }, { $set: set }, { session });
        }
    }
    if (ops.length) await Operacion.updateMany({ userId, loteId }, { $set: { revertida: true } }, { session });
    return ops.length;
}
