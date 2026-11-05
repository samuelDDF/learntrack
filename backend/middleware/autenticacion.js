// Sesiones: cookie HttpOnly con un token aleatorio; en la base de datos solo se guarda su SHA-256.
// También las reglas que protegen la API, las páginas privadas y sus archivos.
import crypto from 'crypto';
import { buscarSesionBD, buscarUsuarioPorId, crearSesionBD, eliminarSesionBD } from '../datos/index.js';

const NOMBRE_COOKIE = 'lt_sid';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const opcionesCookie = (extra = '') => `Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}${extra}`;

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
            if (usuario) {
                req.usuario = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, temaEstetico: usuario.temaEstetico ?? 'tech-focus' };
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

/** Página privada: sin sesión → al inicio con el formulario de acceso abierto */
export function requiereSesionPagina(req, res, next) {
    if (!req.usuario) return res.redirect('/?acceso=login');
    next();
}

/** Archivo privado (JS, CSS, HTML de /app): sin sesión → 401 */
export function requiereSesionRecurso(req, res, next) {
    if (!req.usuario) return res.status(401).type('text/plain').send('No autorizado');
    next();
}
