import mongoose from 'mongoose';

// Colección "sesiones". Solo se guarda el SHA-256 del token; la cookie lleva el token en claro.
const sesionSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    expira: { type: Date, required: true }
}, { versionKey: false, id: false });

// TTL: MongoDB elimina por sí solo las sesiones caducadas (el monitor corre cada ~60 s;
// buscarSesionBD también comprueba `expira`, así que una sesión vencida nunca es válida).
sesionSchema.index({ expira: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Sesion || mongoose.model('Sesion', sesionSchema, 'sesiones');
