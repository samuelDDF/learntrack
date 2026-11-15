// Servicio «festivos»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet, apiPost, apiDelete } from '../../../services/http.js';

export const festivos = {
    listar: (rango) => apiGet(rango ? `/api/festivos?desde=${encodeURIComponent(rango.desde)}&hasta=${encodeURIComponent(rango.hasta)}` : '/api/festivos'),
    paises: () => apiGet('/api/festivos/paises'),
    regiones: (pais, anio) => apiGet(`/api/festivos/regiones?pais=${encodeURIComponent(pais)}&anio=${encodeURIComponent(anio)}`),
    importar: (cuerpo) => apiPost('/api/festivos/importar', cuerpo),
    quitarTodos: () => apiDelete('/api/festivos')
};
