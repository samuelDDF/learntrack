import mongoose from 'mongoose';

const TIPOS = ['estudio', 'trabajo', 'ocio', 'deporte'];
const ESTADOS = ['pendiente', 'en_proceso', 'completado'];
const EXIGENCIAS = [3, 2, 1, -2];

// Colección "actividades". Los campos coinciden con lo que ya devolvía la API.
// Fechas como "YYYY-MM-DD" (cadena) y horas como "HH:MM": así se comparan y ordenan igual que antes.
const actividadSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, immutable: true },
    userId: { type: String, required: true, immutable: true },
    titulo: { type: String, required: true, trim: true, maxlength: 100 },
    tipo: { type: String, required: true, enum: TIPOS },
    exigencia: {
        type: Number, required: true,
        validate: { validator: (v) => EXIGENCIAS.includes(v), message: 'Exigencia no válida.' }
    },
    horas: { type: Number, required: true, min: 0.5, max: 12 },
    fecha: { type: String },                      // alias retrocompatible de fecha_inicio
    fecha_inicio: { type: String },
    fecha_fin: { type: String },
    hora_inicio: { type: String, default: null },
    hora_fin: { type: String, default: null },
    estado: { type: String, enum: ESTADOS, default: 'pendiente' },
    proyecto: { type: String, default: '', maxlength: 60 },
    // Nuevos (v3). Opcionales: los documentos antiguos sin ellos siguen siendo válidos.
    fija: { type: Boolean, default: false },      // el planificador no la mueve (además de la regla esHito)
    // Borrado lógico: null = activa. Debe estar declarado: Mongoose descarta los campos que no están en el esquema.
    // El índice TTL (PAPELERA_DIAS) se crea/ajusta en prepararIndices() con collMod, no aquí.
    eliminadaEn: { type: Date, default: null }
}, { versionKey: false, id: false });

actividadSchema.index({ userId: 1, fecha_inicio: 1 });
actividadSchema.index({ userId: 1, proyecto: 1 });

export default mongoose.models.Actividad || mongoose.model('Actividad', actividadSchema, 'actividades');
