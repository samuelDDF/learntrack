import mongoose from 'mongoose';

// Colección "auditoria_admin" (v3.13): acciones del administrador. Guarda QUÉ se hizo, CUÁNDO y sobre QUÉ cuenta
// (su id interno), nunca contraseñas, tokens, códigos ni el correo de una cuenta eliminada. Se borra sola a los
// 2 años (plazo indicado en la política de tratamiento de datos).
export const ACCIONES_AUDITORIA = ['admin_creado', 'admin_contrasena_restablecida', 'inicio_sesion_admin', 'suspender', 'reactivar', 'eliminar', 'cerrar_sesiones'];
export const DIAS_AUDITORIA = 730;

const auditoriaSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    accion: { type: String, enum: ACCIONES_AUDITORIA, required: true },
    adminId: { type: String, required: true },
    cuentaId: { type: String, default: null },
    detalle: {
        motivo: { type: String, maxlength: 300 },
        hasta: { type: Date },
        origen: { type: String, enum: ['panel', 'script'], default: 'panel' }
    },
    fecha: { type: Date, default: Date.now }
}, { versionKey: false, id: false });

auditoriaSchema.index({ fecha: 1 }, { name: 'auditoria_ttl', expireAfterSeconds: DIAS_AUDITORIA * 24 * 3600 });
auditoriaSchema.index({ cuentaId: 1, fecha: -1 });

export default mongoose.models.Auditoria || mongoose.model('Auditoria', auditoriaSchema, 'auditoria_admin');
