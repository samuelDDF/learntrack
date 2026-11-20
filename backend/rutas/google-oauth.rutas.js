
import { Router } from 'express';
import { google } from 'googleapis';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const router = Router();
const estadosPendientes = new Map();

const URI_REDIRECCION = 'https://learntrack-production-547cecad.up.railway.app/auth/google/callback';
const PERMISOS = ['https://www.googleapis.com/auth/gmail.send'];
const DURACION_ESTADO = 10 * 60 * 1000;

function crearClienteOAuth() {
    const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = process.env;

    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
        throw new Error('oauth_no_configurado');
    }

    return new google.auth.OAuth2(
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI || URI_REDIRECCION
    );
}

function claveValida(recibida, esperada) {
    if (!recibida || !esperada) return false;

    const a = Buffer.from(recibida);
    const b = Buffer.from(esperada);

    return a.length === b.length && timingSafeEqual(a, b);
}

// Devuelve la URL de autorización. Solo puede iniciarla quien conozca
// la clave administrativa configurada en Railway.
router.post('/start', (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (!claveValida(
        req.get('x-learntrack-oauth-key'),
        process.env.GMAIL_OAUTH_ADMIN_KEY
    )) {
        return res.status(403).json({ error: 'No autorizado.' });
    }

    try {
        const oauth2 = crearClienteOAuth();
        const ahora = Date.now();

        for (const [estado, datos] of estadosPendientes) {
            if (datos.expira < ahora) estadosPendientes.delete(estado);
        }

        const state = randomBytes(32).toString('hex');

        estadosPendientes.set(state, {
            expira: ahora + DURACION_ESTADO
        });

        const url = oauth2.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: PERMISOS,
            state
        });

        return res.json({ url });
    } catch {
        return res.status(500).json({
            error: 'No se pudo iniciar la autorización de Google.'
        });
    }
});

// Google devuelve aquí el código de autorización.
router.get('/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');

    const state = String(req.query.state || '');
    const pendiente = estadosPendientes.get(state);

    if (!pendiente || pendiente.expira < Date.now()) {
        estadosPendientes.delete(state);
        return res.status(400).send('Autorización inválida o caducada. Inicia el proceso nuevamente.');
    }

    // El estado se consume antes de intercambiar el código: no puede reutilizarse.
    estadosPendientes.delete(state);

    const codigo = String(req.query.code || '');

    if (!codigo) {
        return res.status(400).send('Google no devolvió un código de autorización.');
    }

    try {
        const oauth2 = crearClienteOAuth();
        const { tokens } = await oauth2.getToken(codigo);

        if (!tokens.refresh_token) {
            return res.status(400).send(
                'Google no entregó un refresh token. Vuelve a iniciar la autorización y acepta los permisos solicitados.'
            );
        }

        // Se muestra una sola vez para copiarlo a Railway.
        // No se registra el token en los logs.
        return res.type('text/plain').send(
            `Autorización completada.\n\nGMAIL_REFRESH_TOKEN:\n${tokens.refresh_token}\n\nCopia este valor directamente a las variables de entorno de Railway. No lo compartas ni lo publiques.`
        );
    } catch {
        return res.status(500).send(
            'No se pudo completar la autorización de Gmail. Revisa la configuración OAuth.'
        );
    }
});

export function crearRutasGoogleOAuth() {
    return router;
}
