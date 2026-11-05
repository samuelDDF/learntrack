// /api/contacto: formulario público de la página de inicio (con límite por IP).
import express from 'express';
import * as db from '../datos/index.js';
import { validarContacto } from '../validacion/index.js';

export function crearRutasContacto(limites) {
    const rutas = express.Router();
    rutas.post('/', limites.contacto, async (req, res) => {
        const { error, valor } = validarContacto(req.body);
        if (error) return res.status(400).json({ error });
        await db.guardarMensajeBD({ id: db.nuevoId(), ...valor, fecha: new Date().toISOString() });
        res.status(201).json({ ok: true });
    });
    return rutas;
}
