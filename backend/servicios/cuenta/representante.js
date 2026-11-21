// Autorización del representante legal de un menor de 14 a 17 años (v3.13).
// El enlace del correo lleva un token aleatorio en el FRAGMENTO (#t=…): el navegador nunca lo envía en la URL ni en
// el Referer; la página lo manda en el cuerpo de una petición POST. En la base de datos solo se guarda su SHA-256.
import crypto from 'crypto';

export const VIDA_ENLACE_MS = 7 * 24 * 60 * 60 * 1000;      // 7 días para decidir
const ESPERA_REENVIO_MS = 10 * 60 * 1000;                    // 10 minutos entre envíos
const MAX_ENVIOS = 5;

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
export function nuevoToken() {
    const token = crypto.randomBytes(32).toString('base64url');
    return { token, tokenHash: hashToken(token) };
}
export const esTokenValido = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(t);

/** ¿Se puede (re)enviar el correo al representante ahora? → { permitido, esperaS } */
export function permisoReenvio(representante, ahora = Date.now()) {
    if ((representante?.envios ?? 0) >= MAX_ENVIOS) return { permitido: false, esperaS: null, motivo: 'limite' };
    const ultimo = representante?.ultimoEnvio ? new Date(representante.ultimoEnvio).getTime() : 0;
    const espera = ultimo + ESPERA_REENVIO_MS - ahora;
    return espera > 0 ? { permitido: false, esperaS: Math.ceil(espera / 1000), motivo: 'espera' } : { permitido: true };
}

/** Correo oculto para mostrarlo al menor (a***@d***.com) */
export function ocultarCorreo(email) {
    const [u, d = ''] = String(email).split('@');
    const [dom, ...resto] = d.split('.');
    return `${u.slice(0, 1)}***@${dom.slice(0, 1)}***${resto.length ? `.${resto.join('.')}` : ''}`;
}

/** Lo que ve el menor sobre la autorización (sin el correo completo ni el token) */
export const estadoRepresentante = (r) => ({
    estado: r.estado, parentesco: r.parentesco, correo: ocultarCorreo(r.email),
    enviado: Boolean(r.ultimoEnvio), reenviable: permisoReenvio(r).permitido
});
