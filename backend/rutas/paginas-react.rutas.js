// Frontend REACT (v3.6, FRONTEND=react): sirve la compilación de Vite (frontend-react/dist) con las MISMAS reglas de
// seguridad que el frontend clásico (rutas/paginas.rutas.js):
//  · Páginas públicas  / /planificador /asistente            → dist/index.html (sin caché del HTML)
//  · Páginas privadas  /panel /calendario /proyectos /repaso /configuracion → dist/index.html SOLO con sesión
//                       (sin ella: 302 a /?acceso=login, como antes)
//  · /r/privado/…      → JS y CSS de la zona privada: SOLO con sesión (401 sin ella). Cargarlos de forma diferida no
//                       los protegería: la protección es esta regla del servidor.
//  · /r/publico/…      → JS y CSS públicos con huella en el nombre: caché larga e inmutable.
//  · /sw.js, /manifest.webmanifest, /workbox-*.js → PWA (sin caché para que las actualizaciones lleguen).
//  · /recursos/…, /offline.html, /tema-inicial.js… → estáticos públicos de dist (copiados de frontend-react/public).
//  · Cualquier otra dirección GET que no sea de la API → la interfaz con estado 404 (no un 200 engañoso).
// Las direcciones antiguas (*.html, /perfil…) siguen redirigiendo a las nuevas.
import fs from 'fs';
import path from 'path';
import express from 'express';
import { requiereSesionPagina, requiereSesionRecurso } from '../middleware/autenticacion.js';
import { DIRECCIONES_ANTIGUAS } from './paginas.rutas.js';

export const PAGINAS_PUBLICAS_REACT = ['/', '/planificador', '/asistente'];
export const PAGINAS_PRIVADAS_REACT = ['/panel', '/calendario', '/proyectos', '/repaso', '/configuracion'];

const sinCache = (res) => res.set('Cache-Control', 'no-store');
const ARCHIVOS_PWA = /^\/(sw\.js|manifest\.webmanifest|workbox-[\w-]+\.js)$/;

/** ¿Hay una compilación de React utilizable en esta carpeta? */
export const hayCompilacionReact = (carpetaReact) => fs.existsSync(path.join(carpetaReact, 'index.html'));

export function crearRutasPaginasReact({ carpetaReact }) {
    const rutas = express.Router();
    const indice = path.join(carpetaReact, 'index.html');
    // El HTML se lee una vez (es pequeño) para responder también a las 404 sin tocar el disco en cada petición
    let html = null;
    const leerIndice = () => (html ??= fs.readFileSync(indice, 'utf8'));
    const enviarIndice = (res, estado = 200) => {
        sinCache(res);
        res.status(estado).type('html').send(leerIndice());
    };

    for (const [antigua, nueva] of Object.entries(DIRECCIONES_ANTIGUAS)) {
        rutas.get(antigua, (req, res) => {
            const consulta = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
            res.redirect(301, nueva + consulta);
        });
    }

    for (const ruta of PAGINAS_PUBLICAS_REACT) rutas.get(ruta, (req, res) => enviarIndice(res));
    for (const ruta of PAGINAS_PRIVADAS_REACT) rutas.get(ruta, requiereSesionPagina, (req, res) => enviarIndice(res));

    // Íconos que los navegadores piden en la raíz
    for (const icono of ['favicon.ico', 'apple-touch-icon.png']) {
        rutas.get(`/${icono}`, (req, res) => res.sendFile(path.join(carpetaReact, 'recursos', icono), { maxAge: '7d' }));
    }

    // PWA: el service worker y el manifiesto se revalidan siempre (si no, una versión vieja quedaría «pegada»)
    rutas.get(ARCHIVOS_PWA, (req, res, next) => {
        const archivo = path.join(carpetaReact, req.path.slice(1));
        if (!fs.existsSync(archivo)) return next();
        res.set('Cache-Control', 'no-cache');
        if (req.path === '/sw.js') res.set('Service-Worker-Allowed', '/');
        if (req.path.endsWith('.webmanifest')) res.type('application/manifest+json');
        res.sendFile(archivo);
    });

    // Código PRIVADO: una sola regla protegida para todo /r/privado
    rutas.use('/r/privado', requiereSesionRecurso, (req, res, next) => { res.set('Cache-Control', 'private, no-cache'); next(); },
        express.static(path.join(carpetaReact, 'r', 'privado'), { index: false, dotfiles: 'deny', fallthrough: false }));
    // Código público con huella en el nombre: inmutable
    rutas.use('/r/publico', express.static(path.join(carpetaReact, 'r', 'publico'), {
        index: false, dotfiles: 'deny', fallthrough: false, immutable: true, maxAge: '365d'
    }));
    // Resto de estáticos públicos (recursos, offline.html, tema-inicial.js…). index.html no se sirve por esta vía.
    rutas.use((req, res, next) => (req.path === '/index.html' ? next() : express.static(carpetaReact, {
        index: false, dotfiles: 'deny', maxAge: req.path.startsWith('/recursos/') ? '7d' : 0
    })(req, res, next)));
    return rutas;
}

/** 404 de páginas en modo React: la interfaz (que muestra «Página no encontrada») con estado 404 */
export function paginaNoEncontradaReact(carpetaReact) {
    let html = null;
    return (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).json({ error: 'No encontrado.' });
        html ??= fs.readFileSync(path.join(carpetaReact, 'index.html'), 'utf8');
        res.set('Cache-Control', 'no-store').status(404).type('html').send(html);
    };
}
