import mongoose from 'mongoose';
import { ANIMOS, SUENOS, ENFOQUES } from '../../compartido/catalogos.js';

// Colección "checkins": el check-in diario (antes solo vivía en localStorage y lo compartían todos los
// usuarios del mismo navegador). Un documento por usuario y día local.
const checkinSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    fecha: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    animo: { type: String, required: true, enum: ANIMOS },
    sueno: { type: String, required: true, enum: SUENOS },
    enfoque: { type: String, required: true, enum: ENFOQUES },
    actualizado: { type: Date, default: Date.now }
}, { versionKey: false, id: false });

checkinSchema.index({ userId: 1, fecha: 1 }, { unique: true });

export default mongoose.models.Checkin || mongoose.model('Checkin', checkinSchema, 'checkins');
