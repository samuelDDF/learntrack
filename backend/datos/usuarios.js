// Colección "usuarios" (cuenta y perfil) y "avatares" (foto). También la baja completa de una cuenta.
import Usuario, { TEMAS, SERVICIOS } from '../modelos/Usuario.js';
import Avatar from '../modelos/Avatar.js';
import Sesion from '../modelos/Sesion.js';
import Actividad from '../modelos/Actividad.js';
import Historial from '../modelos/Historial.js';
import Checkin from '../modelos/Checkin.js';
import Propuesta from '../modelos/Propuesta.js';
import Operacion from '../modelos/Operacion.js';
import Mensaje from '../modelos/Mensaje.js';
import { esTexto } from './utilidades.js';

const SIN_SECRETOS = '-_id -passwordHash';

export async function buscarUsuarioPorEmail(email) {
    if (!esTexto(email, 254)) return null;
    return Usuario.findOne({ email }).select('-_id').lean();
}

export async function buscarUsuarioPorId(id) {
    if (!esTexto(id)) return null;
    return Usuario.findOne({ id }).select(SIN_SECRETOS).lean();
}

/** Devuelve null si el correo ya existe (índice único) */
export async function crearUsuarioBD(usuario) {
    try {
        await Usuario.create(usuario);
        return usuario;
    } catch (e) {
        if (e?.code === 11000) return null;
        throw e;
    }
}

export async function obtenerPasswordHashBD(id) {
    if (!esTexto(id)) return null;
    return (await Usuario.findOne({ id }).select('passwordHash').lean())?.passwordHash ?? null;
}

// ====== Perfil ======
/** Rellena los valores por defecto (los usuarios anteriores a v3.1 no tienen estos campos y .lean() no los aplica) */
function perfilPublico(u) {
    const cuenta = (c) => ({ vinculada: Boolean(c?.vinculada), vinculadaEn: c?.vinculadaEn ?? null, cuentaExterna: c?.cuentaExterna ?? '' });
    return {
        id: u.id, nombre: u.nombre, email: u.email, creado: u.creado ?? null,
        temaEstetico: TEMAS.includes(u.temaEstetico) ? u.temaEstetico : 'tech-focus',
        notificacionesActivas: u.notificacionesActivas ?? true,
        preferenciasNotificaciones: {
            alertasTareas: u.preferenciasNotificaciones?.alertasTareas ?? true,
            recordatoriosIA: u.preferenciasNotificaciones?.recordatoriosIA ?? true
        },
        cuentasVinculadas: Object.fromEntries(SERVICIOS.map((s) => [s, cuenta(u.cuentasVinculadas?.[s])])),
        avatarActualizado: u.avatarActualizado ?? null
    };
}

/** Aplica un $set al usuario y devuelve su perfil público (o null si no existe) */
async function actualizarYDevolverPerfil(id, $set, opciones = {}) {
    const u = await Usuario.findOneAndUpdate({ id }, { $set }, { new: true, ...opciones }).select(SIN_SECRETOS).lean();
    return u ? perfilPublico(u) : null;
}

export async function obtenerPerfilBD(id) {
    if (!esTexto(id)) return null;
    const u = await Usuario.findOne({ id }).select(SIN_SECRETOS).lean();
    return u ? perfilPublico(u) : null;
}

/**
 * Aplica SOLO los campos recibidos ($set con rutas): no pisa los demás. `cambios` ya viene validado.
 * Devuelve el perfil actualizado, o 'email_duplicado' si el correo ya pertenece a otra cuenta.
 */
export async function actualizarPerfilBD(id, cambios) {
    if (!esTexto(id)) return null;
    const $set = {};
    for (const [k, v] of Object.entries(cambios)) {
        if (k === 'preferenciasNotificaciones') for (const [pk, pv] of Object.entries(v)) $set[`preferenciasNotificaciones.${pk}`] = pv;
        else $set[k] = v;
    }
    if (Object.keys($set).length === 0) return obtenerPerfilBD(id);
    try {
        return await actualizarYDevolverPerfil(id, $set, { runValidators: true });
    } catch (e) {
        if (e?.code === 11000) return 'email_duplicado';
        throw e;
    }
}

/** Marca (o desmarca) un servicio externo. Devuelve el perfil actualizado. */
export async function fijarCuentaVinculadaBD(id, servicio, { vinculada, cuentaExterna = '' }) {
    if (!esTexto(id) || !SERVICIOS.includes(servicio)) return null;
    return actualizarYDevolverPerfil(id, {
        [`cuentasVinculadas.${servicio}.vinculada`]: vinculada,
        [`cuentasVinculadas.${servicio}.vinculadaEn`]: vinculada ? new Date() : null,
        [`cuentasVinculadas.${servicio}.cuentaExterna`]: vinculada ? cuentaExterna : ''
    });
}

// ====== Foto de perfil ======
export async function guardarAvatarBD(userId, tipo, datos) {
    if (!esTexto(userId)) return null;
    const ahora = new Date();
    await Avatar.findOneAndUpdate({ userId }, { $set: { tipo, datos, actualizado: ahora } }, { upsert: true });
    await Usuario.updateOne({ id: userId }, { $set: { avatarActualizado: ahora } });
    return ahora;
}
export async function obtenerAvatarBD(userId) {
    if (!esTexto(userId)) return null;
    // Sin .lean(): así `datos` llega como Buffer de Node (con lean sería un Binary de BSON)
    const a = await Avatar.findOne({ userId }).select('tipo datos actualizado');
    return a ? { tipo: a.tipo, datos: a.datos, actualizado: a.actualizado } : null;
}
export async function borrarAvatarBD(userId) {
    if (!esTexto(userId)) return;
    await Avatar.deleteMany({ userId });
    await Usuario.updateOne({ id: userId }, { $set: { avatarActualizado: null } });
}

// ====== Baja ======
/**
 * Borra la cuenta y TODOS sus datos. El usuario se borra al final: si algo falla a medias, el usuario puede
 * repetir la baja (cada paso es idempotente) en lugar de quedar con datos huérfanos y sin cuenta.
 */
export async function eliminarCuentaBD(id) {
    if (!esTexto(id)) return false;
    const u = await Usuario.findOne({ id }).select('email').lean();
    if (!u) return false;
    await Sesion.deleteMany({ userId: id });
    for (const modelo of [Actividad, Historial, Checkin, Propuesta, Operacion, Avatar]) await modelo.deleteMany({ userId: id });
    await Mensaje.deleteMany({ email: u.email });
    await Usuario.deleteOne({ id });
    return true;
}
