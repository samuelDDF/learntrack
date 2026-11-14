// Verificación del correo con un código de 6 dígitos (OTP) — v3.10.
//
//  · El código se genera con crypto.randomInt (CSPRNG). Nunca con Math.random().
//  · En MongoDB solo se guarda su hash: scrypt con sal aleatoria y el id del usuario como contexto
//    (scrypt$sal$hash). Así, aunque alguien leyera la base de datos, no podría usar el hash en otra cuenta, y
//    probar el millón de combinaciones le costaría tiempo de cálculo real. El código caduca en minutos.
//  · El código va LIGADO al navegador que se registró: el servidor pone una cookie temporal (lt_verif, HttpOnly,
//    SameSite=Strict) con un token aleatorio cuyo SHA-256 se guarda junto al código. Sin esa cookie no se puede
//    verificar ni reenviar: si otra persona registra tu correo (aunque ponga otra contraseña), no recibe el código y
//    no puede quedarse con la cuenta.
//  · Nada de esto aparece en respuestas ni en logs: ni el código, ni su hash, ni el token.
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const LONGITUD_HASH = 32;
const OPCIONES_SCRYPT = { N: 16384, r: 8, p: 1 };

export const NOMBRE_COOKIE_VERIFICACION = 'lt_verif';
/** Vida del token de verificación (la cookie): se renueva en cada registro, inicio de sesión o reenvío */
export const VIDA_TOKEN_MS = 60 * 60 * 1000;
/** Los registros que nunca se verifican se borran solos (índice TTL parcial) pasado este tiempo */
export const VIDA_REGISTRO_PENDIENTE_MS = 7 * 24 * 60 * 60 * 1000;

const entero = (valor, porDefecto, min, max) => {
    const n = Number.parseInt(valor, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : porDefecto;
};

/**
 * Configuración (se lee en cada uso, así las pruebas pueden cambiarla). Los valores se acotan a rangos seguros:
 * un .env con OTP_MAX_ATTEMPTS=1000 no desactiva la protección.
 */
export function configVerificacion(env = process.env) {
    const modo = String(env.VERIFICACION_CUENTAS_ANTIGUAS || 'permitir').trim().toLowerCase();
    return {
        minutos: entero(env.OTP_EXPIRATION_MINUTES, 10, 1, 60),
        maxIntentos: entero(env.OTP_MAX_ATTEMPTS, 5, 1, 10),
        esperaReenvioS: entero(env.OTP_RESEND_COOLDOWN_SECONDS, 60, 10, 3600),
        maxEnviosHora: entero(env.OTP_MAX_SENDS_PER_HOUR, 5, 1, 20),
        // Cuentas creadas ANTES de la v3.10 (sin el campo emailVerificado): ver puedeEntrar()
        cuentasAntiguas: modo === 'exigir' ? 'exigir' : 'permitir'
    };
}

/** Código de 6 dígitos uniforme (000000–999999) con el generador criptográfico de Node */
export const generarCodigo = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Formato exacto que acepta el servidor: 6 dígitos, nada más */
export const esCodigoValido = (codigo) => typeof codigo === 'string' && /^\d{6}$/.test(codigo);

/** Hash del código ligado al usuario: «scrypt$sal$hash» (base64) */
export async function hashCodigo(codigo, userId) {
    const sal = crypto.randomBytes(16);
    const hash = await scrypt(`${userId}:${codigo}`, sal, LONGITUD_HASH, OPCIONES_SCRYPT);
    return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

/** Compara en tiempo constante. Cualquier formato inesperado → false */
export async function codigoCoincide(codigo, almacenado, userId) {
    if (!esCodigoValido(codigo)) return false;
    const [alg, sal, hash] = String(almacenado ?? '').split('$');
    if (alg !== 'scrypt' || !sal || !hash) return false;
    const esperado = Buffer.from(hash, 'base64');
    if (esperado.length !== LONGITUD_HASH) return false;
    const calculado = await scrypt(`${userId}:${codigo}`, Buffer.from(sal, 'base64'), LONGITUD_HASH, OPCIONES_SCRYPT);
    return crypto.timingSafeEqual(calculado, esperado);
}

/** Token aleatorio de la cookie de verificación y su SHA-256 (lo único que se guarda) */
export function nuevoTokenVerificacion() {
    const token = crypto.randomBytes(32).toString('base64url');
    return { token, tokenHash: hashToken(token) };
}
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Correo parcialmente oculto: «usuario.prueba@gmail.com» → «usua***@gmail.com».
 * Se muestran como mucho 4 caracteres (y nunca más de la mitad) de la parte local; el dominio se deja visible para
 * que la persona reconozca a qué cuenta se envió.
 */
export function ocultarEmail(email) {
    const [local = '', dominio = ''] = String(email ?? '').split('@');
    if (!dominio) return '***';
    const visibles = Math.max(1, Math.min(4, Math.floor(local.length / 2)));
    return `${local.slice(0, visibles)}***@${dominio}`;
}

/**
 * ¿Puede esta cuenta tener una sesión normal? Regla ÚNICA que usan el inicio de sesión y cargarSesion (cada petición).
 *   emailVerificado === true  → sí (verificó con el código)
 *   emailVerificado === false → no (registro pendiente de verificar)
 *   campo ausente (cuenta anterior a la v3.10) → depende de VERIFICACION_CUENTAS_ANTIGUAS:
 *       permitir (por defecto): conserva el acceso, pero NO se marca como verificada
 *       exigir: debe verificar su correo en el próximo inicio de sesión
 */
export function puedeEntrar(usuario, config = configVerificacion()) {
    if (!usuario) return false;
    if (usuario.emailVerificado === true) return true;
    if (usuario.emailVerificado === false) return false;
    return config.cuentasAntiguas === 'permitir';
}

/** Estado público de una verificación en curso (lo que ve el navegador). Sin códigos, hashes ni tokens. */
export function estadoPublico(usuario, ahora = Date.now(), config = configVerificacion()) {
    const v = usuario.verificacionEmail ?? {};
    const expira = v.expira ? new Date(v.expira).getTime() : 0;
    const ultimo = v.ultimoEnvio ? new Date(v.ultimoEnvio).getTime() : 0;
    const activo = Boolean(v.codigoHash) && expira > ahora;
    return {
        emailOculto: ocultarEmail(usuario.email),
        codigoActivo: activo,
        expiraEnSegundos: activo ? Math.ceil((expira - ahora) / 1000) : 0,
        reenviarEnSegundos: ultimo ? Math.max(0, Math.ceil((ultimo + config.esperaReenvioS * 1000 - ahora) / 1000)) : 0,
        intentosRestantes: activo ? Math.max(0, config.maxIntentos - (v.intentos ?? 0)) : 0,
        minutosValidez: config.minutos
    };
}

const UNA_HORA_MS = 60 * 60 * 1000;

/**
 * ¿Se puede enviar otro código ahora? Aplica la espera entre envíos y el máximo de envíos por hora y correo.
 * @returns {{ permitido: true, enviosDesde: Date, envios: number } | { permitido: false, motivo: 'espera'|'limite', esperaS: number }}
 */
export function permisoEnvio(v, ahora = Date.now(), config = configVerificacion()) {
    const ultimo = v?.ultimoEnvio ? new Date(v.ultimoEnvio).getTime() : 0;
    const espera = ultimo ? ultimo + config.esperaReenvioS * 1000 - ahora : 0;
    if (espera > 0) return { permitido: false, motivo: 'espera', esperaS: Math.ceil(espera / 1000) };
    const desde = v?.enviosDesde ? new Date(v.enviosDesde).getTime() : 0;
    const enVentana = desde > 0 && ahora - desde < UNA_HORA_MS;
    const envios = enVentana ? (v.envios ?? 0) : 0;
    if (envios >= config.maxEnviosHora) return { permitido: false, motivo: 'limite', esperaS: Math.ceil((desde + UNA_HORA_MS - ahora) / 1000) };
    return { permitido: true, enviosDesde: new Date(enVentana ? desde : ahora), envios: envios + 1 };
}

/** Subdocumento verificacionEmail para un código recién generado (el anterior queda invalidado al sustituirlo) */
export function nuevaVerificacion({ codigoHash, tokenHash, permiso, ahora = Date.now(), config = configVerificacion() }) {
    return {
        codigoHash,
        expira: new Date(ahora + config.minutos * 60_000),
        intentos: 0,
        ultimoEnvio: new Date(ahora),
        enviosDesde: permiso.enviosDesde,
        envios: permiso.envios,
        tokenHash,
        tokenExpira: new Date(ahora + VIDA_TOKEN_MS)
    };
}

/** Texto para una espera: «45 s» o «12 min» */
export const textoEspera = (s) => (s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`);
