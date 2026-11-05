import mongoose from 'mongoose';

// Colección "propuestas": cambios calculados por el servidor que el usuario debe confirmar (Aplicar / Cancelar),
// y también las aclaraciones pendientes del chat (tipo "aclaracion"). Un solo uso y caducidad de 10 minutos.
// El índice TTL las borra solas, pero el monitor TTL corre cada ~60 s: el código comprueba también `expira`.
export const MINUTOS_PROPUESTA = 10;

const propuestaSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, immutable: true },   // 32 hex aleatorios
    userId: { type: String, required: true, immutable: true },
    tipo: {
        type: String, required: true,
        enum: ['crear', 'editar', 'mover', 'liberar_dia', 'reorganizar', 'planificar_proyecto', 'eliminar', 'restaurar', 'importar', 'aclaracion']
    },
    // { crear: [{ datos, motivo, marcado, cita }], editar: [{ id, cambios, motivo }], mover: [...], eliminar: [{ id, motivo }], restaurar: [...] }
    operaciones: { type: mongoose.Schema.Types.Mixed, default: {} },
    presentacion: { type: mongoose.Schema.Types.Mixed, default: {} },      // lo que se muestra en la tarjeta
    estado: { type: mongoose.Schema.Types.Mixed, default: null },          // aclaraciones: intención y datos parciales
    seleccionable: { type: Boolean, default: false },                      // importar: el usuario marca qué añadir
    usada: { type: Boolean, default: false },
    creada: { type: Date, default: Date.now },
    expira: { type: Date, required: true }
}, { versionKey: false, id: false, minimize: false });

propuestaSchema.index({ expira: 1 }, { expireAfterSeconds: 0 });
propuestaSchema.index({ userId: 1, creada: -1 });

export default mongoose.models.Propuesta || mongoose.model('Propuesta', propuestaSchema, 'propuestas');
