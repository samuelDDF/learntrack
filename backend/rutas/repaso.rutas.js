// /api/repaso — Sistema de Repaso Espaciado (SM-2)
// Endpoints:
//   GET  /api/repaso/pendientes         → actividades con repaso pendiente hoy (o atrasadas)
//   GET  /api/repaso                    → todas las actividades con repaso activo
//   POST /api/repaso/:id/activar        → activa el repaso espaciado en una actividad
//   POST /api/repaso/:id/calificar      → califica un repaso y calcula la próxima fecha
//   POST /api/repaso/:id/desactivar     → desactiva el repaso espaciado de una actividad
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi } from '../middleware/autenticacion.js';
import { esIdActividad } from '../validacion/actividades.js';
import { validarCalificacion } from '../validacion/repaso.js';
import { calcularRepaso } from '../servicios/repaso-espaciado.js';
import { zonaDe, ahoraEn } from '../servicios/tiempo.js';

export function crearRutasRepaso() {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    // ---- Listar todas las actividades con repaso activo ----
    rutas.get('/', async (req, res) => {
        const actividades = await db.obtenerActividadesConRepasoBD(req.usuario.id);
        res.json({ actividades });
    });

    // ---- Listar repasos pendientes (vencidos o para hoy) ----
    rutas.get('/pendientes', async (req, res) => {
        const hoy = ahoraEn(zonaDe(req)).fecha;
        const actividades = await db.obtenerRepasosPendientesBD(req.usuario.id, hoy);
        res.json({ hoy, pendientes: actividades.length, actividades });
    });

    // ---- Activar repaso espaciado en una actividad ----
    rutas.post('/:id/activar', async (req, res) => {
        if (!esIdActividad(req.params.id)) {
            return res.status(400).json({ error: 'Identificador de actividad no válido.' });
        }

        const hoy = ahoraEn(zonaDe(req)).fecha;
        const proximaFecha = req.body.proximaFecha ?? hoy;    // por defecto, primer repaso hoy

        if (!/^\d{4}-\d{2}-\d{2}$/.test(proximaFecha)) {
            return res.status(400).json({ error: 'Fecha no válida (formato YYYY-MM-DD).' });
        }

        const actividad = await db.activarRepasoBD(req.usuario.id, req.params.id, proximaFecha);
        if (!actividad) {
            return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos.' });
        }

        res.json({ mensaje: 'Repaso espaciado activado.', actividad });
    });

    // ---- Calificar un repaso (endpoint principal) ----
    // El flujo completo:
    //   1. El cliente envía { calificacion: 0–5 }
    //   2. Se valida la calificación
    //   3. Se obtiene la actividad con sus parámetros de repaso actuales
    //   4. Se llama a calcularRepaso() (algoritmo SM-2 puro)
    //   5. Se actualiza la actividad en la base de datos con los nuevos valores
    //   6. Se responde con la actividad actualizada
    rutas.post('/:id/calificar', async (req, res) => {
        if (!esIdActividad(req.params.id)) {
            return res.status(400).json({ error: 'Identificador de actividad no válido.' });
        }

        // Paso 1–2: Validar la calificación
        const { error, calificacion } = validarCalificacion(req.body?.calificacion);
        if (error) return res.status(400).json({ error });

        // Paso 3: Obtener la actividad con sus datos de repaso
        const actividad = await db.obtenerActividadConRepasoBD(req.usuario.id, req.params.id);
        if (!actividad) {
            return res.status(404).json({
                error: 'Actividad no encontrada, sin repaso activo, o no tienes permisos.'
            });
        }

        // Paso 4: Calcular los nuevos parámetros (SM-2)
        const hoy = ahoraEn(zonaDe(req)).fecha;
        const resultado = calcularRepaso({
            intervalo: actividad.repaso.intervalo,
            facilidad: actividad.repaso.facilidad,
            repeticiones: actividad.repaso.repeticiones,
            calificacion,
            fechaRepaso: hoy
        });

        // Paso 5: Persistir en la base de datos
        const actualizada = await db.actualizarRepasoBD(req.usuario.id, req.params.id, {
            facilidad: resultado.facilidad,
            intervalo: resultado.intervalo,
            repeticiones: resultado.repeticiones,
            proximaFecha: resultado.proximaFecha,
            ultimoRepaso: hoy,
            ultimaCalificacion: calificacion
        });

        if (!actualizada) {
            return res.status(500).json({ error: 'No se pudo actualizar el repaso.' });
        }

        // Paso 6: Responder con el detalle del cálculo
        res.json({
            mensaje: 'Repaso registrado.',
            calificacion,
            resultado: {
                facilidad: resultado.facilidad,
                intervalo: resultado.intervalo,
                repeticiones: resultado.repeticiones,
                proximaFecha: resultado.proximaFecha
            },
            actividad: actualizada
        });
    });

    // ---- Desactivar repaso espaciado ----
    rutas.post('/:id/desactivar', async (req, res) => {
        if (!esIdActividad(req.params.id)) {
            return res.status(400).json({ error: 'Identificador de actividad no válido.' });
        }

        const actividad = await db.desactivarRepasoBD(req.usuario.id, req.params.id);
        if (!actividad) {
            return res.status(404).json({ error: 'Actividad no encontrada o no tienes permisos.' });
        }

        res.json({ mensaje: 'Repaso espaciado desactivado.', actividad });
    });

    return rutas;
}

