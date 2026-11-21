// /api/estudio — Módulo Estudio (v3.12): objetivos de aprendizaje, sugerencias de la IA, plan de sesiones y
// análisis de documentos académicos. Todas las rutas exigen sesión y TODO se filtra por req.usuario.id.
//   GET    /api/estudio                  → objetivos (con progreso), sugerencias visibles y próximas sesiones
//   POST   /api/estudio                  → nuevo objetivo (manual)
//   PUT    /api/estudio/:id              → editar un objetivo        · DELETE /api/estudio/:id → eliminarlo
//   POST   /api/estudio/:id/sugerencia   → aceptar | posponer | descartar una sugerencia de la IA
//   POST   /api/estudio/plan             → PROPONE sesiones (no guarda nada)
//   POST   /api/estudio/sesiones         → guarda las sesiones que la persona confirmó (todo o nada, con Deshacer)
//   POST   /api/estudio/analizar         → analiza un taller/trabajo (multipart) y devuelve lo identificado (no guarda)
//   POST   /api/estudio/lote             → guarda los temas (y la entrega) que la persona confirmó tras el análisis
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi } from '../middleware/autenticacion.js';
import {
    validarObjetivo, validarAccionSugerencia, validarPeticionPlan, validarSesionesConfirmadas, validarLoteDocumento, esIdObjetivo,
    limpiarTextoVisible, validarActividad
} from '../validacion/index.js';
import { zonaDe, ahoraEn, ahoraDelUsuario } from '../servicios/tiempo.js';
import { capacidadDe } from '../../compartido/carga.js';
import { sumarDias, aMinutos, deMinutos } from '../../compartido/fechas.js';
import { normalizarTexto } from '../servicios/asistente/interprete-lenguaje.js';
import { modeloVision } from '../servicios/asistente/cliente-ollama.js';
import { planificarEstudio, revisarSesionesConfirmadas } from '../servicios/estudio/planificador-estudio.js';
import { conResumen, sugerenciaVisible, planParaObjetivos, analizarDocumentoAcademico } from '../servicios/estudio/asistente-estudio.js';
import { recibirArchivo } from './asistente.rutas.js';

const MAX_PROXIMAS = 12;
const ahora = (req) => ahoraEn(zonaDe(req));
const noEncontrado = (res) => res.status(404).json({ error: 'Tema de estudio no encontrado.' });

/** Lo que necesita el planificador: actividades, capacidades por día (check-ins) y la hora local */
async function contextoAgenda(req) {
    const { fecha: hoy, hora } = ahora(req);
    const [actividades, checkins] = await Promise.all([
        db.obtenerActividadesBD(req.usuario.id),
        db.obtenerCheckinsBD(req.usuario.id, hoy, sumarDias(hoy, 400))
    ]);
    return {
        userId: req.usuario.id, hoy, horaActual: hora, actividades,
        capacidades: Object.fromEntries(checkins.map((c) => [c.fecha, capacidadDe(c)]))
    };
}

/** Escribe un lote de operaciones con «Deshacer»; sin transacciones, si algo falla a medias se compensa */
async function aplicarLote(userId, operaciones) {
    const loteId = db.nuevoId();
    try {
        const { resultado, degradado } = await db.conTransaccion((session) => db.aplicarCambiosBD(userId, operaciones, { session, origen: 'manual', loteId }));
        return { ...resultado, degradado };
    } catch (e) {
        if (!db.transaccionesDisponibles()) await db.deshacerLoteBD(userId, loteId).catch(() => {});
        throw e;
    }
}

export function crearRutasEstudio(limites) {
    const rutas = express.Router();
    rutas.use(requiereAuthApi);

    rutas.get('/', async (req, res) => {
        const { fecha: hoy } = ahora(req);
        const [objetivos, sesiones] = await Promise.all([db.listarObjetivosBD(req.usuario.id), db.obtenerSesionesEstudioBD(req.usuario.id)]);
        const temaDe = new Map(objetivos.map((o) => [o.id, o.tema]));
        const proximas = sesiones.filter((s) => s.estado !== 'completado' && s.fecha_inicio >= hoy && temaDe.has(s.objetivoId))
            .slice(0, MAX_PROXIMAS).map((s) => ({ ...s, tema: temaDe.get(s.objetivoId) }));
        res.json({
            hoy,
            objetivos: objetivos.filter((o) => ['pendiente', 'en_curso', 'completado'].includes(o.estado)).map((o) => conResumen(o, sesiones, hoy)),
            sugerencias: objetivos.filter((o) => sugerenciaVisible(o, hoy)).map((o) => conResumen(o, sesiones, hoy)),
            pospuestas: objetivos.filter((o) => o.estado === 'sugerido' && !sugerenciaVisible(o, hoy)).length,
            proximasSesiones: proximas
        });
    });

    rutas.post('/', async (req, res) => {
        const { fecha: hoy } = ahora(req);
        const { error, valor } = validarObjetivo(req.body, { hoy });
        if (error) return res.status(400).json({ error });
        const r = await db.crearObjetivoBD(req.usuario.id, { ...valor, origen: 'manual' });
        if (r.existente) return res.status(409).json({ error: `Ya tienes «${r.objetivo.tema}» en Estudio.`, objetivo: r.objetivo });
        const sesiones = await db.obtenerSesionesEstudioBD(req.usuario.id);
        res.status(201).json({ objetivo: conResumen(r.objetivo, sesiones, hoy), reactivado: Boolean(r.reactivado) });
    });

    // Rutas fijas ANTES que /:id
    rutas.post('/plan', async (req, res) => {
        const { error, valor } = validarPeticionPlan(req.body);
        if (error) return res.status(400).json({ error });
        const objetivos = await db.obtenerObjetivosBD(req.usuario.id, valor.ids);
        if (!objetivos) return noEncontrado(res);
        const ctx = await contextoAgenda(req);
        const plan = planificarEstudio({ ...ctx, objetivos, horasPorSesion: valor.horasPorSesion, maxPorDia: valor.maxPorDia });
        res.json({ plan: { ...plan, temas: objetivos.map((o) => ({ id: o.id, tema: o.tema, fechaLimite: o.fechaLimite ?? null })) } });
    });

    rutas.post('/sesiones', async (req, res) => {
        const { error, valor } = validarSesionesConfirmadas(req.body);
        if (error) return res.status(400).json({ error });
        const objetivos = await db.obtenerObjetivosBD(req.usuario.id, valor.map((s) => s.objetivoId));
        if (!objetivos) return noEncontrado(res);
        const ctx = await contextoAgenda(req);
        // Se vuelve a comprobar TODO contra el calendario actual (pudo cambiar mientras la persona revisaba el plan)
        const r = revisarSesionesConfirmadas({ ...ctx, objetivosPorId: new Map(objetivos.map((o) => [o.id, o])), sesiones: valor });
        if (r.conflictos.length) {
            return res.status(409).json({ error: 'Algunas sesiones ya no caben: corrígelas y vuelve a guardar. No guardé ninguna.', conflictos: r.conflictos });
        }
        const resultado = await aplicarLote(req.usuario.id, r.datos.map((datos) => ({ op: 'crear', datos })));
        // Un tema con sesiones programadas pasa de «pendiente» a «en curso»
        for (const o of objetivos.filter((x) => x.estado === 'pendiente')) await db.actualizarObjetivoBD(req.usuario.id, o.id, { estado: 'en_curso' });
        const n = resultado.total;
        res.status(201).json({
            mensaje: `Guardé ${n} ${n === 1 ? 'sesión' : 'sesiones'} de estudio en tu calendario.`, loteId: resultado.loteId,
            avisos: [...r.avisos, ...(resultado.degradado ? ['Tu MongoDB no admite transacciones: se guardaron una a una.'] : [])],
            actividades: await db.obtenerActividadesBD(req.usuario.id)
        });
    });

    rutas.post('/analizar', limites.archivos, recibirArchivo(), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo.' });
        const { fecha: hoy, zona } = ahora(req);
        const ctx = { userId: req.usuario.id, hoy, identidad: { nombreIA: req.usuario.nombreIA, ahora: ahoraDelUsuario({ fechaHoy: hoy, zona }) } };
        try {
            res.json(await analizarDocumentoAcademico(ctx, {
                nombre: req.file.originalname, buffer: req.file.buffer, instruccion: limpiarTextoVisible(req.body?.instruccion, 300), vision: Boolean(modeloVision())
            }));
        } finally {
            req.file.buffer = null;      // el documento no se guarda en ningún sitio
        }
    });

    rutas.post('/lote', async (req, res) => {
        const { fecha: hoy } = ahora(req);
        const { error, valor } = validarLoteDocumento(req.body, { hoy });
        if (error) return res.status(400).json({ error });
        const proyecto = limpiarTextoVisible(req.body?.proyecto ?? '', 60);
        const creados = [], existentes = [];
        for (const o of valor.objetivos) {
            const r = await db.crearObjetivoBD(req.usuario.id, { ...o, origen: 'documento', proyecto });
            (r.existente ? existentes : creados).push(r.objetivo);
        }
        let entrega = null;
        const avisos = [];
        if (valor.entrega) {
            const e = valor.entrega;
            const actividades = await db.obtenerActividadesBD(req.usuario.id);
            const repetida = actividades.find((a) => normalizarTexto(a.titulo) === normalizarTexto(e.titulo) && a.fecha_inicio === e.fecha);
            if (repetida) avisos.push(`«${repetida.titulo}» ya estaba en tu calendario el ${e.fecha}: no la dupliqué.`);
            else {
                const fin = e.hora_inicio && aMinutos(e.hora_inicio) + 60 < 24 * 60 ? deMinutos(aMinutos(e.hora_inicio) + 60) : null;
                const { error: errAct, valor: datos } = validarActividad({
                    titulo: e.titulo, tipo: 'estudio', exigencia: 3, horas: 1, fecha_inicio: e.fecha, fecha_fin: e.fecha,
                    hora_inicio: fin ? e.hora_inicio : null, hora_fin: fin, estado: 'pendiente', proyecto
                });
                if (errAct) return res.status(400).json({ error: `Entrega: ${errAct}` });
                const r = await aplicarLote(req.usuario.id, [{ op: 'crear', datos: { ...datos, fija: true, fecha_vencimiento: e.fecha, fecha_asignacion: hoy } }]);
                entrega = { loteId: r.loteId, id: r.creadas[0] };
            }
        }
        const sesiones = await db.obtenerSesionesEstudioBD(req.usuario.id);
        res.status(201).json({
            mensaje: `Guardé ${creados.length} ${creados.length === 1 ? 'tema' : 'temas'} en Estudio${entrega ? ' y la entrega en tu calendario' : ''}.`,
            creados: creados.map((o) => conResumen(o, sesiones, hoy)), existentes: existentes.map((o) => ({ id: o.id, tema: o.tema })), entrega, avisos
        });
    });

    rutas.put('/:id', async (req, res) => {
        if (!esIdObjetivo(req.params.id)) return noEncontrado(res);
        const { fecha: hoy } = ahora(req);
        const { error, valor } = validarObjetivo(req.body, { completa: false, hoy });
        if (error) return res.status(400).json({ error });
        if (Object.keys(valor).length === 0) return res.status(400).json({ error: 'No hay cambios.' });
        const actual = await db.obtenerObjetivoBD(req.usuario.id, req.params.id);
        if (!actual) return noEncontrado(res);
        if (actual.estado === 'sugerido' || actual.estado === 'descartado') delete valor.estado;     // eso va por /sugerencia
        const objetivo = await db.actualizarObjetivoBD(req.usuario.id, req.params.id, valor);
        const sesiones = await db.obtenerSesionesEstudioBD(req.usuario.id);
        res.json({ objetivo: conResumen(objetivo, sesiones, hoy) });
    });

    rutas.delete('/:id', async (req, res) => {
        if (!esIdObjetivo(req.params.id)) return noEncontrado(res);
        const ok = await db.eliminarObjetivoBD(req.usuario.id, req.params.id);
        if (!ok) return noEncontrado(res);
        res.json({ mensaje: 'Tema eliminado. Sus sesiones siguen en el calendario como actividades normales.' });
    });

    rutas.post('/:id/sugerencia', async (req, res) => {
        if (!esIdObjetivo(req.params.id)) return noEncontrado(res);
        const { error, valor } = validarAccionSugerencia(req.body);
        if (error) return res.status(400).json({ error });
        const objetivo = await db.obtenerObjetivoBD(req.usuario.id, req.params.id);
        if (!objetivo) return noEncontrado(res);
        if (objetivo.estado !== 'sugerido') return res.status(409).json({ error: 'Esa sugerencia ya se respondió.' });
        const { fecha: hoy } = ahora(req);
        const cambios = valor.accion === 'aceptar' ? { estado: 'pendiente', posponerHasta: null }
            // Al descartar se borra el motivo (puede citar una frase del chat): solo queda el tema, para no volver a sugerirlo
            : valor.accion === 'descartar' ? { estado: 'descartado', posponerHasta: null, motivo: '' }
                : { posponerHasta: sumarDias(hoy, valor.dias) };
        const actualizado = await db.actualizarObjetivoBD(req.usuario.id, objetivo.id, cambios);
        const sesiones = await db.obtenerSesionesEstudioBD(req.usuario.id);
        const mensaje = valor.accion === 'aceptar' ? `«${objetivo.tema}» ya está en Estudio.`
            : valor.accion === 'descartar' ? `Descarté «${objetivo.tema}»: no te lo volveré a sugerir salvo que tú lo pidas.`
                : `Te lo recuerdo dentro de ${valor.dias} ${valor.dias === 1 ? 'día' : 'días'}.`;
        const cuerpo = { mensaje, objetivo: conResumen(actualizado, sesiones, hoy) };
        if (valor.accion === 'aceptar' && valor.planificar) {
            const ctx = await contextoAgenda(req);
            const r = await planParaObjetivos(ctx, [actualizado]);
            cuerpo.plan = r.plan ?? null;
            if (!r.plan) cuerpo.avisos = [r.mensaje];
        }
        res.json(cuerpo);
    });

    return rutas;
}
