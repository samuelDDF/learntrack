// Servicio «actividades»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet, apiPost, apiPut, apiDelete, id } from '../../../services/http.js';

export const actividades = {
    listar: ({ archivadas = false } = {}) => apiGet(archivadas ? '/api/actividades?archivadas=incluir' : '/api/actividades'),
    crear: (datos) => apiPost('/api/actividades', datos),
    editar: (actividadId, cambios) => apiPut(`/api/actividades/${id(actividadId)}`, cambios),
    eliminar: (actividadId) => apiDelete(`/api/actividades/${id(actividadId)}`),
    desarchivar: (actividadId) => apiPost(`/api/actividades/${id(actividadId)}/desarchivar`, {})
};
