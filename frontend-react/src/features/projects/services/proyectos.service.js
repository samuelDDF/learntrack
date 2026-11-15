// Servicio «proyectos»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet } from '../../../services/http.js';

export const proyectos = {
    listar: () => apiGet('/api/proyectos')
};
