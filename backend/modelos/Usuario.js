import mongoose from 'mongoose';

// Temas de color disponibles (deben coincidir con los [data-theme] de private/temas.css)
export const TEMAS = ['tech-focus', 'zen-calm', 'oscuro'];
// Servicios externos que se pueden vincular desde el perfil
export const SERVICIOS = ['youtube', 'discord', 'spotify'];

// Estado de una cuenta externa. Solo se guardan booleanos y metadatos: NO se guardan tokens de acceso.
// Cuando conectes OAuth de verdad, guarda los tokens CIFRADOS (nunca en claro) y no los devuelvas al navegador.
const cuentaExterna = {
    vinculada: { type: Boolean, default: false },
    vinculadaEn: { type: Date, default: null },
    cuentaExterna: { type: String, default: '', maxlength: 80 }   // nombre visible en el servicio (si se conoce)
};

// Colección "usuarios". `id` es el identificador público (24 hex) que ya usaba la API; no se expone _id.
const usuarioSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, immutable: true },
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    creado: { type: Date, default: Date.now },

    // ---- Perfil (v3.1) ----
    temaEstetico: { type: String, enum: TEMAS, default: 'tech-focus' },
    cuentasVinculadas: {
        youtube: { type: cuentaExterna, default: () => ({}) },
        discord: { type: cuentaExterna, default: () => ({}) },
        spotify: { type: cuentaExterna, default: () => ({}) }
    },
    // Interruptor general + preferencias finas. Las preferencias solo tienen efecto si el general está activo.
    notificacionesActivas: { type: Boolean, default: true },
    preferenciasNotificaciones: {
        alertasTareas: { type: Boolean, default: true },
        recordatoriosIA: { type: Boolean, default: true }
    },
    // Fecha de la última foto (null = sin foto). La imagen vive en la colección "avatares" para no cargarla en cada petición.
    avatarActualizado: { type: Date, default: null }
}, { versionKey: false, id: false });

export default mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema, 'usuarios');
