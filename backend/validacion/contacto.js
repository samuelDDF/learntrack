// Formulario de contacto de la página de inicio.
import { limpiarTextoVisible, normalizarEmail, esEmail } from './texto.js';

export function validarContacto(body) {
    const nombre = limpiarTextoVisible(body?.nombre, 80);
    const email = normalizarEmail(body?.correo);
    const mensaje = limpiarTextoVisible(body?.mensaje, 1000);
    if (nombre.length < 2 || !esEmail(email) || mensaje.length < 5) {
        return { error: 'Completa nombre, un correo válido y un mensaje de al menos 5 caracteres.' };
    }
    return { valor: { nombre, email, mensaje } };
}
