// Servicio «auth»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet, apiPost } from '../../../services/http.js';

const PUBLICO = { redirigir401: false };

export const auth = {
    yo: () => apiGet('/api/auth/me', PUBLICO),
    login: (email, password) => apiPost('/api/auth/login', { email, password }, PUBLICO),
    registro: (nombre, email, password, datos = {}) => apiPost('/api/auth/registro', { nombre, email, password, ...datos }, PUBLICO),
    // v3.13: documentos legales y autorización del representante de un menor
    aceptarDocumentos: (versiones) => apiPost('/api/auth/aceptar-documentos', { acepto: true, versiones }),
    reenviarRepresentante: () => apiPost('/api/auth/representante/reenviar', {}),
    consultarRepresentante: (token) => apiPost('/api/auth/representante/consultar', { token }, PUBLICO),
    decidirRepresentante: (cuerpo) => apiPost('/api/auth/representante/decidir', cuerpo, PUBLICO),
    logout: () => apiPost('/api/auth/logout', {}, PUBLICO),
    // v3.10: verificación del correo con código de 6 dígitos (la cookie temporal la gestiona el servidor)
    verificarCorreo: (codigo) => apiPost('/api/auth/verificar-correo', { codigo }, PUBLICO),
    reenviarCodigo: () => apiPost('/api/auth/reenviar-codigo', {}, PUBLICO),
    estadoVerificacion: () => apiGet('/api/auth/verificacion', PUBLICO)
};
