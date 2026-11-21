// Servicio «estudio» (v3.12): llamadas HTTP a /api/estudio (contratos en backend/rutas/estudio.rutas.js).
// Nada de esto decide fechas ni horas: el servidor planifica y vuelve a comprobar todo al guardar.
import { api, apiGet, apiPost, apiPut, apiDelete, id } from '../../../services/http.js';

const IA = { espera: 180000 };          // el análisis de documentos espera a Ollama

export const estudio = {
    listar: () => apiGet('/api/estudio'),
    crear: (datos) => apiPost('/api/estudio', datos),
    editar: (objetivoId, cambios) => apiPut(`/api/estudio/${id(objetivoId)}`, cambios),
    eliminar: (objetivoId) => apiDelete(`/api/estudio/${id(objetivoId)}`),
    /** accion: 'aceptar' | 'posponer' | 'descartar'; con planificar: true devuelve también un plan para revisar */
    responderSugerencia: (objetivoId, cuerpo) => apiPost(`/api/estudio/${id(objetivoId)}/sugerencia`, cuerpo),
    /** Propone sesiones (no guarda nada) */
    plan: (ids, opciones = {}) => apiPost('/api/estudio/plan', { ids, ...opciones }),
    /** Guarda SOLO las sesiones que la persona confirmó (todo o nada; 409 con conflictos si algo ya no cabe) */
    guardarSesiones: (sesiones) => apiPost('/api/estudio/sesiones', { sesiones }),
    /** Analiza un taller o trabajo y devuelve lo identificado para revisarlo (no guarda nada) */
    analizar: (formData) => api('/api/estudio/analizar', formData, 'POST', IA),
    /** Guarda los temas (y la entrega) que la persona confirmó tras el análisis */
    guardarLote: (cuerpo) => apiPost('/api/estudio/lote', cuerpo)
};
