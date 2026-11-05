// Páginas y archivos del frontend.
//  · Públicas:  /  /planificador  /asistente          → frontend/publico/<pantalla>/<pantalla>.html
//  · Privadas:  /panel  /calendario  /proyectos  /configuracion → frontend/privado/<pantalla>/<pantalla>.html (con sesión)
//  · Archivos:  /…            → frontend/publico   (CSS, JS e imágenes públicas; /favicon.ico y
//                                                   /apple-touch-icon.png salen de recursos/)
//               /app/…        → frontend/privado   (solo con sesión: sin ella responde 401)
//               /app/compartido/… → compartido/    (módulos que usan servidor y navegador)
// Las direcciones antiguas (*.html) redirigen a las nuevas para no romper marcadores.
import path from 'path';
import express from 'express';
import { requiereSesionPagina, requiereSesionRecurso } from '../middleware/autenticacion.js';

export const PAGINA_INICIAL_PRIVADA = '/panel';

const PAGINAS_PUBLICAS = {
    '/': 'inicio/inicio.html',
    '/planificador': 'info-planificador/info-planificador.html',
    '/asistente': 'info-asistente/info-asistente.html'
};
const PAGINAS_PRIVADAS = {
    '/panel': 'panel/panel.html',
    '/calendario': 'calendario/calendario.html',
    '/proyectos': 'proyectos/proyectos.html',
    '/configuracion': 'configuracion/configuracion.html'
};
export const DIRECCIONES_ANTIGUAS = {
    '/index.html': '/',
    '/planificador-info.html': '/planificador',
    '/asistente-info.html': '/asistente',
    '/app-dashboard.html': '/panel',
    '/app-dashboard': '/panel',
    '/calendario.html': '/calendario',
    '/perfil': '/configuracion',               // v3.1–v3.2: «Mi perfil» ahora es Configuración
    '/perfil.html': '/configuracion',
    '/configuracion.html': '/configuracion',
    '/proyectos.html': '/proyectos'
};

const sinCacheHtml = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

export function crearRutasPaginas({ carpetaPublica, carpetaPrivada, carpetaCompartida }) {
    const rutas = express.Router();

    for (const [antigua, nueva] of Object.entries(DIRECCIONES_ANTIGUAS)) {
        rutas.get(antigua, (req, res) => {
            const consulta = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
            res.redirect(301, nueva + consulta);
        });
    }

    for (const [ruta, archivo] of Object.entries(PAGINAS_PUBLICAS)) {
        rutas.get(ruta, (req, res) => res.sendFile(path.join(carpetaPublica, archivo)));
    }
    for (const [ruta, archivo] of Object.entries(PAGINAS_PRIVADAS)) {
        rutas.get(ruta, requiereSesionPagina, sinCacheHtml, (req, res) => res.sendFile(path.join(carpetaPrivada, archivo)));
    }

    // Íconos que los navegadores piden en la raíz aunque la página no los declare
    for (const icono of ['favicon.ico', 'apple-touch-icon.png']) {
        rutas.get(`/${icono}`, (req, res) => res.sendFile(path.join(carpetaPublica, 'recursos', icono), { maxAge: '7d' }));
    }

    // Archivos privados: UNA sola regla protegida para todo /app (incluido /app/compartido)
    rutas.use('/app', requiereSesionRecurso, sinCacheHtml);
    rutas.use('/app/compartido', express.static(carpetaCompartida, { index: false, dotfiles: 'deny' }));
    rutas.use('/app', express.static(carpetaPrivada, { index: false, dotfiles: 'deny' }));

    rutas.use(express.static(carpetaPublica, { index: false, dotfiles: 'deny' }));
    return rutas;
}
