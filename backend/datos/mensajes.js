// Colección "mensajes": formulario de contacto de la página de inicio.
import Mensaje from '../modelos/Mensaje.js';

export async function guardarMensajeBD(mensaje) {
    await Mensaje.create(mensaje);
}
