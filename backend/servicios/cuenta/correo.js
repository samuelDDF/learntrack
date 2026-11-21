
// Envío de correos mediante Gmail API, SMTP o archivo local.
// Gmail API utiliza HTTPS y tiene prioridad sobre SMTP.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { correoVerificacion, CID_LOGO } from './plantilla-verificacion.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOGO = path.join(RAIZ, 'frontend-react', 'public', 'recursos', 'iconos', 'pwa-192.png');
export const CARPETA_CORREOS_DEV = path.join(RAIZ, 'correos-dev');

export class ErrorCorreo extends Error {
    constructor(motivo) {
        super('No se pudo enviar el correo.');
        this.name = 'ErrorCorreo';
        this.motivo = motivo;
    }
}

const siNo = (valor, porDefecto) => {
    if (valor === undefined || valor === '') return porDefecto;
    return /^(1|true|si|sí|yes|on)$/i.test(String(valor).trim());
};

/**
 * Configuración de correo.
 * Gmail API tiene prioridad sobre SMTP cuando está configurada completamente.
 */
export function configCorreo(env = process.env) {
    const produccion = env.NODE_ENV === 'production';

    const clientId = String(env.GMAIL_CLIENT_ID ?? '').trim();
    const clientSecret = String(env.GMAIL_CLIENT_SECRET ?? '').trim();
    const refreshToken = String(env.GMAIL_REFRESH_TOKEN ?? '').trim();
    const usuarioGmail = String(env.GMAIL_USER ?? env.SMTP_USER ?? '').trim();

    const hayConfigGmail = Boolean(
        clientId || clientSecret || refreshToken || env.GMAIL_USER
    );

    if (hayConfigGmail) {
        if (!clientId || !clientSecret || !refreshToken || !usuarioGmail) {
            return {
                modo: 'gmail_incompleto',
                remitente: 'LearnTrack <no-responder@learntrack.local>'
            };
        }

        return {
            modo: 'gmail_api',
            clientId,
            clientSecret,
            refreshToken,
            usuario: usuarioGmail,
            remitente: String(env.GMAIL_FROM ?? '').trim()
                || `LearnTrack <${usuarioGmail}>`
        };
    }

    const host = String(env.SMTP_HOST ?? '').trim();

    if (!host) {
        return {
            modo: produccion ? 'no_configurado' : 'archivo',
            remitente: 'LearnTrack <no-responder@learntrack.local>'
        };
    }

    const secure = siNo(env.SMTP_SECURE, false);
    const port = Number.parseInt(env.SMTP_PORT, 10) || (secure ? 465 : 587);
    const user = String(env.SMTP_USER ?? '').trim();

    return {
        modo: 'smtp',
        host,
        port,
        secure,
        user,
        pass: env.SMTP_PASS ?? '',
        requireTLS: siNo(env.SMTP_REQUIRE_TLS, produccion && !secure),
        remitente: String(env.SMTP_FROM ?? '').trim()
            || (user ? `LearnTrack <${user}>` : 'LearnTrack <no-responder@learntrack.local>')
    };
}

let cache = { clave: '', transporte: null };

function transporteDe(c) {
    const clave = JSON.stringify([
        c.modo, c.host, c.port, c.secure, c.user, c.pass, c.requireTLS
    ]);

    if (cache.clave === clave) return cache.transporte;

    let transporte;

    if (c.modo === 'smtp') {
        transporte = nodemailer.createTransport({
            host: c.host,
            port: c.port,
            secure: c.secure,
            requireTLS: c.requireTLS,
            auth: c.user ? { user: c.user, pass: c.pass } : undefined,
            tls: { minVersion: 'TLSv1.2' },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
            logger: false,
            debug: false
        });
    } else {
        // Gmail API necesita el mensaje MIME completo codificado en base64url.
        transporte = nodemailer.createTransport({
            streamTransport: true,
            buffer: true,
            newline: 'unix'
        });
    }

    cache = { clave, transporte };
    return transporte;
}

/** Crea un cliente OAuth2 para Gmail API. */
function clienteGmail(c) {
    const oauth2 = new google.auth.OAuth2(
        c.clientId,
        c.clientSecret
    );

    oauth2.setCredentials({
        refresh_token: c.refreshToken
    });

    return google.gmail({
        version: 'v1',
        auth: oauth2
    });
}

/** Descripción del transporte sin exponer credenciales. */
export function describirCorreo() {
    const c = configCorreo();

    if (c.modo === 'gmail_api') return 'Gmail API (HTTPS)';
    if (c.modo === 'gmail_incompleto') return 'Gmail API: configuración incompleta';
    if (c.modo === 'smtp') {
        return `SMTP ${c.host}:${c.port}${c.secure ? ' (TLS)' : c.requireTLS ? ' (STARTTLS obligatorio)' : ''}`;
    }
    if (c.modo === 'archivo') {
        return 'sin SMTP: los correos se guardan en correos-dev/ (solo desarrollo)';
    }

    return 'SIN CONFIGURAR: el envío de correos no está disponible';
}

/** Indica si el servicio de correo tiene configuración utilizable. */
export const correoDisponible = () => {
    const modo = configCorreo().modo;
    return ['gmail_api', 'smtp', 'archivo'].includes(modo);
};

/** Comprueba el transporte al arrancar el servidor. */
export async function comprobarCorreo() {
    const c = configCorreo();

    if (c.modo === 'gmail_incompleto' || c.modo === 'no_configurado') {
        return 'no_configurado';
    }

    try {
        if (c.modo === 'gmail_api') {
            await clienteGmail(c).users.getProfile({ userId: 'me' });
            return true;
        }

        if (c.modo === 'smtp') {
            await transporteDe(c).verify();
            return true;
        }

        return null;
    } catch (e) {
        return e?.code || e?.name || 'error';
    }
}

/**
 * Envía el código de verificación.
 * Conserva la interfaz utilizada por el sistema OTP.
 */
export async function enviarCodigoVerificacion({ para, nombre, codigo, minutos }) {
    const c = configCorreo();

    if (c.modo === 'no_configurado' || c.modo === 'gmail_incompleto') {
        throw new ErrorCorreo('no_configurado');
    }

    const conLogo = fs.existsSync(LOGO);
    const { asunto, texto, html } = correoVerificacion({
        nombre,
        codigo,
        minutos,
        conLogo
    });

    const mensaje = {
        from: c.remitente,
        to: para,
        subject: asunto,
        text: texto,
        html,
        attachments: conLogo
            ? [{
                filename: 'learntrack.png',
                path: LOGO,
                cid: CID_LOGO
            }]
            : [],
        headers: {
            'Auto-Submitted': 'auto-generated',
            'X-Auto-Response-Suppress': 'All'
        }
    };

    try {
        const transporte = transporteDe(c);
        const info = await transporte.sendMail(mensaje);

        if (c.modo === 'archivo') {
            fs.mkdirSync(CARPETA_CORREOS_DEV, { recursive: true });

            const archivo = path.join(
                CARPETA_CORREOS_DEV,
                `${new Date().toISOString().replace(/[:.]/g, '-')}-verificacion.eml`
            );

            fs.writeFileSync(archivo, info.message);

            console.log(
                `Correo de verificación guardado en correos-dev/${path.basename(archivo)}`
            );
        } else if (c.modo === 'gmail_api') {
            const raw = Buffer.from(info.message).toString('base64url');

            await clienteGmail(c).users.messages.send({
                userId: 'me',
                requestBody: { raw }
            });
        }

        return { enviado: true };
    } catch (e) {
        // No registrar destinatarios, códigos, tokens ni credenciales.
        console.error(
            `No se pudo enviar el correo de verificación (${e?.code || e?.name || 'error'}).`
        );

        throw new ErrorCorreo(e?.code || 'envio');
    }
}
