// Servicio «bienestar»: llamadas HTTP a la API REST de Express (contratos en backend/rutas/*.rutas.js).
import { apiGet, apiPost, apiPut } from '../../../services/http.js';

export const bienestar = {
    checkin: (fecha) => apiGet(`/api/checkin?fecha=${encodeURIComponent(fecha)}`),
    checkins: (desde, hasta) => apiGet(`/api/checkins?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`),
    guardarCheckin: (datos) => apiPut('/api/checkin', datos),
    historial: () => apiGet('/api/historial'),
    registrarHistorial: (fecha, fechaHoy) => apiPost('/api/historial', { fecha, fechaHoy })
};
