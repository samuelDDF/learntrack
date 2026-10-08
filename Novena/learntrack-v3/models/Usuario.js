import mongoose from 'mongoose';

// Colección "usuarios". `id` es el identificador público (24 hex) que ya usaba la API; no se expone _id.
const usuarioSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, immutable: true },
    nombre: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    creado: { type: Date, default: Date.now }
}, { versionKey: false, id: false });

export default mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema, 'usuarios');
