// Aplicación Express de LearnTrack: une la seguridad, las sesiones, los límites, las rutas y el frontend.
// server.js la crea tras conectar a MongoDB; las pruebas la crean contra una base de pruebas.
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

import { cabecerasSeguridad, corsPropio, origenesPermitidos, verificarOrigen, sinCache } from './middleware/seguridad.js';
import { cargarSesion } from './middleware/autenticacion.js';
import { crearLimitadores } from './middleware/limites.js';
import { apiNoEncontrada, paginaNoEncontrada, manejarErrores } from './middleware/errores.js';
import { crearRutasPaginas } from './rutas/paginas.rutas.js';
import { crearRutasPaginasReact, paginaNoEncontradaReact, hayCompilacionReact } from './rutas/paginas-react.rutas.js';
import { crearRutasAuth } from './rutas/auth.rutas.js';
import { crearRutasActividades, crearRutasPapelera, crearRutasProyectos } from './rutas/actividades.rutas.js';
import { crearRutasBienestar } from './rutas/bienestar.rutas.js';
import { crearRutasAsistente } from './rutas/asistente.rutas.js';
import { crearRutasPerfil } from './rutas/perfil.rutas.js';
import { crearRutasContacto } from './rutas/contacto.rutas.js';
import { crearRutasFestivos } from './rutas/festivos.rutas.js';
import { crearRutasRepaso } from './rutas/repaso.rutas.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARPETAS = {
    carpetaPublica: path.join(raiz, 'frontend', 'publico'),
    carpetaPrivada: path.join(raiz, 'frontend', 'privado'),
    carpetaCompartida: path.join(raiz, 'compartido'),
    carpetaReact: path.join(raiz, 'frontend-react', 'dist')
};

/**
 * Qué frontend se sirve (v3.6): 'react' (frontend-react/dist, compilado con «npm run build») o 'legacy' (el HTML,
 * CSS y JavaScript clásicos de frontend/). Por defecto, React si está compilado; si no, el clásico con un aviso.
 * La API, la sesión y la seguridad son las mismas en los dos modos.
 */
export function elegirFrontend(pedido = process.env.FRONTEND, carpetaReact = CARPETAS.carpetaReact) {
    const valor = String(pedido ?? '').trim().toLowerCase();
    if (valor === 'legacy' || valor === 'clasico') return 'legacy';
    if (hayCompilacionReact(carpetaReact)) return 'react';
    if (valor === 'react') {
        console.warn('⚠️  FRONTEND=react pero no existe frontend-react/dist: ejecuta «npm run build». Se sirve el frontend clásico.');
    }
    return 'legacy';
}

/**
 * @param {object} opciones
 * @param {object} [opciones.limites] sobrescribe los límites de peticiones (pruebas)
 * @param {number|string} [opciones.puerto] para la lista de orígenes permitidos (CORS)
 */
export function crearApp({ limites = {}, puerto = process.env.PORT || 3000, frontend, carpetaReact = CARPETAS.carpetaReact } = {}) {
    const app = express();
    const modo = elegirFrontend(frontend, carpetaReact);
    app.locals.frontend = modo;
    if (/^\d+$/.test(process.env.TRUST_PROXY ?? '')) app.set('trust proxy', Number(process.env.TRUST_PROXY));
    app.disable('x-powered-by');

    // ---- Seguridad y sesión (todas las peticiones) ----
    const origenes = origenesPermitidos(puerto);
    app.use(cabecerasSeguridad());
    app.use(corsPropio(origenes));
    app.use(express.json({ limit: '10kb' }));       // archivos y foto de perfil usan su propio lector y límite
    app.use(verificarOrigen(origenes));
    app.use(cargarSesion);
    const limitadores = crearLimitadores(limites);

    // ---- Frontend: páginas y archivos estáticos ----
    if (modo === 'react') app.use(crearRutasPaginasReact({ carpetaReact }));
    else app.use(crearRutasPaginas(CARPETAS));

    // ---- API ----
    app.use('/api', sinCache, limitadores.api);
    app.use('/api/auth', crearRutasAuth(limitadores));
    app.use('/api/actividades', crearRutasActividades());
    app.use('/api/papelera', crearRutasPapelera());
    app.use('/api/proyectos', crearRutasProyectos());
    app.use('/api/perfil', crearRutasPerfil(limitadores));
    app.use('/api/contacto', crearRutasContacto(limitadores));
    app.use('/api/festivos', crearRutasFestivos(limitadores));
    app.use('/api/repaso', crearRutasRepaso());
    app.use('/api', crearRutasBienestar());
    app.use('/api', crearRutasAsistente(limitadores));

    // ---- No encontrado y errores ----
    app.use('/api', apiNoEncontrada);
    app.use(modo === 'react' ? paginaNoEncontradaReact(carpetaReact) : paginaNoEncontrada(CARPETAS.carpetaPublica));
    app.use(manejarErrores);
    return app;
}
