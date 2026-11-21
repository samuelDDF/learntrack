import mongoose from 'mongoose';

// Temas predeterminados (deben coincidir con los [data-theme] de frontend-react/src/estilos/temas.css).
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

// Verificación del correo con código de 6 dígitos (v3.10). Solo existe mientras hay una verificación en curso y se
// elimina entera al verificar. Nada de esto sale nunca del servidor (ver datos/usuarios.js: SIN_SECRETOS).
const verificacionEmail = new mongoose.Schema({
    codigoHash: { type: String, default: null },        // scrypt$sal$hash del código (null = sin código activo)
    expira: { type: Date, default: null },               // caducidad del código
    intentos: { type: Number, default: 0 },              // intentos fallidos con el código actual
    ultimoEnvio: { type: Date, default: null },          // para la espera entre reenvíos
    enviosDesde: { type: Date, default: null },          // ventana de una hora para el máximo de envíos
    envios: { type: Number, default: 0 },
    tokenHash: { type: String, default: null },          // SHA-256 del token de la cookie lt_verif (liga el código al navegador)
    tokenExpira: { type: Date, default: null }
}, { _id: false });

// Aceptación de un documento legal (v3.13): qué versión, cuándo, por qué vía y la huella SHA-256 del texto exacto
// que se mostró (compartido/legal). Es la evidencia mínima y suficiente: sin IP ni rastreo.
const aceptacionLegal = new mongoose.Schema({
    documento: { type: String, enum: ['terminos', 'privacidad'], required: true },
    version: { type: String, required: true, maxlength: 20 },
    huella: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    aceptadoEn: { type: Date, required: true },
    // registro: al crear la cuenta · actualizacion: nueva versión aceptada · representante: lo aceptó el representante legal
    via: { type: String, enum: ['registro', 'actualizacion', 'representante'], required: true }
}, { _id: false });

// Representante legal de una persona de 14 a 17 años (v3.13). El menor lo indica al registrarse (y con ello expresa
// su opinión); la AUTORIZACIÓN la da el representante desde el enlace que recibe por correo (Decreto 1074 de 2015,
// art. 2.2.2.25.2.9). Hasta entonces la cuenta no puede usarse. Del enlace solo se guarda el SHA-256 del token.
const representanteLegal = new mongoose.Schema({
    nombre: { type: String, required: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, maxlength: 254 },
    parentesco: { type: String, enum: ['madre', 'padre', 'tutor'], required: true },
    declaradoEn: { type: Date, required: true },
    estado: { type: String, enum: ['pendiente', 'autorizado'], default: 'pendiente' },
    autorizadoEn: { type: Date, default: null },
    tokenHash: { type: String, default: null },
    tokenExpira: { type: Date, default: null },
    ultimoEnvio: { type: Date, default: null },
    envios: { type: Number, default: 0 }
}, { _id: false });

// Suspensión decidida por el administrador (v3.13). `hasta` null = hasta que se reactive a mano.
const suspension = new mongoose.Schema({
    motivo: { type: String, required: true, maxlength: 300 },
    desde: { type: Date, required: true },
    hasta: { type: Date, default: null }
}, { _id: false });

// Colección "usuarios". `id` es el identificador público (24 hex) que ya usaba la API; no se expone _id.
const usuarioSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, immutable: true },
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    creado: { type: Date, default: Date.now },

    // ---- Administración (v3.13) ----
    // INMUTABLE: solo se fija al crear el documento. Ninguna ruta de la API lo escribe; el único administrador lo
    // crea scripts/admin.js y el índice único parcial de abajo impide que exista un segundo.
    rol: { type: String, enum: ['usuario', 'admin'], default: 'usuario', immutable: true },
    estado: { type: String, enum: ['activa', 'suspendida'], default: 'activa' },
    suspension: { type: suspension, default: undefined },
    ultimoAcceso: { type: Date, default: null },

    // ---- Documentos legales y edad (v3.13) ----
    aceptacionesLegales: { type: [aceptacionLegal], default: undefined },
    fechaNacimiento: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    representanteLegal: { type: representanteLegal, default: undefined },

    // ---- Verificación del correo (v3.10) ----
    // true = verificado con el código · false = registro pendiente (sin acceso) · AUSENTE = cuenta anterior a la v3.10
    // (sin default a propósito: así se distinguen las cuentas antiguas; ver servicios/cuenta/verificacion-correo.js)
    emailVerificado: { type: Boolean },
    emailVerificadoEn: { type: Date },
    verificacionEmail: { type: verificacionEmail, default: undefined },
    // Solo en registros pendientes: pasada esta fecha MongoDB los borra (índice TTL parcial de abajo)
    pendienteHasta: { type: Date },

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

// Registros abandonados (nunca verificados): se borran solos. El filtro parcial impide que el TTL toque una cuenta
// verificada o antigua aunque tuviera el campo por error.
usuarioSchema.index({ pendienteHasta: 1 }, { name: 'registro_pendiente_ttl', expireAfterSeconds: 0, partialFilterExpression: { emailVerificado: false } });
usuarioSchema.index({ 'verificacionEmail.tokenHash': 1 }, { name: 'verificacion_token', sparse: true });
// v3.13: UN SOLO administrador. MongoDB rechaza un segundo documento con rol «admin» venga de donde venga
// (script, código o una inserción manual en la base de datos).
usuarioSchema.index({ rol: 1 }, { name: 'administrador_unico', unique: true, partialFilterExpression: { rol: 'admin' } });
usuarioSchema.index({ estado: 1, creado: -1 }, { name: 'admin_listado' });

export default mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema, 'usuarios');
