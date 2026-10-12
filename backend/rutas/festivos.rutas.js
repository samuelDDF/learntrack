// /api/festivos: países y regiones disponibles, importación (fusión) y consulta de los festivos del usuario.
// Los festivos viven en el usuario (eventosImportados), separados de sus actividades: importarlos o quitarlos
// nunca crea, cambia ni borra una actividad.
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi } from '../middleware/autenticacion.js';
import { validarImportarFestivos, validarAnio, esFechaValida } from '../validacion/index.js';
import { listarPaises, regionesDe, festivosParaImportar, esCodigoPais } from '../servicios/externos/festivos.js';

export function crearRutasFestivos(limites) {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    // Festivos ya importados (para pintarlos en la agenda y el panel)
    rutas.get('/', async (req, res) => {
        const { desde, hasta } = req.query;
        if ((desde !== undefined && !esFechaValida(desde)) || (hasta !== undefined && !esFechaValida(hasta))) return res.status(400).json({ error: 'Rango de fechas no válido.' });
        res.json({ festivos: await db.obtenerFestivosBD(req.usuario.id, desde, hasta) });
    });

    rutas.get('/paises', limites.externos, async (req, res) => {
        res.json({ paises: await listarPaises() });
    });

    rutas.get('/regiones', limites.externos, async (req, res) => {
        const pais = String(req.query.pais ?? '').toUpperCase();
        const anio = validarAnio(req.query.anio);
        if (!esCodigoPais(pais) || !anio) return res.status(400).json({ error: 'País o año no válidos.' });
        res.json({ regiones: await regionesDe(pais, anio) });
    });

    // FUSIÓN: añade solo los festivos que faltan (ver importarFestivosBD). Nunca toca las actividades.
    rutas.post('/importar', limites.externos, async (req, res) => {
        const { error, valor } = validarImportarFestivos(req.body);
        if (error) return res.status(400).json({ error });
        const { pais, region, anio } = valor;
        const lista = await festivosParaImportar(pais, anio, region);
        if (lista.length === 0) return res.status(404).json({ error: 'No hay festivos publicados para ese país y año.' });
        const r = await db.importarFestivosBD(req.usuario.id, lista.map((f) => ({ fecha: f.fecha, nombre: f.nombre, nombreIngles: f.nombreIngles, pais, region: f.nacional ? null : region })));
        res.status(201).json({ ...r, encontrados: lista.length, festivos: await db.obtenerFestivosBD(req.usuario.id) });
    });

    // Quitar festivos importados (todos o los de un país)
    rutas.delete('/', async (req, res) => {
        const pais = req.query.pais === undefined ? null : String(req.query.pais).toUpperCase();
        if (pais !== null && !esCodigoPais(pais)) return res.status(400).json({ error: 'País no válido.' });
        res.json({ eliminados: await db.eliminarFestivosBD(req.usuario.id, pais) });
    });

    return rutas;
}
