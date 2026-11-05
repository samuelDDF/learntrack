// /api/auth: registro, inicio y cierre de sesión, y quién soy.
import express from 'express';
import * as db from '../datos/index.js';
import { hashPassword, verificarPassword, gastarTiempoDeLogin } from '../servicios/cuenta/contrasenas.js';
import { iniciarSesion, cerrarSesion } from '../middleware/autenticacion.js';
import { validarRegistro, validarLogin } from '../validacion/index.js';

const MENSAJE_DUPLICADO = 'Ese correo ya está registrado. Inicia sesión.';

export function crearRutasAuth(limites) {
    const rutas = express.Router();

    rutas.get('/me', (req, res) => {
        const u = req.usuario;
        res.json({ usuario: u ? { id: u.id, nombre: u.nombre, email: u.email, temaEstetico: u.temaEstetico } : null });
    });

    rutas.post('/registro', limites.registro, async (req, res) => {
        const { error, valor } = validarRegistro(req.body);
        if (error) return res.status(400).json({ error });
        if (await db.buscarUsuarioPorEmail(valor.email)) return res.status(409).json({ error: MENSAJE_DUPLICADO });
        const usuario = await db.crearUsuarioBD({
            id: db.nuevoId(), nombre: valor.nombre, email: valor.email,
            passwordHash: await hashPassword(valor.password), creado: new Date().toISOString()
        });
        if (!usuario) return res.status(409).json({ error: MENSAJE_DUPLICADO });
        await iniciarSesion(res, usuario.id);
        res.status(201).json({ usuario: { nombre: usuario.nombre, email: usuario.email } });
    });

    rutas.post('/login', limites.loginIp, limites.loginCuenta, async (req, res) => {
        const { error, valor } = validarLogin(req.body);
        if (error) return res.status(400).json({ error });
        const usuario = await db.buscarUsuarioPorEmail(valor.email);
        const credencialesOk = usuario
            ? await verificarPassword(valor.password, usuario.passwordHash)
            : (await gastarTiempoDeLogin(valor.password), false);
        if (!credencialesOk) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        await iniciarSesion(res, usuario.id);
        res.json({ usuario: { nombre: usuario.nombre, email: usuario.email } });
    });

    rutas.post('/logout', async (req, res) => {
        await cerrarSesion(req, res);
        res.json({ ok: true });
    });

    return rutas;
}
