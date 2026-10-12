import mongoose from 'mongoose';

// Temas predeterminados (deben coincidir con los [data-theme] de frontend/privado/comun/temas.css).
// "tech-focus" es el «Tema Base». "personalizado" = paleta generada con Colormind (coloresPersonalizados).
export const NOMBRE_IA_PREDETERMINADO = 'Nexo';
export const TEMAS = ['tech-focus', 'moderno', 'oscuro-profundo', 'futurista', 'zen-calm', 'oscuro', 'personalizado'];
// Servicios externos que se pueden vincular desde Configuración
export const SERVICIOS = ['youtube', 'github', 'discord', 'spotify', 'steam', 'xbox'];
export const MAX_FESTIVOS = 600;

// Estado de una cuenta externa. Solo se guardan booleanos y metadatos: NO se guardan tokens de acceso.
// Cuando conectes OAuth de verdad, guarda los tokens CIFRADOS (nunca en claro) y no los devuelvas al navegador.
const cuentaExterna = {
    vinculada: { type: Boolean, default: false },
    vinculadaEn: { type: Date, default: null },
    cuentaExterna: { type: String, default: '', maxlength: 80 }   // nombre visible en el servicio (si se conoce)
};

// Evento importado (hoy: festivos de Nager.Date). Vive en el usuario, SEPARADO de sus actividades: importar
// festivos nunca crea, cambia ni borra una actividad.
const eventoImportado = new mongoose.Schema({
    id: { type: String, required: true, maxlength: 120 },          // determinista: país-región-fecha-nombre (evita duplicados)
    tipo: { type: String, enum: ['festivo'], default: 'festivo' },
    fecha: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    nombre: { type: String, required: true, maxlength: 100 },
    nombreIngles: { type: String, default: '', maxlength: 100 },
    pais: { type: String, required: true, match: /^[A-Z]{2}$/ },
    region: { type: String, default: null, maxlength: 6 },
    fuente: { type: String, default: 'nager.date' },
    importadoEn: { type: Date, default: Date.now }
}, { _id: false });

// Colección "usuarios". `id` es el identificador público (24 hex) que ya usaba la API; no se expone _id.
const usuarioSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, immutable: true },
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    creado: { type: Date, default: Date.now },

    // ---- Apariencia ----
    temaSeleccionado: { type: String, enum: TEMAS, default: 'tech-focus' },
    // 5 colores "#rrggbb" de la paleta generada (Colormind o local); solo se usan con temaSeleccionado = "personalizado"
    coloresPersonalizados: { type: [{ type: String, match: /^#[0-9a-f]{6}$/i }], default: undefined },
    // Ruta de la imagen de fondo subida (la imagen vive en la colección "fondos"); null = sin fondo propio
    imagenFondoUrl: { type: String, default: null, maxlength: 120 },

    // ---- Asistente ----
    // Nombre de la voz del sistema elegida para leer las respuestas (speechSynthesis); '' = la del navegador
    vozAsistente: { type: String, default: '', maxlength: 200 },
    // Nombre del asistente de IA (se inyecta en el Prompt Maestro). "Nexo" es el predeterminado.
    nombreIA: { type: String, default: NOMBRE_IA_PREDETERMINADO, trim: true, maxlength: 30 },

    cuentasVinculadas: Object.fromEntries(SERVICIOS.map((s) => [s, { type: cuentaExterna, default: () => ({}) }])),
    // Interruptor general + preferencias finas. Las preferencias solo tienen efecto si el general está activo.
    notificacionesActivas: { type: Boolean, default: true },
    preferenciasNotificaciones: {
        alertasTareas: { type: Boolean, default: true },
        recordatoriosIA: { type: Boolean, default: true }
    },
    // Fecha de la última foto (null = sin foto). La imagen vive en la colección "avatares" para no cargarla en cada petición.
    avatarActualizado: { type: Date, default: null },

    // ---- Calendario ----
    eventosImportados: { type: [eventoImportado], default: [] }
}, { versionKey: false, id: false });

export default mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema, 'usuarios');
