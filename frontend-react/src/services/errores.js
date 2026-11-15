// Manejo centralizado de errores del frontend.
//  · ErrorConexion: no hubo respuesta del servidor (sin red, tiempo agotado o sesión caducada).
//  · mensajeDeError(): el texto que ve la persona, a partir de una respuesta { ok, status, data } o de una excepción.
// Los errores de pintado los recoge components/common/LimiteErrores.jsx; la sesión caducada (401), AuthContext.
export class ErrorConexion extends Error {
    constructor(mensaje, { tiempoAgotado = false } = {}) {
        super(mensaje);
        this.name = 'ErrorConexion';
        this.tiempoAgotado = tiempoAgotado;
    }
}

/** Mensaje de error legible para la persona a partir de una respuesta o una excepción */
export function mensajeDeError(resultadoOError, porDefecto = 'No se pudo completar la acción.') {
    if (resultadoOError instanceof ErrorConexion) return resultadoOError.message;
    if (resultadoOError instanceof Error) return 'No se pudo conectar con el servidor.';
    return resultadoOError?.data?.error || porDefecto;
}
