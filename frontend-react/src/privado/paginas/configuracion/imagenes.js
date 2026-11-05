// Reduce una imagen EN EL NAVEGADOR antes de subirla y la devuelve como JPEG (menos datos, sin metadatos EXIF).
//  · cuadrado: recorta al centro (foto de perfil 256×256).  · si no: conserva la proporción con `lado` de ancho máximo.
export async function reducirImagen(archivo, { lado, cuadrado = false, calidad = 0.86 }) {
    const bitmap = await createImageBitmap(archivo);
    const lienzo = document.createElement('canvas');
    let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
    if (cuadrado) {
        const corte = Math.min(sw, sh);
        sx = (sw - corte) / 2; sy = (sh - corte) / 2; sw = sh = corte;
        lienzo.width = lienzo.height = lado;
    } else {
        const escala = Math.min(1, lado / sw);
        lienzo.width = Math.round(sw * escala); lienzo.height = Math.round(sh * escala);
    }
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';                       // PNG con transparencia → fondo blanco (JPEG no tiene alfa)
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);
    bitmap.close?.();
    return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('canvas'))), 'image/jpeg', calidad));
}
export const esImagenAceptada = (archivo) => /^image\/(png|jpeg|webp)$/.test(archivo?.type ?? '');
