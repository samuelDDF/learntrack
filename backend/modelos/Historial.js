import mongoose from 'mongoose';

// Colección "historial": documentos planos { userId, fecha, porcentaje } (una fila por usuario y día).
// Antes era un objeto anidado { [userId]: { 'YYYY-MM-DD': porcentaje } }.
const historialSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    fecha: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    porcentaje: { type: Number, required: true, min: 0, max: 1000 }
}, { versionKey: false, id: false });

// Un solo registro por usuario y fecha (permite el upsert de guardarHistorialBD)
historialSchema.index({ userId: 1, fecha: 1 }, { unique: true });

export default mongoose.models.Historial || mongoose.model('Historial', historialSchema, 'historial');
