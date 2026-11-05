// /api/perfil: datos, foto, cuentas vinculadas y baja de la cuenta.
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi, borrarCookieSesion } from '../middleware/autenticacion.js';
import { validarPerfil, validarServicio, validarEliminarCuenta } from '../validacion/index.js';
import { hashPassword, verificarPassword } from '../servicios/cuenta/contrasenas.js';
import { detectarImagen, MAX_AVATAR_BYTES } from '../servicios/cuenta/avatar.js';
import { iniciarVinculacion, modoIntegraciones, NOMBRES_SERVICIO } from '../servicios/cuenta/integraciones.js';
import { TEMAS, SERVICIOS } from '../modelos/Usuario.js';

/** Lo que recibe la pantalla de perfil (nunca incluye el hash de la contraseña ni tokens) */
const respuestaPerfil = (perfil) => ({
    perfil: { ...perfil, avatarUrl: perfil.avatarActualizado ? `/api/perfil/avatar?v=${new Date(perfil.avatarActualizado).getTime()}` : null },
    integraciones: { modo: modoIntegraciones(), servicios: SERVICIOS.map((id) => ({ id, nombre: NOMBRES_SERVICIO[id] })) },
    temas: TEMAS
});
const NO_EXISTE = { error: 'Cuenta no encontrada.' };

/** ¿Es correcta la contraseña del usuario? */
async function passwordCorrecta(userId, password) {
    const hash = await db.obtenerPasswordHashBD(userId);
    return Boolean(hash) && verificarPassword(password, hash);
}

export function crearRutasPerfil(limites) {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    rutas.get('/', async (req, res) => {
        const perfil = await db.obtenerPerfilBD(req.usuario.id);
        if (!perfil) return res.status(404).json(NO_EXISTE);
        res.json(respuestaPerfil(perfil));
    });

    // Actualización parcial: solo cambia los campos enviados. Correo y contraseña exigen la contraseña actual.
    rutas.put('/', limites.perfilSensible, async (req, res) => {
        const { error, valor } = validarPerfil(req.body, TEMAS);
        if (error) return res.status(400).json({ error });
        const cambios = { ...valor.cambios };
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

    // Foto de perfil: cuerpo binario (la página la reduce a 256×256). Se valida por la firma real del archivo.
    const leerImagen = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_AVATAR_BYTES });
    rutas.put('/avatar', (req, res, next) => {
        leerImagen(req, res, (err) => {
            if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'La imagen supera los 200 KB (la página la reduce sola; prueba con otra foto).' });
            next(err);
        });
    }, async (req, res) => {
        const tipo = Buffer.isBuffer(req.body) ? detectarImagen(req.body) : null;
        if (!tipo || tipo !== req.get('content-type')?.split(';')[0].trim()) return res.status(415).json({ error: 'El archivo no es una imagen JPEG, PNG o WebP válida.' });
        await db.guardarAvatarBD(req.usuario.id, tipo, req.body);
        res.json(respuestaPerfil(await db.obtenerPerfilBD(req.usuario.id)));
    });
    rutas.get('/avatar', async (req, res) => {
        const avatar = await db.obtenerAvatarBD(req.usuario.id);
        if (!avatar) return res.status(404).json({ error: 'Sin foto de perfil.' });
        // La URL lleva ?v=fecha, así que se puede guardar en caché del navegador (privada: no en cachés compartidas)
        res.set({ 'Content-Type': avatar.tipo, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': 'inline; filename="avatar"' });
        res.send(avatar.datos);
    });
    rutas.delete('/avatar', async (req, res) => {
        await db.borrarAvatarBD(req.usuario.id);
        res.json(respuestaPerfil(await db.obtenerPerfilBD(req.usuario.id)));
    });

    // Cuentas vinculadas. Hoy funcionan en modo "simulado" (ver servicios/cuenta/integraciones.js).
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

    // Zona de peligro: borra la cuenta y todos sus datos. Exige contraseña y escribir ELIMINAR.
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
