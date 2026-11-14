// Verificación del correo (v3.10): operaciones ATÓMICAS sobre la colección "usuarios".
// Cada escritura repite en el filtro lo que se comprobó al leer (concurrencia optimista): si dos peticiones llegan a
// la vez (doble clic, dos pestañas, reenvíos simultáneos), solo una coincide y la otra no cambia nada.
import Usuario from '../modelos/Usuario.js';
import { esTexto, confiable } from './utilidades.js';

const SIN_VERIFICAR = { emailVerificado: confiable({ $ne: true }) };      // pendientes y cuentas antiguas que deben verificar
const CAMPOS = 'id nombre email emailVerificado verificacionEmail';

/** Crea la cuenta PENDIENTE (emailVerificado: false). null si el correo ya existe (índice único). */
export async function crearPendienteBD(datos) {
    try {
        await Usuario.create({ ...datos, emailVerificado: false });
        return true;
    } catch (e) {
        if (e?.code === 11000) return null;
        throw e;
    }
}

/**
 * Sustituye la verificación de una cuenta sin verificar SOLO si nadie la cambió desde que se leyó
 * (`ultimoEnvioPrevio` es el valor leído). `extra` permite actualizar nombre y contraseña al repetir el registro.
 * @returns {Promise<boolean>} true si se aplicó
 */
export async function reemplazarVerificacionBD(id, ultimoEnvioPrevio, verificacion, extra = {}) {
    if (!esTexto(id)) return false;
    const r = await Usuario.updateOne(
        { id, ...SIN_VERIFICAR, 'verificacionEmail.ultimoEnvio': ultimoEnvioPrevio ?? null },
        { $set: { ...extra, verificacionEmail: verificacion } }
    );
    return r.modifiedCount === 1;
}

/**
 * Renueva solo el token del navegador (inicio de sesión de una cuenta pendiente que no necesita código nuevo).
 * Requiere que exista una verificación en curso (el subdocumento).
 */
export async function renovarTokenBD(id, tokenHash, tokenExpira) {
    if (!esTexto(id)) return false;
    const r = await Usuario.updateOne({ id, ...SIN_VERIFICAR, verificacionEmail: confiable({ $ne: null }) },
        { $set: { 'verificacionEmail.tokenHash': tokenHash, 'verificacionEmail.tokenExpira': tokenExpira } });
    return r.modifiedCount === 1;
}

/** Registro repetido desde el MISMO navegador: aplica el nombre y la contraseña nuevos sin generar otro código */
export async function actualizarPendienteBD(id, { nombre, passwordHash, pendienteHasta }) {
    if (!esTexto(id)) return false;
    const r = await Usuario.updateOne({ id, emailVerificado: false }, { $set: { nombre, passwordHash, pendienteHasta } });
    return r.matchedCount === 1;
}

/** La verificación en curso de ESTE navegador (por el hash del token de su cookie), o null */
export async function pendientePorTokenBD(tokenHash, ahora = new Date()) {
    if (!esTexto(tokenHash, 64)) return null;
    return Usuario.findOne({
        'verificacionEmail.tokenHash': tokenHash,
        'verificacionEmail.tokenExpira': confiable({ $gt: ahora }),
        ...SIN_VERIFICAR
    }).select(CAMPOS).lean();
}

/**
 * Gasta un intento ANTES de comparar el código. Solo si el código sigue siendo el mismo y quedan intentos.
 * @returns {Promise<boolean>}
 */
export async function reservarIntentoBD(id, codigoHash, maxIntentos) {
    const r = await Usuario.updateOne(
        { id, ...SIN_VERIFICAR, 'verificacionEmail.codigoHash': codigoHash, 'verificacionEmail.intentos': confiable({ $lt: maxIntentos }) },
        { $inc: { 'verificacionEmail.intentos': 1 } }
    );
    return r.modifiedCount === 1;
}

/** Anula el código (agotó los intentos): hay que pedir otro */
export async function anularCodigoBD(id, codigoHash) {
    await Usuario.updateOne({ id, 'verificacionEmail.codigoHash': codigoHash }, { $set: { 'verificacionEmail.codigoHash': null } });
}

/**
 * Marca el correo como verificado y borra TODO lo de la verificación (el código no puede volver a usarse).
 * Solo una petición puede ganar: el filtro exige el mismo código. Devuelve el usuario o null.
 */
export async function completarVerificacionBD(id, codigoHash, ahora = new Date()) {
    return Usuario.findOneAndUpdate(
        { id, ...SIN_VERIFICAR, 'verificacionEmail.codigoHash': codigoHash },
        { $set: { emailVerificado: true, emailVerificadoEn: ahora }, $unset: { verificacionEmail: '', pendienteHasta: '' } },
        { new: true }
    ).select('id nombre email').lean();
}

/** El correo no salió: el código no llegó a nadie, se anula y se permite reintentar sin esperar */
export async function anularEnvioBD(id, ultimoEnvio) {
    await Usuario.updateOne({ id, 'verificacionEmail.ultimoEnvio': ultimoEnvio },
        { $set: { 'verificacionEmail.codigoHash': null, 'verificacionEmail.ultimoEnvio': null }, $inc: { 'verificacionEmail.envios': -1 } });
}
