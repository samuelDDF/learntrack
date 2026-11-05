// Rutas de la API de la ZONA PRIVADA (Mi panel, Mi agenda, Proyectos, Repaso y Configuración), en un solo lugar.
// Contratos (métodos, campos y respuestas) sin cambios: backend/rutas/*.rutas.js. Sin sesión, el cliente redirige
// al acceso ante un 401.
import { api, apiGet, apiPost, apiPut, apiDelete, id } from '../api/cliente.js';

const IA = { espera: 180000 };          // el servidor espera a Ollama (y lee archivos): margen amplio

// ---------------------------------------------------------------- actividades, papelera, proyectos
export const actividades = {
    listar: ({ archivadas = false } = {}) => apiGet(archivadas ? '/api/actividades?archivadas=incluir' : '/api/actividades'),
    crear: (datos) => apiPost('/api/actividades', datos),
    editar: (actividadId, cambios) => apiPut(`/api/actividades/${id(actividadId)}`, cambios),
    eliminar: (actividadId) => apiDelete(`/api/actividades/${id(actividadId)}`),
    desarchivar: (actividadId) => apiPost(`/api/actividades/${id(actividadId)}/desarchivar`, {})
};
export const papelera = {
    listar: () => apiGet('/api/papelera'),
    restaurar: (actividadId) => apiPost(`/api/papelera/${id(actividadId)}/restaurar`, {})
};
export const proyectos = {
    listar: () => apiGet('/api/proyectos')
};

// ---------------------------------------------------------------- bienestar
export const bienestar = {
    checkin: (fecha) => apiGet(`/api/checkin?fecha=${encodeURIComponent(fecha)}`),
    checkins: (desde, hasta) => apiGet(`/api/checkins?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`),
    guardarCheckin: (datos) => apiPut('/api/checkin', datos),
    historial: () => apiGet('/api/historial'),
    registrarHistorial: (fecha, fechaHoy) => apiPost('/api/historial', { fecha, fechaHoy })
};

// ---------------------------------------------------------------- asistente de IA
export const asistente = {
    chat: (cuerpo) => api('/api/ia/chat', cuerpo, 'POST', IA),
    archivo: (formData) => api('/api/ia/archivo', formData, 'POST', IA),
    consejo: (cuerpo) => api('/api/ia/consultar', cuerpo, 'POST', IA),
    capacidades: () => apiGet('/api/ia/capacidades'),
    aplicarPropuesta: (propuestaId, cuerpo = {}) => apiPost(`/api/propuestas/${id(propuestaId)}/aplicar`, cuerpo),
    cancelarPropuesta: (propuestaId) => apiPost(`/api/propuestas/${id(propuestaId)}/cancelar`, {}),
    deshacer: (loteId) => apiPost(`/api/operaciones/${id(loteId)}/deshacer`, {})
};

// ---------------------------------------------------------------- perfil y configuración
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

// ---------------------------------------------------------------- festivos
export const festivos = {
    listar: (rango) => apiGet(rango ? `/api/festivos?desde=${encodeURIComponent(rango.desde)}&hasta=${encodeURIComponent(rango.hasta)}` : '/api/festivos'),
    paises: () => apiGet('/api/festivos/paises'),
    regiones: (pais, anio) => apiGet(`/api/festivos/regiones?pais=${encodeURIComponent(pais)}&anio=${encodeURIComponent(anio)}`),
    importar: (cuerpo) => apiPost('/api/festivos/importar', cuerpo),
    quitarTodos: () => apiDelete('/api/festivos')
};

// ---------------------------------------------------------------- repaso espaciado (SM-2)
export const repaso = {
    todos: () => apiGet('/api/repaso'),
    pendientes: () => apiGet('/api/repaso/pendientes'),
    activar: (actividadId, proximaFecha) => apiPost(`/api/repaso/${id(actividadId)}/activar`, proximaFecha ? { proximaFecha } : {}),
    calificar: (actividadId, calificacion) => apiPost(`/api/repaso/${id(actividadId)}/calificar`, { calificacion }),
    desactivar: (actividadId) => apiPost(`/api/repaso/${id(actividadId)}/desactivar`, {})
};
