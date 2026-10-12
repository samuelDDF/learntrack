import mongoose from 'mongoose';
import { TIPOS, ESTADOS, EXIGENCIAS } from '../../compartido/catalogos.js';

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
    // v3.4: fechas académicas. fecha_vencimiento = fecha límite (entrega); fecha_asignacion = día en que se añadió.
    // El rango fecha_inicio–fecha_fin sigue siendo CUÁNDO trabajas en ella (lo que suma carga).
    fecha_vencimiento: { type: String, default: null },
    fecha_asignacion: { type: String, default: null },
    // Auto-estado: si el usuario cambió el estado a mano, el servidor ya no lo pasa solo a «en proceso»
    estadoFijadoPorUsuario: { type: Boolean, default: false },
    // Limpieza automática (node-cron): completadas cuyo vencimiento ya pasó. null = visible en la agenda.
    archivadaEn: { type: Date, default: null },
    // Borrado lógico: null = activa. Debe estar declarado: Mongoose descarta los campos que no están en el esquema.
    // El índice TTL (PAPELERA_DIAS) se crea/ajusta en prepararBaseDeDatos() (datos/index.js) con collMod, no aquí.
    eliminadaEn: { type: Date, default: null }
}, { versionKey: false, id: false });

actividadSchema.index({ userId: 1, fecha_inicio: 1 });
actividadSchema.index({ userId: 1, proyecto: 1 });
actividadSchema.index({ estado: 1, fecha_vencimiento: 1, fecha_fin: 1 });   // la limpieza diaria (todas las cuentas)

export default mongoose.models.Actividad || mongoose.model('Actividad', actividadSchema, 'actividades');
