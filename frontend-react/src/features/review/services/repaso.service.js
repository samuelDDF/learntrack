// Servicio «repaso»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet, apiPost, id } from '../../../services/http.js';

export const repaso = {
    todos: () => apiGet('/api/repaso'),
    pendientes: () => apiGet('/api/repaso/pendientes'),
    activar: (actividadId, proximaFecha) => apiPost(`/api/repaso/${id(actividadId)}/activar`, proximaFecha ? { proximaFecha } : {}),
    calificar: (actividadId, calificacion) => apiPost(`/api/repaso/${id(actividadId)}/calificar`, { calificacion }),
    desactivar: (actividadId) => apiPost(`/api/repaso/${id(actividadId)}/desactivar`, {})
};
