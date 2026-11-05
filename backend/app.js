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
import { crearRutasAuth } from './rutas/auth.rutas.js';
import { crearRutasActividades, crearRutasPapelera } from './rutas/actividades.rutas.js';
import { crearRutasBienestar } from './rutas/bienestar.rutas.js';
import { crearRutasAsistente } from './rutas/asistente.rutas.js';
import { crearRutasPerfil } from './rutas/perfil.rutas.js';
import { crearRutasContacto } from './rutas/contacto.rutas.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARPETAS = {
    carpetaPublica: path.join(raiz, 'frontend', 'publico'),
    carpetaPrivada: path.join(raiz, 'frontend', 'privado'),
    carpetaCompartida: path.join(raiz, 'compartido')
};

/**
 * @param {object} opciones
 * @param {object} [opciones.limites] sobrescribe los límites de peticiones (pruebas)
 * @param {number|string} [opciones.puerto] para la lista de orígenes permitidos (CORS)
 */
export function crearApp({ limites = {}, puerto = process.env.PORT || 3000 } = {}) {
    const app = express();
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
    app.use(crearRutasPaginas(CARPETAS));

    // ---- API ----
    app.use('/api', sinCache, limitadores.api);
    app.use('/api/auth', crearRutasAuth(limitadores));
    app.use('/api/actividades', crearRutasActividades());
    app.use('/api/papelera', crearRutasPapelera());
    app.use('/api/perfil', crearRutasPerfil(limitadores));
    app.use('/api/contacto', crearRutasContacto(limitadores));
    app.use('/api', crearRutasBienestar());
    app.use('/api', crearRutasAsistente(limitadores));

    // ---- No encontrado y errores ----
    app.use('/api', apiNoEncontrada);
    app.use(paginaNoEncontrada(CARPETAS.carpetaPublica));
    app.use(manejarErrores);
    return app;
}
