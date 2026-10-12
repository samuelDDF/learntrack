import mongoose from 'mongoose';

// Colección "fondos": la imagen de fondo personalizada de cada usuario (una por usuario). El navegador la reduce a
// 1920 px de ancho antes de subirla; el servidor comprueba la firma real del archivo y el tamaño. Solo la ve su dueño.
export const MAX_FONDO_BYTES = 1.5 * 1024 * 1024;

const fondoSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    tipo: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    datos: { type: Buffer, required: true },
    actualizado: { type: Date, default: Date.now }
}, { versionKey: false, id: false });

export default mongoose.models.Fondo || mongoose.model('Fondo', fondoSchema, 'fondos');
