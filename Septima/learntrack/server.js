// server.js
import dotenv from 'dotenv';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { consultarIA, parsearActividadIA } from './src/ai-service.js';
import {
    buscarUsuarioPorEmail, crearUsuarioBD,
    guardarActividadBD, obtenerActividadesBD,
    actualizarActividadBD, eliminarActividadBD,
    guardarHistorialBD, obtenerHistorialBD,
    guardarMensajeBD
} from './src/database.js';
import {
    hashPassword, verificarPassword, gastarTiempoDeLogin,
    iniciarSesion, cerrarSesion, cargarSesion,
    requiereAuthApi, requiereAuthPagina, verificarOrigen
} from './src/auth.js';
import {
    validarRegistro, validarLogin, validarActividad, validarHistorial,
    validarContacto, validarConsultaIA, normalizarEmail,
    normalizarActividadIA, validarTextoChat
} from './src/validacion.js';

dotenv.config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, 'public');
const privatePath = path.join(__dirname, 'private');

const RUTA_DASHBOARD = '/app-dashboard.html';
const RUTA_CALENDARIO = '/calendario.html';
const nuevoId = () => crypto.randomBytes(12).toString('hex');

if (/^\d+$/.test(process.env.TRUST_PROXY ?? '')) app.set('trust proxy', Number(process.env.TRUST_PROXY));
app.disable('x-powered-by');

app.use(helmet({
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
}));

const origenesPermitidos = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',').map(o => o.trim()).filter(Boolean);
const origenesCors = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, ...origenesPermitidos];

app.use(cors({
    origin: (origen, cb) => cb(null, !origen || origenesCors.includes(origen)),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(verificarOrigen(origenesCors));
app.use(cargarSesion);

const mensajeLimite = (texto) => ({ error: texto });
const baseLimite = { standardHeaders: true, legacyHeaders: false };

const limitadorApi = rateLimit({
    ...baseLimite, windowMs: 15 * 60 * 1000, limit: 300,
    message: mensajeLimite('Demasiadas peticiones desde esta IP. Intenta de nuevo más tarde.')
});

const limitadorLoginIp = rateLimit({
    ...baseLimite, windowMs: 15 * 60 * 1000, limit: 15, skipSuccessfulRequests: true,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: mensajeLimite('Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.')
});
const limitadorLoginCuenta = rateLimit({
    ...baseLimite, windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
    keyGenerator: (req) => `cuenta:${normalizarEmail(req.body?.email) || ipKeyGenerator(req.ip)}`,
    message: mensajeLimite('Demasiados intentos fallidos para esta cuenta. Espera 15 minutos e inténtalo de nuevo.')
});

const limitadorRegistro = rateLimit({
    ...baseLimite, windowMs: 60 * 60 * 1000, limit: 8,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: mensajeLimite('Se crearon demasiadas cuentas desde esta IP. Inténtalo más tarde.')
});

const limitadorContacto = rateLimit({
    ...baseLimite, windowMs: 60 * 60 * 1000, limit: 5,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: mensajeLimite('Has enviado demasiados mensajes. Inténtalo más tarde.')
});

const limitadorIA = rateLimit({
    ...baseLimite, windowMs: 15 * 60 * 1000, limit: 20,
    keyGenerator: (req) => `usuario:${req.usuario.id}`,
    message: mensajeLimite('Has consultado demasiadas veces al asistente. Espera unos minutos.')
});

const sinCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

app.get(RUTA_DASHBOARD, requiereAuthPagina, sinCache, (req, res) => {
    res.sendFile(path.join(privatePath, 'app-dashboard.html'));
});
app.get('/app/dashboard.js', requiereAuthPagina, sinCache, (req, res) => {
    res.sendFile(path.join(privatePath, 'dashboard.js'));
});
app.get('/app-dashboard', (req, res) => res.redirect(RUTA_DASHBOARD));

<<<<<<< HEAD
=======
// ====== Sección "Mi Agenda" (privada, solo con sesión válida) ======
app.get(RUTA_CALENDARIO, requiereAuthPagina, sinCache, (req, res) => {
    res.sendFile(path.join(privatePath, 'calendario.html'));
});
app.get('/app/calendario.js', requiereAuthPagina, sinCache, (req, res) => {
    res.sendFile(path.join(privatePath, 'calendario.js'));
});
app.get('/app/calendario.css', requiereAuthPagina, sinCache, (req, res) => {
    res.type('text/css').sendFile(path.join(privatePath, 'calendario.css'));
});
app.get('/calendario', (req, res) => res.redirect(RUTA_CALENDARIO));

>>>>>>> calendario
app.use(express.static(publicPath, { extensions: ['html'] }));
app.use('/api', sinCache, limitadorApi);

app.get('/api/auth/me', (req, res) => {
    res.json({ usuario: req.usuario ? { nombre: req.usuario.nombre, email: req.usuario.email } : null });
});

app.post('/api/auth/registro', limitadorRegistro, async (req, res) => {
    const { error, valor } = validarRegistro(req.body);
    if (error) return res.status(400).json({ error });

    if (buscarUsuarioPorEmail(valor.email)) {
        return res.status(409).json({ error: 'Ese correo ya está registrado. Inicia sesión.' });
    }

    const usuario = crearUsuarioBD({
        id: nuevoId(),
        nombre: valor.nombre,
        email: valor.email,
        passwordHash: await hashPassword(valor.password),
        creado: new Date().toISOString()
    });
    if (!usuario) return res.status(409).json({ error: 'Ese correo ya está registrado. Inicia sesión.' });

    iniciarSesion(res, usuario.id);
    res.status(201).json({ usuario: { nombre: usuario.nombre, email: usuario.email }, redirect: RUTA_DASHBOARD });
});

app.post('/api/auth/login', limitadorLoginIp, limitadorLoginCuenta, async (req, res) => {
    const { error, valor } = validarLogin(req.body);
    if (error) return res.status(400).json({ error });

    const usuario = buscarUsuarioPorEmail(valor.email);
    const credencialesOk = usuario
        ? await verificarPassword(valor.password, usuario.passwordHash)
        : (await gastarTiempoDeLogin(valor.password), false);

    if (!credencialesOk) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });

    iniciarSesion(res, usuario.id);
    res.json({ usuario: { nombre: usuario.nombre, email: usuario.email }, redirect: RUTA_DASHBOARD });
});

app.post('/api/auth/logout', (req, res) => {
    cerrarSesion(req, res);
    res.json({ ok: true });
});

app.post('/api/contacto', limitadorContacto, (req, res) => {
    const { error, valor } = validarContacto(req.body);
    if (error) return res.status(400).json({ error });
    guardarMensajeBD({ id: nuevoId(), ...valor, fecha: new Date().toISOString() });
    res.status(201).json({ ok: true });
});

app.post('/api/ia/consultar', requiereAuthApi, limitadorIA, async (req, res) => {
    const { error, valor } = validarConsultaIA(req.body);
    if (error) return res.status(400).json({ error });
    const consejo = await consultarIA(valor);
    res.json({ consejo });
});

<<<<<<< HEAD
// NUEVO ENDPOINT PARA PARSEAR CHAT
app.post('/api/ia/parsear', requiereAuthApi, limitadorIA, async (req, res) => {
    const { texto, fechaHoy } = req.body;
    if (!texto || typeof texto !== 'string') return res.status(400).json({ error: 'Texto no válido.' });
    
    const actividadParseada = await parsearActividadIA(texto, fechaHoy);
    if (!actividadParseada) return res.status(500).json({ error: 'No se pudo procesar la actividad.' });
    
    res.json({ actividad: actividadParseada });
=======
// Parseo sin guardar (lo usa el chat del dashboard). Devuelve la actividad ya normalizada y validada.
app.post('/api/ia/parsear', requiereAuthApi, limitadorIA, async (req, res) => {
    const { error, valor } = validarTextoChat(req.body);
    if (error) return res.status(400).json({ error });

    const actividad = normalizarActividadIA(await parsearActividadIA(valor.texto, valor.fechaHoy), valor.fechaHoy);
    if (!actividad) return res.status(422).json({ error: 'No se pudo interpretar la actividad. Intenta ser más específico.' });

    res.json({ actividad });
});

// Chat del calendario: IA -> JSON -> validación -> guardado asociado al usuario autenticado.
app.post('/api/ia/agendar', requiereAuthApi, limitadorIA, async (req, res) => {
    const { error, valor } = validarTextoChat(req.body);
    if (error) return res.status(400).json({ error });

    const cruda = await parsearActividadIA(valor.texto, valor.fechaHoy);
    if (cruda === null) return res.status(502).json({ error: 'El asistente de IA no respondió correctamente. Revisa que Ollama esté en ejecución e inténtalo de nuevo.' });

    const normalizada = normalizarActividadIA(cruda, valor.fechaHoy);
    const { error: errorValidacion, valor: datos } = normalizada ? validarActividad(normalizada) : { error: 'vacía' };
    if (errorValidacion) return res.status(422).json({ error: 'No pude interpretar la actividad. Intenta ser más específico.' });

    const actividad = { id: nuevoId(), ...datos };
    const actividades = guardarActividadBD(req.usuario.id, actividad);
    res.status(201).json({ actividad, actividades });
>>>>>>> calendario
});

app.get('/api/actividades', requiereAuthApi, (req, res) => {
    res.json(obtenerActividadesBD(req.usuario.id));
});

app.post('/api/actividades', requiereAuthApi, (req, res) => {
    const { error, valor } = validarActividad(req.body);
    if (error) return res.status(400).json({ error });
    res.json(guardarActividadBD(req.usuario.id, { id: nuevoId(), ...valor }));
});

app.put('/api/actividades/:id', requiereAuthApi, (req, res) => {
    const { id } = req.params;
    const { error, valor } = validarActividad(req.body, { completa: false });
    if (error) return res.status(400).json({ error });
    if (Object.keys(valor).length === 0) return res.status(400).json({ error: 'No hay cambios que guardar.' });

    const actividadesActualizadas = actualizarActividadBD(req.usuario.id, id, valor);
    if (!actividadesActualizadas) {
        return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos para modificarla.' });
    }
    res.json(actividadesActualizadas);
});

app.delete('/api/actividades/:id', requiereAuthApi, (req, res) => {
    const { id } = req.params;
    const actividadesActualizadas = eliminarActividadBD(req.usuario.id, id);
    if (!actividadesActualizadas) {
        return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos para eliminarla.' });
    }
    res.json(actividadesActualizadas);
});

app.get('/api/historial', requiereAuthApi, (req, res) => {
    res.json(obtenerHistorialBD(req.usuario.id));
});

app.post('/api/historial', requiereAuthApi, (req, res) => {
    const { error, valor } = validarHistorial(req.body);
    if (error) return res.status(400).json({ error });
    res.json(guardarHistorialBD(req.usuario.id, valor.fecha, valor.porcentaje));
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Ruta de API no encontrada.' });
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(publicPath, '404.html'));
});

app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
        return res.status(err.status || 400).json({ error: 'Cuerpo de la petición no válido.' });
    }
    console.error('Error no controlado:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
    console.log(`🛡 Servidor ciberseguro LearnTrack ejecutándose en http://localhost:${PORT}`);
    console.log(`🤖 Asistente configurado con Ollama Local (${process.env.OLLAMA_MODEL || 'llama3.2'})`);
});