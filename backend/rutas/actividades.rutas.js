// /api/actividades (CRUD manual: funciona aunque Ollama no esté; auto-estado; archivadas), /api/papelera y
// /api/proyectos (resumen de cada proyecto con su progreso).
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi } from '../middleware/autenticacion.js';
import { validarActividad, esIdActividad } from '../validacion/index.js';
import { capacidadDe, diasSaturados } from '../../compartido/carga.js';
import { prioridadDe, porUrgencia } from '../../compartido/prioridad.js';
import { zonaDe, ahoraEn } from '../servicios/tiempo.js';

const NO_ENCONTRADA = 'Actividad no encontrada o no tienes permisos para modificarla.';

export function crearRutasActividades() {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    // AUTO-ESTADO: antes de responder, las pendientes cuyo horario incluye la hora actual del usuario pasan a
    // «en proceso» (zona horaria del navegador, cabecera X-Zona-Horaria). ?archivadas=incluir añade las archivadas.
    rutas.get('/', async (req, res) => {
        await db.actualizarEstadosAutomaticosBD(req.usuario.id, ahoraEn(zonaDe(req)));
        res.json(await db.obtenerActividadesBD(req.usuario.id, { incluirArchivadas: req.query.archivadas === 'incluir' }));
    });

    rutas.post('/', async (req, res) => {
        const { error, valor } = validarActividad(req.body);
        if (error) return res.status(400).json({ error });
        const fecha_asignacion = valor.fecha_asignacion ?? ahoraEn(zonaDe(req)).fecha;
        res.json(await db.guardarActividadBD(req.usuario.id, { id: db.nuevoId(), ...valor, fecha_asignacion }));
    });

    // Archivadas por la limpieza automática (completadas con el vencimiento pasado)
    rutas.get('/archivadas', async (req, res) => {
        res.json(await db.obtenerArchivadasBD(req.usuario.id));
    });
    rutas.post('/:id/desarchivar', async (req, res) => {
        const lista = esIdActividad(req.params.id) ? await db.desarchivarActividadBD(req.usuario.id, req.params.id) : null;
        if (!lista) return res.status(404).json({ error: 'Esa actividad no está archivada.' });
        res.json(lista);
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

/** Resumen de un proyecto: progreso, fechas, vencimiento más próximo y prioridad (incluye las archivadas) */
export function resumirProyectos(actividades, hoy) {
    const grupos = new Map();
    for (const a of actividades) {
        if (!a.proyecto) continue;
        if (!grupos.has(a.proyecto)) grupos.set(a.proyecto, []);
        grupos.get(a.proyecto).push(a);
    }
    return [...grupos.entries()].map(([nombre, lista]) => {
        const cuenta = (e) => lista.filter((a) => a.estado === e).length;
        const completadas = cuenta('completado');
        const pendientesOrdenadas = lista.filter((a) => a.estado !== 'completado').sort(porUrgencia(hoy));
        const fechas = lista.flatMap((a) => [a.fecha_inicio, a.fecha_fin, a.fecha_vencimiento].filter(Boolean)).sort();
        const siguiente = pendientesOrdenadas[0] ?? null;
        return {
            nombre, total: lista.length, completadas, enProceso: cuenta('en_proceso'), pendientes: cuenta('pendiente'),
            progreso: lista.length ? Math.round((completadas / lista.length) * 100) : 0,
            inicio: fechas[0] ?? null, fin: fechas.at(-1) ?? null,
            prioridad: siguiente ? prioridadDe(siguiente, hoy).nivel : 'ninguna',
            siguiente: siguiente ? { id: siguiente.id, titulo: siguiente.titulo, fecha: siguiente.fecha_inicio } : null
        };
    }).sort((x, y) => (x.progreso === 100) - (y.progreso === 100) || (x.fin ?? '').localeCompare(y.fin ?? '') || x.nombre.localeCompare(y.nombre, 'es'));
}

export function crearRutasProyectos() {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);
    rutas.get('/', async (req, res) => {
        const hoy = ahoraEn(zonaDe(req)).fecha;
        res.json({ hoy, proyectos: resumirProyectos(await db.obtenerActividadesBD(req.usuario.id, { incluirArchivadas: true }), hoy) });
    });
    return rutas;
}
