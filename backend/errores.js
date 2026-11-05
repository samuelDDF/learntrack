// Errores que llevan su código HTTP. El manejador de errores (middleware/errores.js) responde { error: mensaje }
// con ese estado. Cada servicio tiene su subclase para poder distinguirlos en las pruebas.
export class ErrorConEstado extends Error {
    constructor(mensaje, estado = 400) { super(mensaje); this.estado = estado; }
}
