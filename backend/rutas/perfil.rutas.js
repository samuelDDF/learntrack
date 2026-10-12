// /api/perfil: datos, apariencia (tema, paleta con Colormind, fondo), voz del asistente, foto, cuentas
// vinculadas y baja de la cuenta. Es lo que usa la página de Configuración.
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi, borrarCookieSesion } from '../middleware/autenticacion.js';
import { validarPerfil, validarServicio, validarEliminarCuenta, validarColorSemilla } from '../validacion/index.js';
import { hashPassword, verificarPassword } from '../servicios/cuenta/contrasenas.js';
import { detectarImagen, MAX_AVATAR_BYTES, MAX_FONDO_BYTES } from '../servicios/cuenta/imagenes.js';
import { iniciarVinculacion, modoIntegraciones, NOMBRES_SERVICIO } from '../servicios/cuenta/integraciones.js';
import { generarPaleta } from '../servicios/externos/colormind.js';
import { TEMAS, SERVICIOS } from '../modelos/Usuario.js';

// multer es opcional (igual que en la carga de archivos del chat): sin él, el fondo se desactiva con un aviso
let multer = null;
try { multer = (await import('multer')).default; } catch { /* ver ruta /fondo */ }

/** Lo que recibe la página de Configuración (nunca incluye el hash de la contraseña ni tokens) */
const respuestaPerfil = (perfil) => ({
    perfil: { ...perfil, avatarUrl: perfil.avatarActualizado ? `/api/perfil/avatar?v=${new Date(perfil.avatarActualizado).getTime()}` : null },
    integraciones: { modo: modoIntegraciones(), servicios: SERVICIOS.map((id) => ({ id, nombre: NOMBRES_SERVICIO[id] })) },
    temas: TEMAS
});
const NO_EXISTE = { error: 'Cuenta no encontrada.' };
const NO_IMAGEN = { error: 'El archivo no es una imagen JPEG, PNG o WebP válida.' };

/** ¿Es correcta la contraseña del usuario? */
async function passwordCorrecta(userId, password) {
    const hash = await db.obtenerPasswordHashBD(userId);
    return Boolean(hash) && verificarPassword(password, hash);
}

/** Sirve una imagen del usuario (la URL lleva ?v=fecha: se puede guardar en caché privada del navegador) */
const servirImagen = (clase, nombre) => async (req, res) => {
    const img = await db.obtenerImagenBD(clase, req.usuario.id);
    if (!img) return res.status(404).json({ error: 'No hay imagen.' });
    res.set({ 'Content-Type': img.tipo, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': `inline; filename="${nombre}"` });
    res.send(img.datos);
};

/**
 * Fondo personalizado con multer: UN archivo, en memoria (nunca toca el disco), máx. 1,5 MB, campo "imagen".
 * Luego se comprueba la firma real del archivo y se guarda en la colección "fondos".
 */
function recibirFondo() {
    const subir = multer?.({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FONDO_BYTES, files: 1, fields: 0, parts: 2 } }).single('imagen');
    return (req, res, next) => {
        if (!subir) return res.status(503).json({ error: 'La subida de imágenes no está disponible (falta la dependencia "multer").' });
        if (!req.is('multipart/form-data')) return res.status(415).json({ error: 'Envía la imagen como multipart/form-data (campo "imagen").' });
        subir(req, res, (err) => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La imagen supera 1,5 MB (la página la reduce sola; prueba con otra).' });
            res.status(400).json({ error: 'Envía una sola imagen en el campo "imagen".' });
        });
    };
}

export function crearRutasPerfil(limites) {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    rutas.get('/', async (req, res) => {
        const perfil = await db.obtenerPerfilBD(req.usuario.id);
        if (!perfil) return res.status(404).json(NO_EXISTE);
        res.json(respuestaPerfil(perfil));
    });

    // Actualización parcial: solo cambia los campos enviados (nombre, correo, tema, paleta, voz, notificaciones…).
    // Correo y contraseña exigen la contraseña actual.
    rutas.put('/', limites.perfilSensible, async (req, res) => {
        const { error, valor } = validarPerfil(req.body, TEMAS);
        if (error) return res.status(400).json({ error });
        const cambios = { ...valor.cambios };
        if (cambios.temaSeleccionado === 'personalizado' && !cambios.coloresPersonalizados) {
            const actual = await db.obtenerPerfilBD(req.usuario.id);
            if (!actual?.coloresPersonalizados) return res.status(400).json({ error: 'Genera una paleta antes de elegir el tema personalizado.' });
        }
        if (valor.sensible) {
            if (!(await passwordCorrecta(req.usuario.id, valor.passwordActual))) return res.status(403).json({ error: 'La contraseña actual no es correcta.' });
            if (valor.passwordNueva !== undefined) cambios.passwordHash = await hashPassword(valor.passwordNueva);
        }
        const resultado = await db.actualizarPerfilBD(req.usuario.id, cambios);
        if (resultado === 'email_duplicado') return res.status(409).json({ error: 'Ese correo ya está registrado en otra cuenta.' });
        if (!resultado) return res.status(404).json(NO_EXISTE);
        // Con una contraseña nueva se cierran las demás sesiones (por si alguien más la tenía abierta)
        if (valor.passwordNueva !== undefined) await db.eliminarOtrasSesionesBD(req.usuario.id, req.tokenHash);
        res.json({ ...respuestaPerfil(resultado), passwordCambiada: valor.passwordNueva !== undefined });
    });

    // ---- Paleta con IA (Colormind): solo la genera; se guarda con PUT / { temaSeleccionado, coloresPersonalizados } ----
    rutas.post('/paleta', limites.externos, async (req, res) => {
        const { error, valor } = validarColorSemilla(req.body);
        if (error) return res.status(400).json({ error });
        res.json(await generarPaleta(valor));
    });

    // ---- Foto de perfil: cuerpo binario (la página la reduce a 256×256) ----
    const leerFoto = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_AVATAR_BYTES });
    rutas.put('/avatar', (req, res, next) => {
        leerFoto(req, res, (err) => {
            if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'La imagen supera los 200 KB (la página la reduce sola; prueba con otra foto).' });
            next(err);
        });
    }, async (req, res) => {
        const tipo = Buffer.isBuffer(req.body) ? detectarImagen(req.body) : null;
        if (!tipo || tipo !== req.get('content-type')?.split(';')[0].trim()) return res.status(415).json(NO_IMAGEN);
        await db.guardarImagenBD('avatar', req.usuario.id, tipo, req.body);
        res.json(respuestaPerfil(await db.obtenerPerfilBD(req.usuario.id)));
    });
    rutas.get('/avatar', servirImagen('avatar', 'avatar'));
    rutas.delete('/avatar', async (req, res) => {
        await db.borrarImagenBD('avatar', req.usuario.id);
        res.json(respuestaPerfil(await db.obtenerPerfilBD(req.usuario.id)));
    });

    // ---- Imagen de fondo (multipart con multer) ----
    rutas.post('/fondo', recibirFondo(), async (req, res) => {
        const tipo = detectarImagen(req.file?.buffer);
        if (!tipo) return res.status(415).json(NO_IMAGEN);
        await db.guardarImagenBD('fondo', req.usuario.id, tipo, req.file.buffer);
        req.file.buffer = null;
        res.status(201).json(respuestaPerfil(await db.obtenerPerfilBD(req.usuario.id)));
    });
    rutas.get('/fondo', servirImagen('fondo', 'fondo'));
    rutas.delete('/fondo', async (req, res) => {
        await db.borrarImagenBD('fondo', req.usuario.id);
        res.json(respuestaPerfil(await db.obtenerPerfilBD(req.usuario.id)));
    });

    // ---- Cuentas vinculadas. Hoy funcionan en modo "simulado" (ver servicios/cuenta/integraciones.js) ----
    rutas.post('/vincular', async (req, res) => {
        const servicio = validarServicio(req.body?.servicio, SERVICIOS);
        if (!servicio) return res.status(400).json({ error: `Servicio no válido. Elige: ${SERVICIOS.join(', ')}.` });
        const vinculacion = await iniciarVinculacion(servicio, req.usuario);
        const perfil = await db.fijarCuentaVinculadaBD(req.usuario.id, servicio, { vinculada: true, cuentaExterna: vinculacion.cuentaExterna });
        if (!perfil) return res.status(404).json(NO_EXISTE);
        res.status(201).json({ ...respuestaPerfil(perfil), vinculacion: { servicio, tipo: vinculacion.tipo } });
    });
    rutas.delete('/vincular/:servicio', async (req, res) => {
        const servicio = validarServicio(req.params.servicio, SERVICIOS);
        if (!servicio) return res.status(400).json({ error: 'Servicio no válido.' });
        const perfil = await db.fijarCuentaVinculadaBD(req.usuario.id, servicio, { vinculada: false });
        if (!perfil) return res.status(404).json(NO_EXISTE);
        res.json(respuestaPerfil(perfil));
    });

    // ---- Zona de peligro: borra la cuenta y todos sus datos. Exige contraseña y escribir ELIMINAR ----
    rutas.delete('/', limites.perfilSensible, async (req, res) => {
        const { error, valor } = validarEliminarCuenta(req.body);
        if (error) return res.status(400).json({ error });
        if (!(await passwordCorrecta(req.usuario.id, valor.password))) return res.status(403).json({ error: 'La contraseña no es correcta.' });
        await db.eliminarCuentaBD(req.usuario.id);
        borrarCookieSesion(res);
        res.json({ ok: true });
    });

    return rutas;
}
