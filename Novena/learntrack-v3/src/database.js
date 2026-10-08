// Capa de acceso a datos (MongoDB Atlas + Mongoose). Todo asíncrono.
// v3: borrado lógico (eliminadaEn), papelera con TTL, check-ins en el servidor, propuestas de un solo uso,
// diario de operaciones para deshacer y aplicación atómica (transacción multi-documento).
import crypto from 'crypto';
import mongoose from 'mongoose';
import Usuario from '../models/Usuario.js';
import Sesion from '../models/Sesion.js';
import Actividad from '../models/Actividad.js';
import Historial from '../models/Historial.js';
import Mensaje from '../models/Mensaje.js';
import Checkin from '../models/Checkin.js';
import Propuesta, { MINUTOS_PROPUESTA } from '../models/Propuesta.js';
import Operacion from '../models/Operacion.js';
import { normalizarActividad } from '../compartido/carga.js';

// Segunda capa contra inyección NoSQL: Mongoose envuelve en $eq cualquier objeto con claves "$" que llegue a un
// filtro. Los operadores que escribimos nosotros se marcan con mongoose.trusted().
mongoose.set('sanitizeFilter', true);
const confiable = mongoose.trusted;

// Primera capa: todo valor externo que llega a un filtro debe ser una cadena simple.
// (Si fuera un objeto como { $ne: null }, se descarta aquí antes de llegar a Mongo.)
export const esTexto = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max;

export const nuevoId = () => crypto.randomBytes(12).toString('hex');           // 24 hex (id público)
export const nuevoIdAleatorio = () => crypto.randomBytes(16).toString('hex');  // 32 hex (propuestas)

export class ErrorDatos extends Error {
    constructor(codigo, mensaje, estado = 409) { super(mensaje); this.codigo = codigo; this.estado = estado; }
}

const ACTIVA = { eliminadaEn: null };     // coincide también con documentos antiguos que no tienen el campo
export const MAX_OPERACIONES = 30;

// ====== Índices, migraciones y capacidades del servidor ======
export const diasPapelera = () => {
    const n = Number(process.env.PAPELERA_DIAS);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30;
};
let soportaTransacciones = false;
export const transaccionesDisponibles = () => soportaTransacciones;

// Construye los índices (únicos y TTL) antes de atender peticiones, para que el control de duplicados funcione
export async function prepararIndices() {
    await Promise.all([Usuario, Sesion, Actividad, Historial, Mensaje, Checkin, Propuesta, Operacion].map((m) => m.init()));
    await asegurarTtlPapelera();
    await backfillActividadesBD();
    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        soportaTransacciones = Boolean(hello.setName || hello.msg === 'isdbgrid');
    } catch { soportaTransacciones = false; }
    return { transacciones: soportaTransacciones, papeleraDias: diasPapelera() };
}

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
 * Backfill idempotente (defecto 2-e): los datos importados de data_store.json solo tienen `fecha`.
 * Completa fecha_inicio/fecha_fin y los campos opcionales para que servidor, IA y agenda lean lo mismo.
 */
export async function backfillActividadesBD() {
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

// ====== Transacciones ======
const esErrorSinTransacciones = (e) => e?.code === 20 || /Transaction numbers are only allowed|replica set/i.test(e?.message ?? '');

/**
 * Ejecuta fn(session) de forma atómica. Si el servidor no admite transacciones (MongoDB independiente),
 * ejecuta sin sesión y devuelve { degradado: true } para avisar al usuario. Atlas sí las admite.
 */
export async function conTransaccion(fn) {
    if (soportaTransacciones) {
        try {
            let resultado;
            await mongoose.connection.transaction(async (session) => { resultado = await fn(session); });
            return { resultado, degradado: false };
        } catch (e) {
            if (!esErrorSinTransacciones(e)) throw e;
            soportaTransacciones = false;
        }
    }
    return { resultado: await fn(null), degradado: true };
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
    await Sesion.deleteMany({ expira: confiable({ $lte: new Date() }) });

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

// ====== ACTIVIDADES (CRUD) ======
const SIN_INTERNOS = { _id: 0, userId: 0 };
const publica = (a) => { const n = normalizarActividad(a); delete n.eliminadaEn; return n; };

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

function reconciliar(actividad) {
    const inicio = actividad.fecha_inicio ?? actividad.fecha;
    if (inicio && actividad.fecha !== inicio) actividad.fecha = inicio;
    if (inicio && (!actividad.fecha_fin || actividad.fecha_fin < inicio)) actividad.fecha_fin = inicio;
    if (actividad.hora_inicio && actividad.hora_fin && actividad.hora_fin <= actividad.hora_inicio) actividad.hora_fin = null;
}

// Edición parcial: solo se modifican los campos recibidos (ya validados) y luego se reconcilian fechas/horario
export async function actualizarActividadBD(userId, actividadId, datosActualizados) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const actividad = await Actividad.findOne({ id: actividadId, userId, ...ACTIVA });
    if (!actividad) return null;

    const { id: _id, userId: _userId, eliminadaEn: _e, ...cambios } = datosActualizados;
    actividad.set(cambios);
    reconciliar(actividad);

    await actividad.save();
    return obtenerActividadesBD(userId);
}

// Borrado LÓGICO (defecto 2-b): la actividad pasa a la papelera y se puede restaurar durante PAPELERA_DIAS.
export async function eliminarActividadBD(userId, actividadId) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const { matchedCount } = await Actividad.updateOne({ id: actividadId, userId, ...ACTIVA }, { $set: { eliminadaEn: new Date() } });
    if (matchedCount === 0) return null;
    return obtenerActividadesBD(userId);
}

// ====== PAPELERA ======
export async function obtenerPapeleraBD(userId) {
    if (!esTexto(userId)) return [];
    const lista = await Actividad.find({ userId, eliminadaEn: confiable({ $ne: null }) })
        .select(SIN_INTERNOS).sort({ eliminadaEn: -1 }).limit(200).lean();
    const ms = diasPapelera() * 86400000;
    return lista.map((a) => ({
        ...normalizarActividad(a),
        eliminadaEn: a.eliminadaEn,
        purgaEn: new Date(new Date(a.eliminadaEn).getTime() + ms)
    }));
}

/** Busca en la papelera por rango de fecha de borrado (instantes) y/o texto del título (ya normalizado por el llamador) */
export async function buscarEnPapeleraBD(userId, { desde = null, hasta = null } = {}) {
    if (!esTexto(userId)) return [];
    const rango = {};
    if (desde instanceof Date) rango.$gte = desde;
    if (hasta instanceof Date) rango.$lt = hasta;
    const filtro = { userId, eliminadaEn: confiable(Object.keys(rango).length ? { $ne: null, ...rango } : { $ne: null }) };
    const lista = await Actividad.find(filtro).select(SIN_INTERNOS).sort({ eliminadaEn: -1 }).limit(200).lean();
    return lista.map((a) => ({ ...normalizarActividad(a), eliminadaEn: a.eliminadaEn }));
}

export async function restaurarActividadBD(userId, actividadId) {
    if (!esTexto(userId) || !esTexto(actividadId)) return null;
    const doc = await Actividad.findOneAndUpdate(
        { id: actividadId, userId, eliminadaEn: confiable({ $ne: null }) },
        { $set: { eliminadaEn: null } },
        { new: true }
    ).select(SIN_INTERNOS).lean();
    return doc ? publica(doc) : null;
}

// ====== CHECK-INS (defecto 2-f) ======
const SIN_ID = { _id: 0, userId: 0, actualizado: 0 };
export async function obtenerCheckinBD(userId, fecha) {
    if (!esTexto(userId) || !esTexto(fecha, 10)) return null;
    return Checkin.findOne({ userId, fecha }).select(SIN_ID).lean();
}
export async function obtenerCheckinsBD(userId, desde, hasta) {
    if (!esTexto(userId) || !esTexto(desde, 10) || !esTexto(hasta, 10)) return [];
    return Checkin.find({ userId, fecha: confiable({ $gte: desde, $lte: hasta }) }).select(SIN_ID).sort({ fecha: 1 }).limit(400).lean();
}
export async function guardarCheckinBD(userId, { fecha, animo, sueno, enfoque }) {
    await Checkin.updateOne({ userId, fecha }, { $set: { animo, sueno, enfoque, actualizado: new Date() } }, { upsert: true, runValidators: true });
    return obtenerCheckinBD(userId, fecha);
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

// ====== PROPUESTAS (un solo uso, 10 min) ======
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
    if (!esTexto(userId) || !esTexto(id, 64)) return null;
    const p = await Propuesta.findOne({ id, userId, usada: false }).select({ _id: 0 }).lean();
    if (!p || new Date(p.expira).getTime() <= Date.now()) return null;
    return p;
}

/** Reclama la propuesta de forma atómica (un solo uso). Devuelve null si no existe, es de otro usuario, caducó o ya se usó. */
export async function reclamarPropuestaBD(userId, id, session = null) {
    if (!esTexto(userId) || !esTexto(id, 64)) return null;
    const p = await Propuesta.findOneAndUpdate(
        { id, userId, usada: false, expira: confiable({ $gt: new Date() }) },
        { $set: { usada: true } },
        { new: true, session }
    ).select({ _id: 0 }).lean();
    return p && new Date(p.expira).getTime() > Date.now() ? p : null;
}

export async function liberarPropuestaBD(userId, id) {
    if (!esTexto(userId) || !esTexto(id, 64)) return;
    await Propuesta.updateOne({ id, userId }, { $set: { usada: false } });
}

export async function cancelarPropuestaBD(userId, id) {
    if (!esTexto(userId) || !esTexto(id, 64)) return false;
    const r = await Propuesta.updateOne({ id, userId, usada: false }, { $set: { usada: true } });
    return r.modifiedCount > 0;
}

// ====== APLICAR CAMBIOS (con diario para deshacer) ======
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

    const ids = [...new Set(operaciones.filter((o) => o.op !== 'crear').map((o) => o.id))];
    if (ids.some((id) => !esTexto(id, 64))) throw new ErrorDatos('ids', 'La propuesta contiene identificadores no válidos.', 400);
    const docs = ids.length
        ? await Actividad.find({ userId, id: confiable({ $in: ids }) }).session(session).lean()
        : [];
    if (docs.length !== ids.length) throw new ErrorDatos('ids', 'Algunas actividades de la propuesta ya no existen o no son tuyas. Vuelve a pedirlo.');
    const porId = new Map(docs.map((d) => [d.id, d]));
    // Estados comprobados ANTES de escribir nada (en modo sin transacciones así no quedan cambios a medias)
    for (const o of operaciones) {
        const doc = porId.get(o.id);
        if ((o.op === 'editar' || o.op === 'eliminar') && doc?.eliminadaEn) throw new ErrorDatos('estado', `«${doc.titulo}» está en la papelera.`);
        if (o.op === 'restaurar' && doc && !doc.eliminadaEn) throw new ErrorDatos('estado', `«${doc.titulo}» no está en la papelera.`);
    }

    const creadas = [];
    let orden = 0;
    for (const o of operaciones) {
        if (o.op === 'crear') {
            const id = nuevoId();
            await Actividad.create([{ ...o.datos, id, userId, eliminadaEn: null }], { session });
            creadas.push(id);
            await Operacion.create([{ loteId, userId, origen, orden: orden++, tipo: 'crear', actividadId: id, antes: null }], { session });
            continue;
        }
        const doc = porId.get(o.id);
        if (o.op === 'editar') {
            if (doc.eliminadaEn) throw new ErrorDatos('estado', `«${doc.titulo}» está en la papelera.`);
            const act = await Actividad.findOne({ userId, id: o.id }).session(session);
            const { id: _a, userId: _b, eliminadaEn: _c, ...cambios } = o.cambios ?? {};
            act.set(cambios);
            reconciliar(act);
            await act.save({ session });
        } else if (o.op === 'eliminar') {
            if (doc.eliminadaEn) throw new ErrorDatos('estado', `«${doc.titulo}» ya estaba en la papelera.`);
            await Actividad.updateOne({ userId, id: o.id }, { $set: { eliminadaEn: new Date() } }, { session });
        } else if (o.op === 'restaurar') {
            if (!doc.eliminadaEn) throw new ErrorDatos('estado', `«${doc.titulo}» no está en la papelera.`);
            await Actividad.updateOne({ userId, id: o.id }, { $set: { eliminadaEn: null } }, { session });
        } else {
            throw new ErrorDatos('op', 'Operación no válida.', 400);
        }
        // El diario se escribe tras cada cambio: si no hay transacciones y algo falla a mitad, se puede compensar
        await Operacion.create([{ loteId, userId, origen, orden: orden++, tipo: o.op, actividadId: o.id, antes: foto(doc) }], { session });
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

export const modelos = { Usuario, Sesion, Actividad, Historial, Mensaje, Checkin, Propuesta, Operacion };
