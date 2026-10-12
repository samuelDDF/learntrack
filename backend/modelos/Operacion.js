import mongoose from 'mongoose';

// Colección "operaciones": diario de cambios para "Deshacer". Cada cambio aplicado guarda una fila con la foto
// anterior de la actividad; todas las filas de una misma acción comparten `loteId`, así que deshacer revierte
// la operación completa (p. ej. las 6 actividades que movió "libera mi viernes").
export const DIAS_DIARIO = 7;

const operacionSchema = new mongoose.Schema({
    loteId: { type: String, required: true },
    userId: { type: String, required: true },
    origen: { type: String, enum: ['ia', 'manual'], default: 'ia' },
    orden: { type: Number, default: 0 },
    tipo: { type: String, required: true, enum: ['crear', 'editar', 'eliminar', 'restaurar'] },
    actividadId: { type: String, required: true },
    antes: { type: mongoose.Schema.Types.Mixed, default: null },
    revertida: { type: Boolean, default: false },
    creada: { type: Date, default: Date.now }
}, { versionKey: false, id: false, minimize: false });

operacionSchema.index({ userId: 1, loteId: 1 });
operacionSchema.index({ userId: 1, creada: -1 });
operacionSchema.index({ creada: 1 }, { expireAfterSeconds: DIAS_DIARIO * 86400 });

export default mongoose.models.Operacion || mongoose.model('Operacion', operacionSchema, 'operaciones');
