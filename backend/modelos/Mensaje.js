import mongoose from 'mongoose';

// Colección "mensajes": formulario de contacto de la página pública.
const mensajeSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    nombre: { type: String, required: true, maxlength: 80 },
    email: { type: String, required: true, maxlength: 254 },
    mensaje: { type: String, required: true, maxlength: 1000 },
    fecha: { type: Date, default: Date.now }
}, { versionKey: false, id: false });

export default mongoose.models.Mensaje || mongoose.model('Mensaje', mensajeSchema, 'mensajes');
