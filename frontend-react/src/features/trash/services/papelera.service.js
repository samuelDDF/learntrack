// Servicio «papelera»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet, apiPost, apiDelete, id } from '../../../services/http.js';

export const papelera = {
    listar: () => apiGet('/api/papelera'),
    restaurar: (actividadId) => apiPost(`/api/papelera/${id(actividadId)}/restaurar`, {}),
    // v3.9: selección múltiple y vaciado (el servidor solo actúa sobre TU papelera)
    restaurarVarias: (ids) => apiPost('/api/papelera/restaurar', { ids }),
    eliminarDefinitivamente: (ids) => apiDelete('/api/papelera/seleccion', { ids }),
    vaciar: () => apiDelete('/api/papelera')
};
