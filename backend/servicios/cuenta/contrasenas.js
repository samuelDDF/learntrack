// Contraseñas con scrypt (nativo de Node: sin dependencias). Formato guardado: scrypt$N$r$p$sal$hash
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
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
    const calculado = await scrypt(password, Buffer.from(salt, 'base64'), esperado.length, { N: Number(n), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(calculado, esperado);
}

// Hash falso para gastar el mismo tiempo cuando el correo no existe (evita adivinar cuentas por latencia)
let hashFalso;
export async function gastarTiempoDeLogin(password) {
    hashFalso ??= await hashPassword('contraseña-falsa-para-igualar-tiempos');
    await verificarPassword(password, hashFalso);
}
