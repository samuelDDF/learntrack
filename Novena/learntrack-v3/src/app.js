// Aplicación Express de LearnTrack (rutas, límites, cabeceras de seguridad). server.js la crea tras conectar a
// MongoDB; las pruebas la crean contra una base de pruebas.
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

import { consultarIA, ErrorIA, modeloVision } from './ai-service.js';
import * as db from './database.js';
import {
    hashPassword, verificarPassword, gastarTiempoDeLogin,
    iniciarSesion, cerrarSesion, cargarSesion,
    requiereAuthApi, requiereAuthPagina, verificarOrigen
} from './auth.js';
import {
    validarRegistro, validarLogin, validarActividad, validarHistorial,
    validarContacto, validarConsultaIA, normalizarEmail, validarEntradaChat, validarCheckin,
    esIdActividad, esIdPropuesta, esIdLote, validarFechaHoy, validarTzOffset, esFechaValida, limpiarTextoVisible
} from './validacion.js';
import { procesarChat, procesarArchivo, aplicarPropuesta, deshacerLote, ErrorChat } from './chat.js';
import { ErrorArchivo, LIMITE_BYTES, capacidadesArchivos } from './archivos.js';
import { cargaDelDia, capacidadDe, rangoActividad, UMBRAL_ROJO } from '../compartido/carga.js';
import { rangoFechas, diasEntre } from '../compartido/fechas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(__dirname, '..');
const publicPath = path.join(raiz, 'public');
const privatePath = path.join(raiz, 'private');
const compartidoPath = path.join(raiz, 'compartido');

const RUTA_DASHBOARD = '/app-dashboard.html';
const PAGINAS_PRIVADAS = { '/app-dashboard.html': 'app-dashboard.html', '/calendario.html': 'calendario.html' };

let multer = null;
try { multer = (await import('multer')).default; } catch { console.warn('Carga de archivos desactivada: falta la dependencia "multer".'); }

/**
 * @param {object} opciones
 * @param {object} [opciones.limites] sobrescribe los límites por usuario (pruebas): { chat, archivos, consejo, api }
 */
export function crearApp({ limites = {}, puerto = process.env.PORT || 3000 } = {}) {
    const app = express();
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
    // helmet no pone Permissions-Policy: el micrófono solo para este mismo origen (dictado por voz)
    app.use((req, res, next) => {
        res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()');
        next();
    });

    const origenesPermitidos = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    const origenesCors = [`http://localhost:${puerto}`, `http://127.0.0.1:${puerto}`, ...origenesPermitidos];
    app.use(cors({
        origin: (origen, cb) => cb(null, !origen || origenesCors.includes(origen)),
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type'],
        credentials: true
    }));

    app.use(express.json({ limit: '10kb' }));        // la ruta de archivos usa multipart con su propio límite
    app.use(verificarOrigen(origenesCors));
    app.use(cargarSesion);

    // ====== Límites de peticiones ======
    const mensajeLimite = (texto) => ({ error: texto });
    const baseLimite = { standardHeaders: true, legacyHeaders: false };
    const porUsuario = (req) => `usuario:${req.usuario.id}`;
    const L = { api: 300, chat: 30, archivos: 6, consejo: 20, ...limites };

    const limitadorApi = rateLimit({ ...baseLimite, windowMs: 15 * 60 * 1000, limit: L.api, message: mensajeLimite('Demasiadas peticiones desde esta IP. Intenta de nuevo más tarde.') });
    const limitadorLoginIp = rateLimit({
        ...baseLimite, windowMs: 15 * 60 * 1000, limit: 15, skipSuccessfulRequests: true, keyGenerator: (req) => ipKeyGenerator(req.ip),
        message: mensajeLimite('Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.')
    });
    const limitadorLoginCuenta = rateLimit({
        ...baseLimite, windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
        keyGenerator: (req) => `cuenta:${normalizarEmail(req.body?.email) || ipKeyGenerator(req.ip)}`,
        message: mensajeLimite('Demasiados intentos fallidos para esta cuenta. Espera 15 minutos e inténtalo de nuevo.')
    });
    const limitadorRegistro = rateLimit({ ...baseLimite, windowMs: 60 * 60 * 1000, limit: limites.registro ?? 8, keyGenerator: (req) => ipKeyGenerator(req.ip), message: mensajeLimite('Se crearon demasiadas cuentas desde esta IP. Inténtalo más tarde.') });
    const limitadorContacto = rateLimit({ ...baseLimite, windowMs: 60 * 60 * 1000, limit: 5, keyGenerator: (req) => ipKeyGenerator(req.ip), message: mensajeLimite('Has enviado demasiados mensajes. Inténtalo más tarde.') });
    // Tres límites separados por usuario (antes era uno solo para todo): chat, archivos (más estricto) y consejo
    const limitadorChat = rateLimit({ ...baseLimite, windowMs: 15 * 60 * 1000, limit: L.chat, keyGenerator: porUsuario, message: mensajeLimite('Has escrito muchas veces al asistente. Espera unos minutos.') });
    const limitadorArchivos = rateLimit({ ...baseLimite, windowMs: 15 * 60 * 1000, limit: L.archivos, keyGenerator: porUsuario, message: mensajeLimite('Has subido demasiados archivos. Espera 15 minutos.') });
    const limitadorConsejo = rateLimit({ ...baseLimite, windowMs: 15 * 60 * 1000, limit: L.consejo, keyGenerator: porUsuario, message: mensajeLimite('Has pedido demasiados consejos. Espera unos minutos.') });

    const sinCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

    // ====== Zona privada: UNA sola regla protegida por sesión para páginas y recursos ======
    app.use(['/app', ...Object.keys(PAGINAS_PRIVADAS)], requiereAuthPagina, sinCache);
    app.get(Object.keys(PAGINAS_PRIVADAS), (req, res) => res.sendFile(path.join(privatePath, PAGINAS_PRIVADAS[req.path])));
    app.use('/app/compartido', express.static(compartidoPath, { index: false, dotfiles: 'deny' }));
    app.use('/app', express.static(privatePath, { index: false, dotfiles: 'deny' }));
    app.get('/app-dashboard', (req, res) => res.redirect(RUTA_DASHBOARD));
    app.get('/calendario', (req, res) => res.redirect('/calendario.html'));

    app.use(express.static(publicPath, { extensions: ['html'] }));
    app.use('/api', sinCache, limitadorApi);

    // ====== Autenticación ======
    app.get('/api/auth/me', (req, res) => {
        res.json({ usuario: req.usuario ? { id: req.usuario.id, nombre: req.usuario.nombre, email: req.usuario.email } : null });
    });

    app.post('/api/auth/registro', limitadorRegistro, async (req, res) => {
        const { error, valor } = validarRegistro(req.body);
        if (error) return res.status(400).json({ error });
        if (await db.buscarUsuarioPorEmail(valor.email)) return res.status(409).json({ error: 'Ese correo ya está registrado. Inicia sesión.' });
        const usuario = await db.crearUsuarioBD({
            id: db.nuevoId(), nombre: valor.nombre, email: valor.email,
            passwordHash: await hashPassword(valor.password), creado: new Date().toISOString()
        });
        if (!usuario) return res.status(409).json({ error: 'Ese correo ya está registrado. Inicia sesión.' });
        await iniciarSesion(res, usuario.id);
        res.status(201).json({ usuario: { nombre: usuario.nombre, email: usuario.email }, redirect: RUTA_DASHBOARD });
    });

    app.post('/api/auth/login', limitadorLoginIp, limitadorLoginCuenta, async (req, res) => {
        const { error, valor } = validarLogin(req.body);
        if (error) return res.status(400).json({ error });
        const usuario = await db.buscarUsuarioPorEmail(valor.email);
        const credencialesOk = usuario
            ? await verificarPassword(valor.password, usuario.passwordHash)
            : (await gastarTiempoDeLogin(valor.password), false);
        if (!credencialesOk) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        await iniciarSesion(res, usuario.id);
        res.json({ usuario: { nombre: usuario.nombre, email: usuario.email }, redirect: RUTA_DASHBOARD });
    });

    app.post('/api/auth/logout', async (req, res) => {
        await cerrarSesion(req, res);
        res.json({ ok: true });
    });

    app.post('/api/contacto', limitadorContacto, async (req, res) => {
        const { error, valor } = validarContacto(req.body);
        if (error) return res.status(400).json({ error });
        await db.guardarMensajeBD({ id: db.nuevoId(), ...valor, fecha: new Date().toISOString() });
        res.status(201).json({ ok: true });
    });

    // ====== Asistente de IA ======
    app.post('/api/ia/consultar', requiereAuthApi, limitadorConsejo, async (req, res) => {
        const { error, valor } = validarConsultaIA(req.body);
        if (error) return res.status(400).json({ error });
        const consejo = await consultarIA(valor);
        if (!consejo) return res.status(503).json({ error: 'El asistente de IA no está disponible ahora mismo.' });
        res.json({ consejo });
    });

    // Único punto de entrada del chat (reemplaza a /api/ia/agendar y /api/ia/parsear)
    app.post('/api/ia/chat', requiereAuthApi, limitadorChat, async (req, res) => {
        const { error, valor } = validarEntradaChat(req.body);
        if (error) return res.status(400).json({ error });
        res.json(await procesarChat(req.usuario, valor));
    });

    app.get('/api/ia/capacidades', requiereAuthApi, async (req, res) => {
        const archivos = multer ? await capacidadesArchivos({ vision: Boolean(modeloVision()) }) : { formatos: [], imagenes: false, pdf: false, docx: false };
        res.json({ archivos: Boolean(multer), ...archivos, transacciones: db.transaccionesDisponibles(), papeleraDias: db.diasPapelera() });
    });

    const subir = multer
        ? multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_BYTES, files: 1, fields: 4, fieldSize: 1000, parts: 6 } }).single('archivo')
        : null;
    const ERRORES_MULTER = {
        LIMIT_FILE_SIZE: [413, 'El archivo supera el máximo de 5 MB.'],
        LIMIT_FILE_COUNT: [400, 'Sube un solo archivo a la vez.'],
        LIMIT_UNEXPECTED_FILE: [400, 'Sube un solo archivo a la vez (campo "archivo").'],
        LIMIT_PART_COUNT: [400, 'Petición de archivo no válida.'],
        LIMIT_FIELD_COUNT: [400, 'Petición de archivo no válida.'],
        LIMIT_FIELD_VALUE: [400, 'Petición de archivo no válida.']
    };
    app.post('/api/ia/archivo', requiereAuthApi, limitadorArchivos, (req, res, next) => {
        if (!subir) return res.status(503).json({ error: 'La carga de archivos no está disponible en este servidor (falta la dependencia "multer").' });
        if (!req.is('multipart/form-data')) return res.status(415).json({ error: 'Envía el archivo como multipart/form-data.' });
        subir(req, res, (err) => {
            if (!err) return next();
            const [estado, mensaje] = ERRORES_MULTER[err.code] ?? [400, 'No se pudo recibir el archivo.'];
            res.status(estado).json({ error: mensaje });
        });
    }, async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo.' });
        const fechaHoy = validarFechaHoy(req.body);
        if (!fechaHoy) return res.status(400).json({ error: 'Falta la fecha local (fechaHoy, YYYY-MM-DD).' });
        const resultado = await procesarArchivo(req.usuario, {
            nombre: req.file.originalname, buffer: req.file.buffer, fechaHoy, tzOffset: validarTzOffset(req.body?.tzOffset),
            instruccion: limpiarTextoVisible(req.body?.instruccion, 300), vision: Boolean(modeloVision())
        });
        req.file.buffer = null;          // el contenido no se guarda en ningún sitio
        res.json(resultado);
    });

    app.post('/api/propuestas/:id/aplicar', requiereAuthApi, async (req, res) => {
        if (!esIdPropuesta(req.params.id)) return res.status(404).json({ error: 'Propuesta no encontrada.' });
        const seleccion = Array.isArray(req.body?.seleccion) ? req.body.seleccion.slice(0, db.MAX_OPERACIONES) : null;
        res.json(await aplicarPropuesta(req.usuario.id, req.params.id, { seleccion }));
    });

    app.post('/api/propuestas/:id/cancelar', requiereAuthApi, async (req, res) => {
        if (!esIdPropuesta(req.params.id)) return res.status(404).json({ error: 'Propuesta no encontrada.' });
        const ok = await db.cancelarPropuestaBD(req.usuario.id, req.params.id);
        res.json({ tipo: 'cancelada', mensaje: ok ? 'Propuesta cancelada: no cambié nada.' : 'Esa propuesta ya no estaba pendiente.' });
    });

    app.post('/api/operaciones/:loteId/deshacer', requiereAuthApi, async (req, res) => {
        if (!esIdLote(req.params.loteId)) return res.status(404).json({ error: 'No hay nada que deshacer.' });
        res.json(await deshacerLote(req.usuario.id, req.params.loteId));
    });

    // ====== Actividades (CRUD manual: sigue funcionando aunque Ollama no esté) ======
    app.get('/api/actividades', requiereAuthApi, async (req, res) => {
        res.json(await db.obtenerActividadesBD(req.usuario.id));
    });

    app.post('/api/actividades', requiereAuthApi, async (req, res) => {
        const { error, valor } = validarActividad(req.body);
        if (error) return res.status(400).json({ error });
        res.json(await db.guardarActividadBD(req.usuario.id, { id: db.nuevoId(), ...valor }));
    });

    app.put('/api/actividades/:id', requiereAuthApi, async (req, res) => {
        const { id } = req.params;
        if (!esIdActividad(id)) return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos para modificarla.' });
        const { error, valor } = validarActividad(req.body, { completa: false });
        if (error) return res.status(400).json({ error });
        if (Object.keys(valor).length === 0) return res.status(400).json({ error: 'No hay cambios que guardar.' });
        const lista = await db.actualizarActividadBD(req.usuario.id, id, valor);
        if (!lista) return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos para modificarla.' });
        res.json(lista);
    });

    // Borrado lógico: va a la papelera (se puede restaurar)
    app.delete('/api/actividades/:id', requiereAuthApi, async (req, res) => {
        const { id } = req.params;
        if (!esIdActividad(id)) return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos para eliminarla.' });
        const lista = await db.eliminarActividadBD(req.usuario.id, id);
        if (!lista) return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos para eliminarla.' });
        res.json(lista);
    });

    // ====== Papelera ======
    app.get('/api/papelera', requiereAuthApi, async (req, res) => {
        res.json({ dias: db.diasPapelera(), actividades: await db.obtenerPapeleraBD(req.usuario.id) });
    });

    app.post('/api/papelera/:id/restaurar', requiereAuthApi, async (req, res) => {
        const { id } = req.params;
        if (!esIdActividad(id)) return res.status(404).json({ error: 'No está en la papelera.' });
        const restaurada = await db.restaurarActividadBD(req.usuario.id, id);
        if (!restaurada) return res.status(404).json({ error: 'No está en la papelera (o ya se restauró).' });
        const actividades = await db.obtenerActividadesBD(req.usuario.id);
        const { inicio, fin } = rangoActividad(restaurada);
        const avisos = [];
        if (inicio) {
            const checkins = await db.obtenerCheckinsBD(req.usuario.id, inicio, fin);
            const cap = Object.fromEntries(checkins.map((c) => [c.fecha, capacidadDe(c)]));
            for (const d of rangoFechas(inicio, fin, 62)) {
                const c = cargaDelDia(actividades, d, cap[d] ?? 100);
                if (c.porcentaje > UMBRAL_ROJO) { avisos.push(`Ojo: el ${d} queda en ${c.porcentaje} % de carga.`); break; }
            }
        }
        res.json({ restaurada, actividades, avisos });
    });

    // ====== Check-in diario (antes solo en localStorage) ======
    app.get('/api/checkin', requiereAuthApi, async (req, res) => {
        if (!esFechaValida(req.query.fecha)) return res.status(400).json({ error: 'Fecha no válida.' });
        res.json({ checkin: await db.obtenerCheckinBD(req.usuario.id, req.query.fecha) });
    });
    app.get('/api/checkins', requiereAuthApi, async (req, res) => {
        const { desde, hasta } = req.query;
        if (!esFechaValida(desde) || !esFechaValida(hasta) || hasta < desde || diasEntre(desde, hasta) > 400) return res.status(400).json({ error: 'Rango de fechas no válido.' });
        res.json({ checkins: await db.obtenerCheckinsBD(req.usuario.id, desde, hasta) });
    });
    app.put('/api/checkin', requiereAuthApi, async (req, res) => {
        const { error, valor } = validarCheckin(req.body);
        if (error) return res.status(400).json({ error });
        res.json({ checkin: await db.guardarCheckinBD(req.usuario.id, valor) });
    });

    // ====== Historial: el servidor calcula el % con la regla única; solo días <= hoy ======
    app.get('/api/historial', requiereAuthApi, async (req, res) => {
        res.json(await db.obtenerHistorialBD(req.usuario.id));
    });
    app.post('/api/historial', requiereAuthApi, async (req, res) => {
        const { error, valor } = validarHistorial(req.body);
        if (error) return res.status(400).json({ error });
        const [actividades, checkin] = await Promise.all([db.obtenerActividadesBD(req.usuario.id), db.obtenerCheckinBD(req.usuario.id, valor.fecha)]);
        const { porcentaje } = cargaDelDia(actividades, valor.fecha, capacidadDe(checkin));
        res.json(await db.guardarHistorialBD(req.usuario.id, valor.fecha, porcentaje));
    });

    app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' }));
    app.use((req, res) => res.status(404).sendFile(path.join(publicPath, '404.html')));

    // ====== Errores (sin registrar cuerpos de peticiones ni contenido de archivos) ======
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
            return res.status(err.status || 400).json({ error: 'Cuerpo de la petición no válido.' });
        }
        if (err instanceof ErrorIA) {
            if (err.tipo === 'no_disponible') {
                return res.status(503).json({ error: 'El asistente de IA no está disponible ahora mismo (¿está corriendo «ollama serve» con el modelo descargado?). Puedes seguir creando actividades con «+ Nueva actividad».' });
            }
            return res.status(502).json({ error: 'La IA respondió con un formato no válido. Intenta reformular tu mensaje.' });
        }
        if (err instanceof ErrorChat || err instanceof ErrorArchivo) return res.status(err.estado).json({ error: err.message });
        if (err instanceof db.ErrorDatos) return res.status(err.estado).json({ error: err.message });
        if (err?.name === 'CastError' || err?.name === 'ValidationError') return res.status(400).json({ error: 'Datos no válidos.' });
        if (err?.status === 404) return res.status(404).json({ error: 'No encontrado.' });
        console.error('Error no controlado:', err?.message, err?.stack?.split('\n').slice(1, 4).join(' | '));
        res.status(500).json({ error: 'Error interno del servidor.' });
    });

    return app;
}
