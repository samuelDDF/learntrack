import mongoose from 'mongoose';

// Colección "avatares": una foto por usuario. El cliente la reduce a 256×256 antes de subirla y el servidor
// vuelve a comprobar tipo (firma real del archivo) y tamaño. Se sirve solo al propio usuario autenticado.
export const MAX_AVATAR_BYTES = 200 * 1024;

const avatarSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    tipo: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    datos: { type: Buffer, required: true },
    actualizado: { type: Date, default: Date.now }
}, { versionKey: false, id: false });

export default mongoose.models.Avatar || mongoose.model('Avatar', avatarSchema, 'avatares');
