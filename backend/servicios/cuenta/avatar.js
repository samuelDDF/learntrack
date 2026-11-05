// Foto de perfil: el tipo se decide por los primeros bytes del archivo (firma), nunca por lo que diga el cliente.
export { MAX_AVATAR_BYTES } from '../../modelos/Avatar.js';

/** 'image/jpeg' | 'image/png' | 'image/webp' | null. SVG, GIF, HTML… se rechazan (el SVG puede llevar scripts). */
export function detectarImagen(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}
