// Sesiones: cookie HttpOnly con un token aleatorio; en la base de datos solo se guarda su SHA-256.
// También las reglas que protegen la API, las páginas privadas y sus archivos.
import crypto from 'crypto';
import { buscarSesionBD, buscarUsuarioPorId, crearSesionBD, eliminarSesionBD, aparienciaDe } from '../datos/index.js';
import { NOMBRE_IA_PREDETERMINADO } from '../modelos/Usuario.js';
import { NOMBRE_COOKIE_VERIFICACION, VIDA_TOKEN_MS, puedeEntrar } from '../servicios/cuenta/verificacion-correo.js';

const NOMBRE_COOKIE = 'lt_sid';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

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

export async function iniciarSesion(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await crearSesionBD({ tokenHash: sha256(token), userId, expira: new Date(Date.now() + DURACION_MS) });
    res.append('Set-Cookie', `${NOMBRE_COOKIE}=${token}; ${opcionesCookie(`; Max-Age=${DURACION_MS / 1000}`)}`);
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
            const usuario = sesion && await buscarUsuarioPorId(sesion.userId);
            // v3.10: una cuenta sin el correo verificado NUNCA tiene sesión, aunque existiera una cookie válida
            // (por ejemplo, una cuenta antigua cuando VERIFICACION_CUENTAS_ANTIGUAS=exigir). Se comprueba aquí, en
            // cada petición y en el servidor: tocar el navegador no sirve para saltársela.
            if (usuario && puedeEntrar(usuario)) {
                req.usuario = {
                    id: usuario.id, nombre: usuario.nombre, email: usuario.email,
                    ...aparienciaDe(usuario), vozAsistente: usuario.vozAsistente ?? '',
                    nombreIA: usuario.nombreIA || NOMBRE_IA_PREDETERMINADO,
                    avatarUrl: usuario.avatarActualizado ? `/api/perfil/avatar?v=${new Date(usuario.avatarActualizado).getTime()}` : null
                };
                req.tokenHash = sha256(token);
            }
        } catch (e) {
            // Si la BD no responde se trata como "sin sesión" (falla cerrado) en vez de tumbar también las páginas públicas
            console.error('No se pudo comprobar la sesión:', e.message);
        }
    }
    next();
}

/** API privada: sin sesión → 401 */
export function requiereAuthApi(req, res, next) {
    if (!req.usuario) return res.status(401).json({ error: 'Debes iniciar sesión.' });
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
