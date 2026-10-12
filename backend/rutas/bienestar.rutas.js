// /api/checkin(s) (cómo te sientes hoy: fija tu capacidad del día) e /api/historial (carga de días pasados).
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi } from '../middleware/autenticacion.js';
import { validarCheckin, validarHistorial, esFechaValida } from '../validacion/index.js';
import { cargaDelDia, capacidadDe } from '../../compartido/carga.js';
import { diasEntre } from '../../compartido/fechas.js';

export function crearRutasBienestar() {
    const rutas = express.Router();

    rutas.get('/checkin', requiereAuthApi, async (req, res) => {
        if (!esFechaValida(req.query.fecha)) return res.status(400).json({ error: 'Fecha no válida.' });
        res.json({ checkin: await db.obtenerCheckinBD(req.usuario.id, req.query.fecha) });
    });
    rutas.get('/checkins', requiereAuthApi, async (req, res) => {
        const { desde, hasta } = req.query;
        if (!esFechaValida(desde) || !esFechaValida(hasta) || hasta < desde || diasEntre(desde, hasta) > 400) return res.status(400).json({ error: 'Rango de fechas no válido.' });
        res.json({ checkins: await db.obtenerCheckinsBD(req.usuario.id, desde, hasta) });
    });
    rutas.put('/checkin', requiereAuthApi, async (req, res) => {
        const { error, valor } = validarCheckin(req.body);
        if (error) return res.status(400).json({ error });
        res.json({ checkin: await db.guardarCheckinBD(req.usuario.id, valor) });
    });

    // El servidor calcula el % con la regla única; solo se guardan días <= hoy
    rutas.get('/historial', requiereAuthApi, async (req, res) => {
        res.json(await db.obtenerHistorialBD(req.usuario.id));
    });
    rutas.post('/historial', requiereAuthApi, async (req, res) => {
        const { error, valor } = validarHistorial(req.body);
        if (error) return res.status(400).json({ error });
        const [actividades, checkin] = await Promise.all([db.obtenerActividadesBD(req.usuario.id), db.obtenerCheckinBD(req.usuario.id, valor.fecha)]);
        const { porcentaje } = cargaDelDia(actividades, valor.fecha, capacidadDe(checkin));
        res.json(await db.guardarHistorialBD(req.usuario.id, valor.fecha, porcentaje));
    });

    return rutas;
}
