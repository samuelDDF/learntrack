// Cabeceras de seguridad (CSP estricta, Permissions-Policy), CORS y comprobación de Origin (CSRF).
import helmet from 'helmet';
import cors from 'cors';

/** Orígenes que pueden llamar a la API: el propio servidor y los de ALLOWED_ORIGINS */
export function origenesPermitidos(puerto) {
    const extra = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    return [`http://localhost:${puerto}`, `http://127.0.0.1:${puerto}`, ...extra];
}

export function cabecerasSeguridad() {
    const conHelmet = helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'script-src': ["'self'"],
                'style-src': ["'self'", 'https://fonts.googleapis.com'],
                'font-src': ["'self'", 'https://fonts.gstatic.com'],
                'img-src': ["'self'", 'data:'],
                'connect-src': ["'self'"],
                'form-action': ["'self'"],
                'frame-ancestors': ["'none'"],
                'upgrade-insecure-requests': null
            }
        }
    });
    return (req, res, next) => {
        // helmet no pone Permissions-Policy: el micrófono solo para este mismo origen (dictado por voz)
        res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()');
        conHelmet(req, res, next);
    };
}

export function corsPropio(origenes) {
    return cors({
        origin: (origen, cb) => cb(null, !origen || origenes.includes(origen)),
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type'],
        credentials: true
    });
}

/**
 * Protección CSRF adicional a SameSite=Strict: si el navegador envía Origin en una petición que modifica datos,
 * debe coincidir con el propio sitio o con un origen permitido.
 */
export function verificarOrigen(origenes) {
    return (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        const origen = req.get('origin');
        if (!origen) return next();
        if (origen === `${req.protocol}://${req.get('host')}` || origenes.includes(origen)) return next();
        res.status(403).json({ error: 'Origen no permitido.' });
    };
}

/** Respuestas de la API que nunca deben guardarse en caché */
export const sinCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
