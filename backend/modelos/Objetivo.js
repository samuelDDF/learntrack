import mongoose from 'mongoose';
import { CATEGORIAS_OBJETIVO, NIVELES, PRIORIDADES_OBJETIVO, ESTADOS_OBJETIVO, ORIGENES_OBJETIVO } from '../../compartido/estudio.js';

// Colección "objetivos_estudio" (v3.12, módulo Estudio): temas, habilidades y competencias que la persona quiere
// aprender. Las SESIONES no se guardan aquí: son actividades del calendario con `objetivoId` (ver Actividad.js).
// Fechas como "YYYY-MM-DD" (cadena), igual que el resto de LearnTrack.
const objetivoSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, immutable: true },
    userId: { type: String, required: true, immutable: true },
    tema: { type: String, required: true, trim: true, maxlength: 100 },
    claveTema: { type: String, required: true, maxlength: 100 },          // para no duplicar el mismo tema
    categoria: { type: String, enum: CATEGORIAS_OBJETIVO, default: 'tema' },
    descripcion: { type: String, default: '', maxlength: 500 },
    nivelActual: { type: String, enum: NIVELES, default: '' },
    nivelObjetivo: { type: String, enum: NIVELES, default: '' },
    fechaLimite: { type: String, default: null },
    prioridad: { type: Number, enum: PRIORIDADES_OBJETIVO, default: 2 },
    horasEstimadas: { type: Number, min: 0.5, max: 200, default: 4 },
    progresoManual: { type: Number, min: 0, max: 100, default: null },   // null = se calcula con las sesiones
    estado: { type: String, enum: ESTADOS_OBJETIVO, default: 'pendiente' },
    posponerHasta: { type: String, default: null },                      // sugerencias pospuestas
    origen: { type: String, enum: ORIGENES_OBJETIVO, default: 'manual' },
    motivo: { type: String, default: '', maxlength: 300 },              // por qué lo recomendó la IA
    proyecto: { type: String, default: '', maxlength: 60 },
    actividadRelacionada: { type: String, default: null },               // p. ej. la entrega que exige este tema
    menciones: { type: Number, default: 1, min: 1 },                     // veces que surgió (dificultad repetida)
    creadoEn: { type: Date, default: Date.now },
    actualizadoEn: { type: Date, default: Date.now }
}, { versionKey: false, id: false });

objetivoSchema.index({ userId: 1, claveTema: 1 }, { unique: true });
objetivoSchema.index({ userId: 1, estado: 1, fechaLimite: 1 });

export default mongoose.models.Objetivo || mongoose.model('Objetivo', objetivoSchema, 'objetivos_estudio');
