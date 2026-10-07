import crypto from 'crypto';
import { promisify } from 'util';
import { buscarSesionBD, buscarUsuarioPorId, crearSesionBD, eliminarSesionBD } from './database.js';

const scrypt = promisify(crypto.scrypt);

// ====== CONTRASEÑAS (scrypt, nativo de Node: sin dependencias) ======
const N = 16384, R = 8, P = 1, LONGITUD = 64;

export async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, LONGITUD, { N, r: R, p: P });
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarPassword(password, almacenado) {
    const [alg, n, r, p, salt, hash] = String(almacenado).split('$');
    if (alg !== 'scrypt' || !salt || !hash) return false;
    const esperado = Buffer.from(hash, 'base64');
    const calculado = await scrypt(password, Buffer.from(salt, 'base64'), esperado.length, {
        N: Number(n), r: Number(r), p: Number(p)
    });
    return crypto.timingSafeEqual(calculado, esperado);
}

// Hash falso para gastar el mismo tiempo cuando el correo no existe (evita adivinar cuentas por latencia)
let hashFalso;
export async function gastarTiempoDeLogin(password) {
    hashFalso ??= await hashPassword('contraseña-falsa-para-igualar-tiempos');
    await verificarPassword(password, hashFalso);
}

// ====== SESIONES (cookie HttpOnly con token aleatorio; en la base de datos solo se guarda su SHA-256) ======
const NOMBRE_COOKIE = 'lt_sid';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const esProduccion = () => process.env.NODE_ENV === 'production';

function opcionesCookie(extra = '') {
    return `Path=/; HttpOnly; SameSite=Strict${esProduccion() ? '; Secure' : ''}${extra}`;
}

export async function iniciarSesion(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await crearSesionBD({ tokenHash: sha256(token), userId, expira: new Date(Date.now() + DURACION_MS) });
    res.append('Set-Cookie', `${NOMBRE_COOKIE}=${token}; ${opcionesCookie(`; Max-Age=${DURACION_MS / 1000}`)}`);
}

export async function cerrarSesion(req, res) {
    const token = leerCookie(req, NOMBRE_COOKIE);
    if (token) await eliminarSesionBD(sha256(token));
    res.append('Set-Cookie', `${NOMBRE_COOKIE}=; ${opcionesCookie('; Max-Age=0')}`);
}

function leerCookie(req, nombre) {
    const cabecera = req.headers.cookie;
    if (!cabecera) return null;
    for (const par of cabecera.split(';')) {
        const i = par.indexOf('=');
        if (i > 0 && par.slice(0, i).trim() === nombre) return par.slice(i + 1).trim();
    }
    return null;
}

// Adjunta req.usuario si hay una sesión válida (no bloquea la petición)
export async function cargarSesion(req, res, next) {
    req.usuario = null;
    const token = leerCookie(req, NOMBRE_COOKIE);
    if (token && token.length < 100) {
        try {
            const sesion = await buscarSesionBD(sha256(token));
            const usuario = sesion && await buscarUsuarioPorId(sesion.userId);
            if (usuario) req.usuario = { id: usuario.id, nombre: usuario.nombre, email: usuario.email };
        } catch (e) {
            // Si la BD no responde se trata como "sin sesión" (falla cerrado) en vez de tumbar también las páginas públicas
            console.error('No se pudo comprobar la sesión:', e.message);
        }
    }
    next();
}

export function requiereAuthApi(req, res, next) {
    if (!req.usuario) return res.status(401).json({ error: 'Debes iniciar sesión.' });
    next();
}

// Para páginas y scripts privados: sin sesión se redirige al inicio con el formulario abierto
export function requiereAuthPagina(req, res, next) {
    if (req.usuario) return next();
    if (req.path.endsWith('.html')) return res.redirect('/?acceso=login');
    res.status(401).type('text/plain').send('No autorizado');
}

// Protección CSRF adicional a SameSite=Strict: si el navegador envía Origin en una petición que
// modifica datos, debe coincidir con el propio sitio o con un origen permitido.
export function verificarOrigen(origenesPermitidos) {
    return (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        const origen = req.get('origin');
        if (!origen) return next();
        const propio = `${req.protocol}://${req.get('host')}`;
        if (origen === propio || origenesPermitidos.includes(origen)) return next();
        res.status(403).json({ error: 'Origen no permitido.' });
    };
}
