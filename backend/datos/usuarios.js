// Colección "usuarios" (cuenta, perfil, apariencia, voz y festivos importados), "avatares" (foto) y "fondos"
// (imagen de fondo). También la baja completa de una cuenta.
import Usuario, { TEMAS, SERVICIOS, MAX_FESTIVOS, NOMBRE_IA_PREDETERMINADO } from '../modelos/Usuario.js';
import Avatar from '../modelos/Avatar.js';
import Fondo from '../modelos/Fondo.js';
import Sesion from '../modelos/Sesion.js';
import Actividad from '../modelos/Actividad.js';
import Historial from '../modelos/Historial.js';
import Checkin from '../modelos/Checkin.js';
import Propuesta from '../modelos/Propuesta.js';
import Operacion from '../modelos/Operacion.js';
import Mensaje from '../modelos/Mensaje.js';
import Objetivo from '../modelos/Objetivo.js';
import { esTexto, confiable } from './utilidades.js';
import { variablesDePaleta } from '../../compartido/paleta.js';

// Los festivos importados pueden ser cientos: no se cargan en cada petición (sesión, perfil).
// verificacionEmail (hash del código y del token) nunca sale de las funciones de datos/verificacion.js.
const SIN_SECRETOS = '-_id -passwordHash -eventosImportados -verificacionEmail -pendienteHasta -representanteLegal.tokenHash';

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
/**
 * Apariencia lista para aplicar: tema, paleta propia (y sus variables CSS ya calculadas) y fondo. La usan la
 * página de Configuración y /api/auth/me (tema-inicial.js la aplica en todas las páginas privadas).
 */
export function aparienciaDe(u) {
    const tema = TEMAS.includes(u.temaSeleccionado) ? u.temaSeleccionado : 'tech-focus';
    const colores = Array.isArray(u.coloresPersonalizados) && u.coloresPersonalizados.length === 5 ? u.coloresPersonalizados : null;
    return {
        temaSeleccionado: tema === 'personalizado' && !colores ? 'tech-focus' : tema,
        coloresPersonalizados: colores,
        variablesTema: tema === 'personalizado' && colores ? variablesDePaleta(colores) : null,
        imagenFondoUrl: u.imagenFondoUrl ?? null
    };
}

/** Rellena los valores por defecto (los usuarios anteriores a v3.1 no tienen estos campos y .lean() no los aplica) */
function perfilPublico(u) {
    const cuenta = (c) => ({ vinculada: Boolean(c?.vinculada), vinculadaEn: c?.vinculadaEn ?? null, cuentaExterna: c?.cuentaExterna ?? '' });
    return {
        id: u.id, nombre: u.nombre, email: u.email, creado: u.creado ?? null,
        ...aparienciaDe(u),
        vozAsistente: u.vozAsistente ?? '',
        nombreIA: u.nombreIA || NOMBRE_IA_PREDETERMINADO,
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

// ====== Imágenes del usuario: foto de perfil (avatares) y fondo (fondos) ======
const IMAGENES = {
    avatar: { modelo: Avatar, enUsuario: (ahora) => ({ avatarActualizado: ahora }) },
    fondo: { modelo: Fondo, enUsuario: (ahora) => ({ imagenFondoUrl: ahora ? `/api/perfil/fondo?v=${ahora.getTime()}` : null }) }
};

/** Guarda (o reemplaza) la imagen y anota en el usuario la fecha o la ruta nueva */
export async function guardarImagenBD(clase, userId, tipo, datos) {
    if (!esTexto(userId)) return null;
    const { modelo, enUsuario } = IMAGENES[clase];
    const ahora = new Date();
    await modelo.findOneAndUpdate({ userId }, { $set: { tipo, datos, actualizado: ahora } }, { upsert: true });
    await Usuario.updateOne({ id: userId }, { $set: enUsuario(ahora) });
    return ahora;
}
export async function obtenerImagenBD(clase, userId) {
    if (!esTexto(userId)) return null;
    // Sin .lean(): así `datos` llega como Buffer de Node (con lean sería un Binary de BSON)
    const a = await IMAGENES[clase].modelo.findOne({ userId }).select('tipo datos actualizado');
    return a ? { tipo: a.tipo, datos: a.datos, actualizado: a.actualizado } : null;
}
export async function borrarImagenBD(clase, userId) {
    if (!esTexto(userId)) return;
    await IMAGENES[clase].modelo.deleteMany({ userId });
    await Usuario.updateOne({ id: userId }, { $set: IMAGENES[clase].enUsuario(null) });
}

// ====== Festivos importados (separados de las actividades) ======
/** id determinista: el mismo festivo importado dos veces tiene el mismo id (así no se duplica) */
export const idFestivo = ({ pais, region, fecha, nombre }) =>
    `${pais}-${region ?? 'nac'}-${fecha}-${nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;

/**
 * FUSIÓN de festivos: solo AÑADE los que el usuario no tenía. Cada uno se inserta con una actualización atómica
 * «push si su id no está ya» ({ 'eventosImportados.id': { $ne: id } }), así dos importaciones simultáneas tampoco
 * duplican. No toca la colección de actividades ni los festivos que ya existían.
 * Devuelve { añadidos, yaExistian, limite }.
 */
export async function importarFestivosBD(userId, festivos) {
    if (!esTexto(userId)) return null;
    const actual = await Usuario.findOne({ id: userId }).select('eventosImportados.id').lean();
    if (!actual) return null;
    const existentes = new Set((actual.eventosImportados ?? []).map((e) => e.id));
    const nuevos = [];
    for (const f of festivos) {
        const evento = { ...f, id: idFestivo(f), tipo: 'festivo', fuente: 'nager.date', importadoEn: new Date() };
        if (!existentes.has(evento.id) && !nuevos.some((n) => n.id === evento.id)) nuevos.push(evento);
    }
    const hueco = Math.max(0, MAX_FESTIVOS - existentes.size);
    const aInsertar = nuevos.slice(0, hueco);
    let añadidos = 0;
    for (const evento of aInsertar) {
        const r = await Usuario.updateOne({ id: userId, 'eventosImportados.id': confiable({ $ne: evento.id }) }, { $push: { eventosImportados: evento } }, { runValidators: true });
        añadidos += r.modifiedCount;
    }
    return { añadidos, yaExistian: festivos.length - nuevos.length + (aInsertar.length - añadidos), limite: nuevos.length > hueco };
}

/** Festivos del usuario entre dos fechas (incluidas) */
export async function obtenerFestivosBD(userId, desde = '0000-01-01', hasta = '9999-12-31') {
    if (!esTexto(userId)) return [];
    const u = await Usuario.findOne({ id: userId }).select('eventosImportados').lean();
    return (u?.eventosImportados ?? [])
        .filter((e) => e.fecha >= desde && e.fecha <= hasta)
        .map(({ id, tipo, fecha, nombre, nombreIngles, pais, region }) => ({ id, tipo, fecha, nombre, nombreIngles, pais, region }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Quita festivos importados (todos o los de un país). Las actividades no se tocan. Devuelve cuántos quitó. */
export async function eliminarFestivosBD(userId, pais = null) {
    if (!esTexto(userId)) return 0;
    const antes = (await obtenerFestivosBD(userId)).length;
    await Usuario.updateOne({ id: userId }, pais ? { $pull: { eventosImportados: { pais } } } : { $set: { eventosImportados: [] } });
    return antes - (await obtenerFestivosBD(userId)).length;
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
    for (const modelo of [Actividad, Historial, Checkin, Propuesta, Operacion, Avatar, Fondo, Objetivo]) await modelo.deleteMany({ userId: id });
    await Mensaje.deleteMany({ email: u.email });
    await Usuario.deleteOne({ id });
    return true;
}

// ====== Migración (se ejecuta al arrancar; idempotente) ======
/** v3.2 guardaba el tema en `temaEstetico`; ahora se llama `temaSeleccionado` */
export async function migrarTemaAntiguoBD() {
    const antiguos = await Usuario.collection.find({ temaEstetico: { $exists: true } }, { projection: { _id: 1, temaEstetico: 1, temaSeleccionado: 1 } }).toArray();
    for (const u of antiguos) {
        const tema = TEMAS.includes(u.temaEstetico) ? u.temaEstetico : 'tech-focus';
        await Usuario.collection.updateOne({ _id: u._id }, { $set: { temaSeleccionado: u.temaSeleccionado ?? tema }, $unset: { temaEstetico: '' } });
    }
    return { migrados: antiguos.length };
}
