// Envío de correos (Nodemailer) — v3.10. Configuración SOLO por variables de entorno (.env), nunca en el código.
//
// Modos:
//   smtp           SMTP_HOST definido → se envía de verdad (Gmail, Outlook, Brevo, Mailgun, SES…)
//   archivo        sin SMTP_HOST y fuera de producción → el correo se GUARDA como .eml en correos-dev/ (desarrollo
//                  local sin servidor de correo). La carpeta está en .gitignore y fuera del ZIP. No se imprime el
//                  código en la consola: abre el .eml con tu cliente de correo o un editor de texto.
//   no_configurado sin SMTP_HOST en producción → el registro responde «no disponible» (nunca se finge un envío)
//
// Ni el código, ni el destinatario, ni las credenciales aparecen en los logs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { correoVerificacion, CID_LOGO } from './plantilla-verificacion.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOGO = path.join(RAIZ, 'frontend-react', 'public', 'recursos', 'iconos', 'pwa-192.png');
export const CARPETA_CORREOS_DEV = path.join(RAIZ, 'correos-dev');

export class ErrorCorreo extends Error {
    constructor(motivo) { super('No se pudo enviar el correo.'); this.name = 'ErrorCorreo'; this.motivo = motivo; }
}

const siNo = (valor, porDefecto) => {
    if (valor === undefined || valor === '') return porDefecto;
    return /^(1|true|si|sí|yes|on)$/i.test(String(valor).trim());
};

/** Configuración SMTP leída del entorno (sin exponer la contraseña fuera de este módulo) */
export function configCorreo(env = process.env) {
    const host = String(env.SMTP_HOST ?? '').trim();
    const produccion = env.NODE_ENV === 'production';
    if (!host) return { modo: produccion ? 'no_configurado' : 'archivo', remitente: 'LearnTrack <no-responder@learntrack.local>' };
    const secure = siNo(env.SMTP_SECURE, false);
    const port = Number.parseInt(env.SMTP_PORT, 10) || (secure ? 465 : 587);
    const user = String(env.SMTP_USER ?? '').trim();
    return {
        modo: 'smtp',
        host, port, secure, user,
        pass: env.SMTP_PASS ?? '',
        // En producción, si la conexión no es TLS directa, se EXIGE STARTTLS (la contraseña nunca viaja en claro)
        requireTLS: siNo(env.SMTP_REQUIRE_TLS, produccion && !secure),
        remitente: String(env.SMTP_FROM ?? '').trim() || (user ? `LearnTrack <${user}>` : 'LearnTrack <no-responder@learntrack.local>')
    };
}

let cache = { clave: '', transporte: null };
function transporteDe(c) {
    const clave = JSON.stringify([c.modo, c.host, c.port, c.secure, c.user, c.pass, c.requireTLS]);
    if (cache.clave === clave) return cache.transporte;
    const transporte = c.modo === 'smtp'
        ? nodemailer.createTransport({
            host: c.host, port: c.port, secure: c.secure, requireTLS: c.requireTLS,
            auth: c.user ? { user: c.user, pass: c.pass } : undefined,
            tls: { minVersion: 'TLSv1.2' },
            connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
            logger: false, debug: false
        })
        : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    cache = { clave, transporte };
    return transporte;
}

/** Descripción para el arranque del servidor (sin secretos) */
export function describirCorreo() {
    const c = configCorreo();
    if (c.modo === 'smtp') return `SMTP ${c.host}:${c.port}${c.secure ? ' (TLS)' : c.requireTLS ? ' (STARTTLS obligatorio)' : ''}`;
    if (c.modo === 'archivo') return 'sin SMTP: los correos se guardan en correos-dev/ (solo desarrollo)';
    return 'SIN CONFIGURAR: el registro de cuentas nuevas no está disponible (define SMTP_HOST en el .env)';
}

/** ¿Se pueden enviar correos? (en producción sin SMTP, no) */
export const correoDisponible = () => configCorreo().modo !== 'no_configurado';

/** Comprueba la conexión SMTP al arrancar (no bloquea; solo avisa). */
export async function comprobarCorreo() {
    const c = configCorreo();
    if (c.modo !== 'smtp') return null;
    try { await transporteDe(c).verify(); return true; } catch (e) { return e?.code || e?.name || 'error'; }
}

/**
 * Envía el código de verificación. Lanza ErrorCorreo si no se pudo (el llamador decide qué responder).
 * @param {{ para: string, nombre: string, codigo: string, minutos: number }} datos
 */
export async function enviarCodigoVerificacion({ para, nombre, codigo, minutos }) {
    const c = configCorreo();
    if (c.modo === 'no_configurado') throw new ErrorCorreo('no_configurado');
    const conLogo = fs.existsSync(LOGO);
    const { asunto, texto, html } = correoVerificacion({ nombre, codigo, minutos, conLogo });
    const mensaje = {
        from: c.remitente, to: para, subject: asunto, text: texto, html,
        attachments: conLogo ? [{ filename: 'learntrack.png', path: LOGO, cid: CID_LOGO }] : [],
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' }
    };
    try {
        const info = await transporteDe(c).sendMail(mensaje);
        if (c.modo === 'archivo') {
            fs.mkdirSync(CARPETA_CORREOS_DEV, { recursive: true });
            const archivo = path.join(CARPETA_CORREOS_DEV, `${new Date().toISOString().replace(/[:.]/g, '-')}-verificacion.eml`);
            fs.writeFileSync(archivo, info.message);
            console.log(`✉️  Correo de verificación guardado (modo desarrollo, sin SMTP): correos-dev/${path.basename(archivo)}`);
        }
        return { enviado: true };
    } catch (e) {
        // Solo el tipo de error: ni destinatario, ni código, ni credenciales
        console.error(`No se pudo enviar el correo de verificación (${e?.code || e?.name || 'error'}).`);
        throw new ErrorCorreo(e?.code || 'envio');
    }
}
