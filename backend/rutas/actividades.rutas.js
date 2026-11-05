// /api/actividades (CRUD manual: funciona aunque Ollama no esté) y /api/papelera.
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi } from '../middleware/autenticacion.js';
import { validarActividad, esIdActividad } from '../validacion/index.js';
import { capacidadDe, diasSaturados } from '../../compartido/carga.js';

const NO_ENCONTRADA = 'Actividad no encontrada o no tienes permisos para modificarla.';

export function crearRutasActividades() {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    rutas.get('/', async (req, res) => {
        res.json(await db.obtenerActividadesBD(req.usuario.id));
    });

    rutas.post('/', async (req, res) => {
        const { error, valor } = validarActividad(req.body);
        if (error) return res.status(400).json({ error });
        res.json(await db.guardarActividadBD(req.usuario.id, { id: db.nuevoId(), ...valor }));
    });

    // Edición parcial: solo cambian los campos enviados
    rutas.put('/:id', async (req, res) => {
        if (!esIdActividad(req.params.id)) return res.status(404).json({ error: NO_ENCONTRADA });
        const { error, valor } = validarActividad(req.body, { completa: false });
        if (error) return res.status(400).json({ error });
        if (Object.keys(valor).length === 0) return res.status(400).json({ error: 'No hay cambios que guardar.' });
        const lista = await db.actualizarActividadBD(req.usuario.id, req.params.id, valor);
        if (!lista) return res.status(404).json({ error: NO_ENCONTRADA });
        res.json(lista);
    });

    // Borrado lógico: va a la papelera (se puede restaurar)
    rutas.delete('/:id', async (req, res) => {
        const lista = esIdActividad(req.params.id) ? await db.eliminarActividadBD(req.usuario.id, req.params.id) : null;
        if (!lista) return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos para eliminarla.' });
        res.json(lista);
    });

    return rutas;
}

export function crearRutasPapelera() {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    rutas.get('/', async (req, res) => {
        res.json({ dias: db.diasPapelera(), actividades: await db.obtenerPapeleraBD(req.usuario.id) });
    });

    // Restaura y avisa si algún día del rango queda saturado
    rutas.post('/:id/restaurar', async (req, res) => {
        const restaurada = esIdActividad(req.params.id) ? await db.restaurarActividadBD(req.usuario.id, req.params.id) : null;
        if (!restaurada) return res.status(404).json({ error: 'No está en la papelera (o ya se restauró).' });
        const [actividades, checkins] = await Promise.all([
            db.obtenerActividadesBD(req.usuario.id),
            db.obtenerCheckinsBD(req.usuario.id, restaurada.fecha_inicio, restaurada.fecha_fin)
        ]);
        const capacidades = Object.fromEntries(checkins.map((c) => [c.fecha, capacidadDe(c)]));
        const [saturado] = diasSaturados(actividades, restaurada, capacidades);
        const avisos = saturado ? [`Ojo: el ${saturado.fecha} queda en ${saturado.porcentaje} % de carga.`] : [];
        res.json({ restaurada, actividades, avisos });
    });

    return rutas;
}
