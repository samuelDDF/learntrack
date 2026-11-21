// Administración (v3.13): el administrador ÚNICO, la gestión de cuentas y la auditoría.
// Reglas que se cumplen AQUÍ (no solo en la ruta):
//  · Toda función que actúa sobre «una cuenta» filtra por rol «usuario»: la cuenta de administración nunca aparece en
//    listados, no se puede suspender, eliminar ni cerrar sus sesiones desde el panel.
//  · Se devuelven METADATOS de la cuenta (nombre, correo, fechas, estado, conteos), nunca el contenido de sus
//    actividades, proyectos, check-ins o temas de estudio.
//  · Nada de esto devuelve contraseñas, hashes, tokens ni códigos.
import Usuario from '../modelos/Usuario.js';
import Sesion from '../modelos/Sesion.js';
import Actividad from '../modelos/Actividad.js';
import Objetivo from '../modelos/Objetivo.js';
import Checkin from '../modelos/Checkin.js';
import Auditoria from '../modelos/Auditoria.js';
import { esTexto, confiable, nuevoId } from './utilidades.js';

const POR_PAGINA = 25;
// «Cualquier cuenta que NO sea la de administración». Ojo: NO usar { rol: 'usuario' }: las cuentas creadas antes de la
// v3.13 no tienen el campo «rol» guardado (Mongoose solo pone el valor por defecto al LEER), así que no coincidirían.
const NO_ADMIN = () => confiable({ $ne: 'admin' });
const SOLO_USUARIOS = Object.freeze({ get rol() { return NO_ADMIN(); } });
const CAMPOS_LISTADO = 'id nombre email creado ultimoAcceso estado suspension emailVerificado fechaNacimiento representanteLegal.estado aceptacionesLegales';
const escaparRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Forma pública de una cuenta para el panel (sin secretos ni contenido) */
export function cuentaParaAdmin(u) {
    const ultimas = {};
    for (const a of u.aceptacionesLegales ?? []) if (!ultimas[a.documento] || a.aceptadoEn > ultimas[a.documento].aceptadoEn) ultimas[a.documento] = a;
    return {
        id: u.id, nombre: u.nombre, email: u.email, creado: u.creado ?? null, ultimoAcceso: u.ultimoAcceso ?? null,
        estado: u.estado ?? 'activa',
        suspension: u.suspension ? { motivo: u.suspension.motivo, desde: u.suspension.desde, hasta: u.suspension.hasta ?? null } : null,
        correoVerificado: u.emailVerificado !== false,
        menorDeEdad: Boolean(u.representanteLegal),
        representante: u.representanteLegal ? { estado: u.representanteLegal.estado } : null,
        documentos: Object.fromEntries(Object.entries(ultimas).map(([d, a]) => [d, { version: a.version, aceptadoEn: a.aceptadoEn }]))
    };
}

// ====================================================================== administrador único
export const contarAdminsBD = () => Usuario.countDocuments({ rol: 'admin' });

/** Datos NO sensibles del administrador (para el script de verificación) */
export async function obtenerAdminBD() {
    return Usuario.findOne({ rol: 'admin' }).select('id nombre email creado ultimoAcceso -_id').lean();
}

/**
 * Crea el administrador. Lo llama SOLO scripts/admin.js (no hay ninguna ruta HTTP que lo haga).
 * Si ya existe uno, o si el correo ya es de una cuenta normal, no crea nada. El índice único parcial
 * «administrador_unico» es la última barrera: MongoDB rechaza un segundo documento con rol «admin».
 * @returns {{ creado: true, admin } | { error: 'ya_existe' | 'correo_en_uso' }}
 */
export async function crearAdminBD({ nombre, email, passwordHash }) {
    await Usuario.init();          // garantiza el índice único antes de insertar
    if (await contarAdminsBD() > 0) return { error: 'ya_existe' };
    if (await Usuario.exists({ email })) return { error: 'correo_en_uso' };
    const ahora = new Date();
    const admin = { id: nuevoId(), nombre, email, passwordHash, rol: 'admin', estado: 'activa', emailVerificado: true, emailVerificadoEn: ahora, creado: ahora };
    try {
        await Usuario.create(admin);
    } catch (e) {
        if (e?.code === 11000) return { error: (await contarAdminsBD()) > 0 ? 'ya_existe' : 'correo_en_uso' };
        throw e;
    }
    await registrarAuditoriaBD({ accion: 'admin_creado', adminId: admin.id, detalle: { origen: 'script' } });
    return { creado: true, admin: { id: admin.id, nombre, email, creado: ahora } };
}

/** Nueva contraseña para el administrador (recuperación desde el servidor). Cierra todas sus sesiones. */
export async function restablecerAdminBD({ email, passwordHash }) {
    const admin = await Usuario.findOne({ rol: 'admin', email }).select('id').lean();
    if (!admin) return { error: 'no_encontrado' };
    await Usuario.updateOne({ id: admin.id, rol: 'admin' }, { $set: { passwordHash, estado: 'activa' }, $unset: { suspension: '' } });
    await Sesion.deleteMany({ userId: admin.id });
    await registrarAuditoriaBD({ accion: 'admin_contrasena_restablecida', adminId: admin.id, detalle: { origen: 'script' } });
    return { restablecido: true };
}

/** Comprobación de integridad: exactamente un administrador y el índice que lo garantiza */
export async function comprobarIntegridadAdminBD() {
    const total = await contarAdminsBD();
    const indices = await Usuario.collection.indexes().catch(() => []);
    const indice = indices.find((i) => i.name === 'administrador_unico');
    return { administradores: total, unico: total === 1, indiceUnico: Boolean(indice?.unique && indice?.partialFilterExpression?.rol === 'admin') };
}

// ====================================================================== cuentas
/**
 * Listado paginado de cuentas (nunca la del administrador).
 * q: texto en nombre o correo, o un id exacto (24 hex). estado: activa | suspendida | sin_verificar | menor_pendiente.
 */
export async function listarCuentasBD({ q = '', estado = '', pagina = 1 } = {}) {
    const filtro = { ...SOLO_USUARIOS };
    if (estado === 'activa') Object.assign(filtro, { estado: confiable({ $ne: 'suspendida' }), emailVerificado: confiable({ $ne: false }) });
    else if (estado === 'suspendida') filtro.estado = 'suspendida';
    else if (estado === 'sin_verificar') filtro.emailVerificado = false;
    else if (estado === 'menor_pendiente') filtro['representanteLegal.estado'] = 'pendiente';
    if (q) {
        if (/^[a-f0-9]{24}$/.test(q)) filtro.id = q;
        else {
            // Texto literal (escapado), sin distinguir mayúsculas: la búsqueda nunca es una expresión regular del usuario
            const rx = { $regex: escaparRegex(q), $options: 'i' };
            filtro.$or = confiable([{ nombre: confiable({ ...rx }) }, { email: confiable({ ...rx }) }]);
        }
    }
    const [total, lista] = await Promise.all([
        Usuario.countDocuments(filtro),
        Usuario.find(filtro).select(CAMPOS_LISTADO).sort({ creado: -1 }).skip((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).lean()
    ]);
    return { total, pagina, porPagina: POR_PAGINA, cuentas: lista.map(cuentaParaAdmin) };
}

/** Una cuenta con conteos de uso (sin contenido) y sus últimas acciones administrativas */
export async function detalleCuentaBD(id) {
    if (!esTexto(id, 64)) return null;
    const u = await Usuario.findOne({ id, ...SOLO_USUARIOS }).select(CAMPOS_LISTADO).lean();
    if (!u) return null;
    const [actividades, proyectos, temasEstudio, checkins, sesionesAbiertas, acciones] = await Promise.all([
        Actividad.countDocuments({ userId: id, eliminadaEn: null }),
        Actividad.distinct('proyecto', { userId: id, eliminadaEn: null, proyecto: confiable({ $nin: ['', null] }) }).then((l) => l.length),
        Objetivo.countDocuments({ userId: id }),
        Checkin.countDocuments({ userId: id }),
        Sesion.countDocuments({ userId: id, expira: confiable({ $gt: new Date() }) }),
        Auditoria.find({ cuentaId: id }).select('-_id').sort({ fecha: -1 }).limit(10).lean()
    ]);
    return { ...cuentaParaAdmin(u), uso: { actividades, proyectos, temasEstudio, checkins, sesionesAbiertas }, acciones };
}

/** Suspende (solo cuentas de rol «usuario») y cierra TODAS sus sesiones */
export async function suspenderCuentaBD(id, { motivo, hasta = null }) {
    if (!esTexto(id, 64)) return null;
    const r = await Usuario.updateOne({ id, ...SOLO_USUARIOS }, { $set: { estado: 'suspendida', suspension: { motivo, desde: new Date(), hasta } } });
    if (!r.matchedCount) return null;
    await Sesion.deleteMany({ userId: id });
    return true;
}

export async function reactivarCuentaBD(id) {
    if (!esTexto(id, 64)) return null;
    const r = await Usuario.updateOne({ id, ...SOLO_USUARIOS, estado: 'suspendida' }, { $set: { estado: 'activa' }, $unset: { suspension: '' } });
    return r.matchedCount ? true : (await Usuario.exists({ id, ...SOLO_USUARIOS }) ? false : null);
}

export async function cerrarSesionesCuentaBD(id) {
    if (!esTexto(id, 64) || !await Usuario.exists({ id, ...SOLO_USUARIOS })) return null;
    const r = await Sesion.deleteMany({ userId: id });
    return r.deletedCount;
}

/** ¿Es una cuenta normal (no administración)? Para comprobar antes de eliminar. */
export async function esCuentaDeUsuarioBD(id) {
    if (!esTexto(id, 64)) return null;
    return Usuario.findOne({ id, ...SOLO_USUARIOS }).select('id email').lean();
}

export async function resumenAdminBD() {
    const hace7 = new Date(Date.now() - 7 * 86400000);
    const [total, suspendidas, sinVerificar, menoresPendientes, nuevas7d, activas7d] = await Promise.all([
        Usuario.countDocuments(SOLO_USUARIOS),
        Usuario.countDocuments({ ...SOLO_USUARIOS, estado: 'suspendida' }),
        Usuario.countDocuments({ ...SOLO_USUARIOS, emailVerificado: false }),
        Usuario.countDocuments({ ...SOLO_USUARIOS, 'representanteLegal.estado': 'pendiente' }),
        Usuario.countDocuments({ ...SOLO_USUARIOS, creado: confiable({ $gte: hace7 }) }),
        Usuario.countDocuments({ ...SOLO_USUARIOS, ultimoAcceso: confiable({ $gte: hace7 }) })
    ]);
    return { total, suspendidas, sinVerificar, menoresPendientes, nuevas7d, activas7d, integridad: await comprobarIntegridadAdminBD() };
}

/** Suspensiones temporales vencidas → se reactivan solas (lo llaman el inicio de sesión y el panel) */
export async function reactivarSuspensionesVencidasBD(ahora = new Date()) {
    const r = await Usuario.updateMany({ ...SOLO_USUARIOS, estado: 'suspendida', 'suspension.hasta': confiable({ $ne: null, $lte: ahora }) },
        { $set: { estado: 'activa' }, $unset: { suspension: '' } });
    return r.modifiedCount;
}

// ====================================================================== auditoría
export async function registrarAuditoriaBD({ accion, adminId, cuentaId = null, detalle = {} }) {
    await Auditoria.create({ id: nuevoId(), accion, adminId, cuentaId, detalle, fecha: new Date() });
}

export async function listarAuditoriaBD({ pagina = 1 } = {}) {
    const [total, lista] = await Promise.all([
        Auditoria.countDocuments({}),
        Auditoria.find({}).select('-_id').sort({ fecha: -1 }).skip((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).lean()
    ]);
    return { total, pagina, porPagina: POR_PAGINA, acciones: lista };
}

// ====================================================================== sesión: último acceso
/** Actualiza ultimoAcceso como mucho una vez por hora (no escribe en cada petición) */
export async function tocarUltimoAccesoBD(id, ahora = new Date()) {
    if (!esTexto(id, 64)) return;
    const hace1h = new Date(ahora.getTime() - 3600000);
    // $not + $gte también incluye los documentos sin el campo o con null (cuentas que nunca entraron)
    await Usuario.updateOne({ id, ultimoAcceso: confiable({ $not: { $gte: hace1h } }) }, { $set: { ultimoAcceso: ahora } });
}
