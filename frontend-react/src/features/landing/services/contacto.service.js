// Servicio «contacto»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiPost } from '../../../services/http.js';

const PUBLICO = { redirigir401: false };

export const contacto = {
    enviar: (datos) => apiPost('/api/contacto', datos, PUBLICO)
};
