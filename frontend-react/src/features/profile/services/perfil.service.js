// Servicio «perfil»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet, apiPost, apiPut, apiDelete, id } from '../../../services/http.js';

export const perfil = {
    obtener: () => apiGet('/api/perfil'),
    guardar: (cambios) => apiPut('/api/perfil', cambios),
    eliminarCuenta: (password, confirmacion) => apiDelete('/api/perfil', { password, confirmacion }),
    paleta: (color) => apiPost('/api/perfil/paleta', { color }),
    subirAvatar: (blobJpeg) => apiPut('/api/perfil/avatar', blobJpeg),
    quitarAvatar: () => apiDelete('/api/perfil/avatar'),
    subirFondo: (formData) => apiPost('/api/perfil/fondo', formData),
    quitarFondo: () => apiDelete('/api/perfil/fondo'),
    vincular: (servicio) => apiPost('/api/perfil/vincular', { servicio }),
    desvincular: (servicio) => apiDelete(`/api/perfil/vincular/${id(servicio)}`)
};
