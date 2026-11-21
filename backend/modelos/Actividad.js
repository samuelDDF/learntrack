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
    eliminadaEn: { type: Date, default: null },
    // v3.12: sesión de estudio de un objetivo del módulo Estudio (null = actividad normal)
    objetivoId: { type: String, default: null },
    // v3.5: Repaso espaciado (SM-2). Los campos son null para actividades que no participan en el sistema de repaso.
    repaso: {
        type: {
            facilidad: { type: Number, default: 2.5, min: 1.3 },     // Factor de Facilidad (EF), inicia en 2.5
            intervalo: { type: Number, default: 0, min: 0 },          // Intervalo actual en días
            repeticiones: { type: Number, default: 0, min: 0 },       // Conteo de repeticiones acumuladas
            proximaFecha: { type: String, default: null },             // "YYYY-MM-DD" — próxima fecha de repaso
            ultimoRepaso: { type: String, default: null },             // "YYYY-MM-DD" — fecha del último repaso
            ultimaCalificacion: { type: Number, default: null, min: 0, max: 5 } // última calificación (0–5)
        },
        default: null,            // null = la actividad no participa en repaso espaciado
        _id: false
    }
}, { versionKey: false, id: false });

actividadSchema.index({ userId: 1, fecha_inicio: 1 });
actividadSchema.index({ userId: 1, proyecto: 1 });
actividadSchema.index({ estado: 1, fecha_vencimiento: 1, fecha_fin: 1 });   // la limpieza diaria (todas las cuentas)
actividadSchema.index({ userId: 1, 'repaso.proximaFecha': 1 });             // repasos pendientes del usuario
actividadSchema.index({ userId: 1, objetivoId: 1 });                         // sesiones de cada objetivo de estudio

export default mongoose.models.Actividad || mongoose.model('Actividad', actividadSchema, 'actividades');
