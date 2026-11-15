// Servicio «asistente»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { api, apiGet, apiPost, id } from '../../../services/http.js';

const IA = { espera: 180000 };          // el servidor espera a Ollama (y lee archivos): margen amplio

export const asistente = {
    chat: (cuerpo) => api('/api/ia/chat', cuerpo, 'POST', IA),
    archivo: (formData) => api('/api/ia/archivo', formData, 'POST', IA),
    consejo: (cuerpo) => api('/api/ia/consultar', cuerpo, 'POST', IA),
    capacidades: () => apiGet('/api/ia/capacidades'),
    aplicarPropuesta: (propuestaId, cuerpo = {}) => apiPost(`/api/propuestas/${id(propuestaId)}/aplicar`, cuerpo),
    cancelarPropuesta: (propuestaId) => apiPost(`/api/propuestas/${id(propuestaId)}/cancelar`, {}),
    deshacer: (loteId) => apiPost(`/api/operaciones/${id(loteId)}/deshacer`, {})
};
