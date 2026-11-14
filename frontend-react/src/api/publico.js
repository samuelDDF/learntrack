// Rutas de la API que usa la ZONA PÚBLICA (inicio, acceso, contacto). Las de la zona privada viven en
// src/privado/api.js y solo se descargan con sesión. Contratos sin cambios: backend/rutas/auth.rutas.js y contacto.rutas.js.
import { apiGet, apiPost } from './cliente.js';

const PUBLICO = { redirigir401: false };

// ---------------------------------------------------------------- acceso y sesión (zona pública)
export const auth = {
    yo: () => apiGet('/api/auth/me', PUBLICO),
    login: (email, password) => apiPost('/api/auth/login', { email, password }, PUBLICO),
    registro: (nombre, email, password) => apiPost('/api/auth/registro', { nombre, email, password }, PUBLICO),
    logout: () => apiPost('/api/auth/logout', {}, PUBLICO),
    // v3.10: verificación del correo con código de 6 dígitos (la cookie temporal la gestiona el servidor)
    verificarCorreo: (codigo) => apiPost('/api/auth/verificar-correo', { codigo }, PUBLICO),
    reenviarCodigo: () => apiPost('/api/auth/reenviar-codigo', {}, PUBLICO),
    estadoVerificacion: () => apiGet('/api/auth/verificacion', PUBLICO)
};
export const contacto = {
    enviar: (datos) => apiPost('/api/contacto', datos, PUBLICO)
};
