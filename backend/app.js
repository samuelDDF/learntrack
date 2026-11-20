// Aplicación Express de LearnTrack: une la seguridad, las sesiones, los límites, las rutas y el frontend.
// server.js la crea tras conectar a MongoDB; las pruebas la crean contra una base de pruebas.
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

import { cabecerasSeguridad, corsPropio, origenesPermitidos, verificarOrigen, sinCache } from './middleware/seguridad.js';
import { cargarSesion } from './middleware/autenticacion.js';
import { crearLimitadores } from './middleware/limites.js';
import { apiNoEncontrada, manejarErrores } from './middleware/errores.js';
import { crearRutasPaginasReact, paginaNoEncontradaReact, hayCompilacionReact } from './rutas/paginas-react.rutas.js';
import { crearRutasAuth } from './rutas/auth.rutas.js';
import { crearRutasActividades, crearRutasPapelera, crearRutasProyectos } from './rutas/actividades.rutas.js';
import { crearRutasBienestar } from './rutas/bienestar.rutas.js';
import { crearRutasAsistente } from './rutas/asistente.rutas.js';
import { crearRutasPerfil } from './rutas/perfil.rutas.js';
import { crearRutasContacto } from './rutas/contacto.rutas.js';
import { crearRutasFestivos } from './rutas/festivos.rutas.js';
import { crearRutasRepaso } from './rutas/repaso.rutas.js';
import { crearRutasGoogleOAuth } from './rutas/google-oauth.rutas.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARPETA_REACT = path.join(raiz, 'frontend-react', 'dist');

/** LearnTrack funciona exclusivamente con React. Si falta el build o se solicita el modo clásico, se detiene con un error claro. */
export function elegirFrontend(pedido = process.env.FRONTEND, carpetaReact = CARPETA_REACT) {
    const valor = String(pedido ?? '').trim().toLowerCase();
    if (valor && !['react', ''].includes(valor)) {
        throw new Error('LearnTrack solo admite el frontend React. Elimina FRONTEND=legacy de tu .env.');
    }
    if (!hayCompilacionReact(carpetaReact)) {
        throw new Error('No existe frontend-react/dist/index.html. Ejecuta «npm run build» antes de iniciar LearnTrack.');
    }
    return 'react';
}

/**
 * @param {object} opciones
 * @param {object} [opciones.limites] sobrescribe los límites de peticiones (pruebas)
 * @param {number|string} [opciones.puerto] para la lista de orígenes permitidos (CORS)
 */
export function crearApp({ limites = {}, puerto = process.env.PORT || 3000, frontend = process.env.FRONTEND, carpetaReact = CARPETA_REACT } = {}) {
    const app = express();
    const soloApi = String(process.env.API_ONLY ?? '').toLowerCase() === 'true';
    const modo = soloApi ? 'api' : elegirFrontend(frontend, carpetaReact);
    app.locals.frontend = modo;
    if (/^\d+$/.test(process.env.TRUST_PROXY ?? '')) app.set('trust proxy', Number(process.env.TRUST_PROXY));
    app.disable('x-powered-by');

    // ---- Seguridad y sesión (todas las peticiones) ----
    const origenes = origenesPermitidos(puerto);
    app.use(cabecerasSeguridad());
    app.use(corsPropio(origenes));
    app.use(express.json({ limit: '10kb' }));       // archivos y foto de perfil usan su propio lector y límite
    app.use(verificarOrigen(origenes));

    // Comprobación de salud para el proveedor de alojamiento. Se registra antes de cargar la sesión
    // para que el monitor no dependa de una cookie de usuario.
    app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, servicio: 'learntrack' }));

    app.use(cargarSesion);
    const limitadores = crearLimitadores(limites);

    // ---- Frontend (solo cuando Express también lo aloja) ----
    // En la arquitectura GitHub Pages + Railway, GitHub sirve React y Express expone únicamente la API.
    if (!soloApi) app.use(crearRutasPaginasReact({ carpetaReact }));

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

    app.use('/auth/google', crearRutasGoogleOAuth());

    // ---- No encontrado y errores ----
    app.use('/api', apiNoEncontrada);
    if (soloApi) app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
    else app.use(paginaNoEncontradaReact(carpetaReact));
    app.use(manejarErrores);
    return app;
}
