// Asistente de IA: /api/ia/* (chat, archivos, consejo, capacidades), /api/propuestas/* y /api/operaciones/*.
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAuthApi } from '../middleware/autenticacion.js';
import {
    validarEntradaChat, validarConsultaIA, validarFechaHoy, validarTzOffset, esIdPropuesta, esIdLote, limpiarTextoVisible, validarHoraLocal, validarContextoChat
} from '../validacion/index.js';
import { consultarIA, modeloVision } from '../servicios/asistente/cliente-ollama.js';
import { procesarChat, procesarArchivo, aplicarPropuesta, deshacerLote } from '../servicios/asistente/orquestador-chat.js';
import { LIMITE_BYTES, capacidadesArchivos } from '../servicios/archivos/lector-documentos.js';
import { zonaDe, ahoraDelUsuario } from '../servicios/tiempo.js';

// multer es opcional: sin él la carga de archivos se desactiva con un mensaje claro
let multer = null;
try { multer = (await import('multer')).default; } catch { console.warn('Carga de archivos desactivada: falta la dependencia "multer".'); }

const ERRORES_MULTER = {
    LIMIT_FILE_SIZE: [413, 'El archivo supera el máximo de 5 MB.'],
    LIMIT_FILE_COUNT: [400, 'Sube un solo archivo a la vez.'],
    LIMIT_UNEXPECTED_FILE: [400, 'Sube un solo archivo a la vez (campo "archivo").'],
    LIMIT_PART_COUNT: [400, 'Petición de archivo no válida.'],
    LIMIT_FIELD_COUNT: [400, 'Petición de archivo no válida.'],
    LIMIT_FIELD_VALUE: [400, 'Petición de archivo no válida.']
};
const SIN_FECHA = 'Falta la fecha local (fechaHoy, YYYY-MM-DD).';

/** Recibe UN archivo en memoria (nunca toca el disco) y traduce los errores de multer a mensajes claros */
function recibirArchivo() {
    const subir = multer?.({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_BYTES, files: 1, fields: 6, fieldSize: 1000, parts: 8 } }).single('archivo');
    return (req, res, next) => {
        if (!subir) return res.status(503).json({ error: 'La carga de archivos no está disponible en este servidor (falta la dependencia "multer").' });
        if (!req.is('multipart/form-data')) return res.status(415).json({ error: 'Envía el archivo como multipart/form-data.' });
        subir(req, res, (err) => {
            if (!err) return next();
            const [estado, mensaje] = ERRORES_MULTER[err.code] ?? [400, 'No se pudo recibir el archivo.'];
            res.status(estado).json({ error: mensaje });
        });
    };
}

export function crearRutasAsistente(limites) {
    const rutas = express.Router();

    // Único punto de entrada del chat
    rutas.post('/ia/chat', requiereAuthApi, limites.chat, async (req, res) => {
        const { error, valor } = validarEntradaChat(req.body);
        if (error) return res.status(400).json({ error });
        res.json(await procesarChat(req.usuario, { ...valor, zona: zonaDe(req) }));
    });

    rutas.post('/ia/archivo', requiereAuthApi, limites.archivos, recibirArchivo(), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo.' });
        const fechaHoy = validarFechaHoy(req.body);
        if (!fechaHoy) return res.status(400).json({ error: SIN_FECHA });
        const resultado = await procesarArchivo(req.usuario, {
            nombre: req.file.originalname, buffer: req.file.buffer, fechaHoy, tzOffset: validarTzOffset(req.body?.tzOffset),
            instruccion: limpiarTextoVisible(req.body?.instruccion, 500), vision: Boolean(modeloVision()), contexto: validarContextoChat({ seccion: req.body?.contextoSeccion, proyecto: req.body?.contextoProyecto, tema: req.body?.contextoTema }),
            zona: zonaDe(req), horaLocal: validarHoraLocal(req.body)
        });
        req.file.buffer = null;          // el contenido no se guarda en ningún sitio
        res.json(resultado);
    });

    // Consejo breve del panel
    rutas.post('/ia/consultar', requiereAuthApi, limites.consejo, async (req, res) => {
        const { error, valor } = validarConsultaIA(req.body);
        if (error) return res.status(400).json({ error });
        const consejo = await consultarIA(valor, { nombreIA: req.usuario.nombreIA, ahora: ahoraDelUsuario({ zona: zonaDe(req) }) });
        if (!consejo) return res.status(503).json({ error: 'El asistente de IA no está disponible ahora mismo.' });
        res.json({ consejo });
    });

    rutas.get('/ia/capacidades', requiereAuthApi, async (req, res) => {
        const archivos = multer ? await capacidadesArchivos({ vision: Boolean(modeloVision()) }) : { formatos: [], imagenes: false, pdf: false, docx: false };
        res.json({ archivos: Boolean(multer), ...archivos, transacciones: db.transaccionesDisponibles(), papeleraDias: db.diasPapelera() });
    });

    // Propuestas: un solo uso, 10 minutos
    rutas.post('/propuestas/:id/aplicar', requiereAuthApi, async (req, res) => {
        if (!esIdPropuesta(req.params.id)) return res.status(404).json({ error: 'Propuesta no encontrada.' });
        const seleccion = Array.isArray(req.body?.seleccion) ? req.body.seleccion.slice(0, db.MAX_OPERACIONES) : null;
        res.json(await aplicarPropuesta(req.usuario.id, req.params.id, { seleccion }));
    });
    rutas.post('/propuestas/:id/cancelar', requiereAuthApi, async (req, res) => {
        if (!esIdPropuesta(req.params.id)) return res.status(404).json({ error: 'Propuesta no encontrada.' });
        const ok = await db.cancelarPropuestaBD(req.usuario.id, req.params.id);
        res.json({ tipo: 'cancelada', mensaje: ok ? 'Propuesta cancelada: no cambié nada.' : 'Esa propuesta ya no estaba pendiente.' });
    });

    // Deshace un cambio completo del asistente
    rutas.post('/operaciones/:loteId/deshacer', requiereAuthApi, async (req, res) => {
        if (!esIdLote(req.params.loteId)) return res.status(404).json({ error: 'No hay nada que deshacer.' });
        res.json(await deshacerLote(req.usuario.id, req.params.loteId));
    });

    return rutas;
}
