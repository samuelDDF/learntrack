// Sesiones: cookie HttpOnly con un token aleatorio; en la base de datos solo se guarda su SHA-256.
// También las reglas que protegen la API, las páginas privadas y sus archivos.
import crypto from 'crypto';
import { buscarSesionBD, buscarUsuarioPorId, crearSesionBD, eliminarSesionBD, aparienciaDe, tocarUltimoAccesoBD, reactivarSuspensionesVencidasBD } from '../datos/index.js';
import { NOMBRE_IA_PREDETERMINADO } from '../modelos/Usuario.js';
import { NOMBRE_COOKIE_VERIFICACION, VIDA_TOKEN_MS, puedeEntrar } from '../servicios/cuenta/verificacion-correo.js';
import { documentosPendientes, esperaRepresentante } from '../servicios/cuenta/legal.js';
import { ahoraEn } from '../servicios/tiempo.js';

const NOMBRE_COOKIE = 'lt_sid';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;
/** v3.13: la sesión de la cuenta de administración dura 8 horas (menos tiempo expuesta si se olvida abierta) */
export const DURACION_ADMIN_MS = 8 * 60 * 60 * 1000;

/** ¿La cuenta está suspendida AHORA? (una suspensión temporal vencida ya no cuenta) */
export const estaSuspendida = (u, ahora = new Date()) => u?.estado === 'suspendida' && !(u.suspension?.hasta && new Date(u.suspension.hasta) <= ahora);

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const opcionesCookie = (extra = '') => {
    const sameSite = String(process.env.COOKIE_SAME_SITE || 'Strict').trim();
    if (!['Strict', 'Lax', 'None'].includes(sameSite)) throw new Error('COOKIE_SAME_SITE debe ser Strict, Lax o None.');
    const secure = process.env.NODE_ENV === 'production' || sameSite === 'None';
    return `Path=/; HttpOnly; SameSite=${sameSite}${secure ? '; Secure' : ''}${extra}`;
};

function leerCookie(req, nombre) {
    for (const par of (req.headers.cookie ?? '').split(';')) {
        const i = par.indexOf('=');
        if (i > 0 && par.slice(0, i).trim() === nombre) return par.slice(i + 1).trim();
    }
    return null;
}

export async function iniciarSesion(res, userId, { duracionMs = DURACION_MS } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    await crearSesionBD({ tokenHash: sha256(token), userId, expira: new Date(Date.now() + duracionMs) });
    res.append('Set-Cookie', `${NOMBRE_COOKIE}=${token}; ${opcionesCookie(`; Max-Age=${Math.round(duracionMs / 1000)}`)}`);
}

// ---- Cookie TEMPORAL de verificación del correo (v3.10) ----
// Solo sirve para /api/auth/verificar-correo, /reenviar-codigo y /verificacion: NO es una sesión y no da acceso a
// nada privado (cargarSesion no la mira). Liga el código enviado por correo a este navegador.
export function ponerCookieVerificacion(res, token) {
    res.append('Set-Cookie', `${NOMBRE_COOKIE_VERIFICACION}=${token}; ${opcionesCookie(`; Max-Age=${VIDA_TOKEN_MS / 1000}`)}`);
}
export function borrarCookieVerificacion(res) {
    res.append('Set-Cookie', `${NOMBRE_COOKIE_VERIFICACION}=; ${opcionesCookie('; Max-Age=0')}`);
}
export function leerTokenVerificacion(req) {
    const token = leerCookie(req, NOMBRE_COOKIE_VERIFICACION);
    return token && token.length < 100 ? token : null;
}

/** Vacía la cookie de sesión (al cerrar sesión o eliminar la cuenta) */
export function borrarCookieSesion(res) {
    res.append('Set-Cookie', `${NOMBRE_COOKIE}=; ${opcionesCookie('; Max-Age=0')}`);
}

export async function cerrarSesion(req, res) {
    const token = leerCookie(req, NOMBRE_COOKIE);
    if (token) await eliminarSesionBD(sha256(token));
    borrarCookieSesion(res);
}

/** Adjunta req.usuario (y req.tokenHash) si hay una sesión válida. No bloquea la petición. */
export async function cargarSesion(req, res, next) {
    req.usuario = null;
    const token = leerCookie(req, NOMBRE_COOKIE);
    if (token && token.length < 100) {
        try {
            const sesion = await buscarSesionBD(sha256(token));
            let usuario = sesion && await buscarUsuarioPorId(sesion.userId);
            // v3.13: una suspensión vale en CADA petición (aunque la cookie siga viva). Si era temporal y ya venció,
            // la cuenta se reactiva sola; si sigue vigente, esta sesión se borra.
            if (usuario?.estado === 'suspendida' && !estaSuspendida(usuario)) {
                await reactivarSuspensionesVencidasBD();
                usuario = await buscarUsuarioPorId(sesion.userId);
            }
            if (estaSuspendida(usuario)) {
                await eliminarSesionBD(sha256(token));
                usuario = null;
            }
            // v3.10: una cuenta sin el correo verificado NUNCA tiene sesión, aunque existiera una cookie válida
            // (por ejemplo, una cuenta antigua cuando VERIFICACION_CUENTAS_ANTIGUAS=exigir). Se comprueba aquí, en
            // cada petición y en el servidor: tocar el navegador no sirve para saltársela.
            if (usuario && puedeEntrar(usuario)) {
                const esAdmin = usuario.rol === 'admin';
                req.usuario = {
                    id: usuario.id, nombre: usuario.nombre, email: usuario.email,
                    ...aparienciaDe(usuario), vozAsistente: usuario.vozAsistente ?? '',
                    nombreIA: usuario.nombreIA || NOMBRE_IA_PREDETERMINADO,
                    avatarUrl: usuario.avatarActualizado ? `/api/perfil/avatar?v=${new Date(usuario.avatarActualizado).getTime()}` : null,
                    // v3.13: el rol se lee de la base de datos en cada petición (nunca de la cookie ni del navegador)
                    rol: esAdmin ? 'admin' : 'usuario',
                    documentosPendientes: documentosPendientes(usuario),
                    esperaRepresentante: !esAdmin && esperaRepresentante(usuario, ahoraEn().fecha),
                    representanteLegal: usuario.representanteLegal ?? null
                };
                req.tokenHash = sha256(token);
                await tocarUltimoAccesoBD(usuario.id).catch(() => {});
            }
        } catch (e) {
            // Si la BD no responde se trata como "sin sesión" (falla cerrado) en vez de tumbar también las páginas públicas
            console.error('No se pudo comprobar la sesión:', e.message);
        }
    }
    next();
}

// Rutas de la API que una cuenta con algo PENDIENTE (aceptar documentos nuevos o la autorización del representante)
// sí puede usar: ver su perfil y eliminar su cuenta. Así nadie queda «atrapado» sin poder irse.
const PERMITIDAS_CON_PENDIENTES = new Set(['GET /api/perfil', 'DELETE /api/perfil', 'GET /api/perfil/avatar']);

/**
 * API privada de USUARIO:
 *  · sin sesión → 401;
 *  · cuenta de administración → 403 (es una cuenta solo de administración: no usa agenda, IA, etc.);
 *  · menor sin la autorización de su representante → 403 { codigo: 'autorizacion_representante' };
 *  · documentos legales sin aceptar (versión nueva) → 428 { codigo: 'aceptacion_pendiente', documentos }.
 */
export function requiereAuthApi(req, res, next) {
    if (!req.usuario) return res.status(401).json({ error: 'Debes iniciar sesión.' });
    if (req.usuario.rol === 'admin') return res.status(403).json({ error: 'La cuenta de administración solo tiene acceso al panel de administración.', codigo: 'solo_admin' });
    const clave = `${req.method} ${(req.baseUrl + req.path).replace(/\/+$/, '')}`;
    if (PERMITIDAS_CON_PENDIENTES.has(clave)) return next();
    if (req.usuario.esperaRepresentante) {
        return res.status(403).json({ error: 'Tu cuenta está esperando la autorización de tu madre, padre o representante legal.', codigo: 'autorizacion_representante' });
    }
    if (req.usuario.documentosPendientes.length) {
        return res.status(428).json({ error: 'Para continuar debes aceptar la versión vigente de los documentos legales.', codigo: 'aceptacion_pendiente', documentos: req.usuario.documentosPendientes });
    }
    next();
}

/**
 * API de ADMINISTRACIÓN: solo la cuenta con rol «admin» (leído de la base de datos en cargarSesion). A cualquier
 * otra persona, con o sin sesión, se le responde exactamente igual que a una ruta inexistente (404), para no revelar
 * que el panel existe. Las peticiones que modifican algo además deben traer la cabecera Origin (navegador) y JSON.
 */
export function requiereAdmin(req, res, next) {
    if (req.usuario?.rol !== 'admin') return res.status(404).json({ error: 'Ruta no encontrada.' });
    if (!['GET', 'HEAD'].includes(req.method) && (!req.get('origin') || !req.is('application/json'))) {
        return res.status(403).json({ error: 'Petición no permitida.' });
    }
    next();
}

/** Página privada: sin sesión → 302 a /login (o a /verificar-correo si hay una verificación del correo en curso) */
export function requiereSesionPagina(req, res, next) {
    if (!req.usuario) return res.redirect(leerTokenVerificacion(req) ? '/verificar-correo' : '/login');
    next();
}

/** Archivo privado (JS, CSS, HTML de /app): sin sesión → 401 */
export function requiereSesionRecurso(req, res, next) {
    if (!req.usuario) return res.status(401).type('text/plain').send('No autorizado');
    next();
}
