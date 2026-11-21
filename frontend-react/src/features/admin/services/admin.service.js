// Servicio del panel de administración (v3.13). El servidor comprueba en CADA petición que la sesión es la del
// administrador; a cualquier otra cuenta le responde 404. Las peticiones que cambian algo van en JSON (el navegador
// añade la cabecera Origin, que el servidor exige).
import { apiGet, apiPost, apiDelete, id } from '../../../services/http.js';

const consulta = (p) => new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v != null)).toString();

export const admin = {
    resumen: () => apiGet('/api/admin/resumen'),
    cuentas: ({ q = '', estado = '', pagina = 1 } = {}) => apiGet(`/api/admin/cuentas?${consulta({ q, estado, pagina })}`),
    cuenta: (idCuenta) => apiGet(`/api/admin/cuentas/${id(idCuenta)}`),
    suspender: (idCuenta, { motivo, hasta }) => apiPost(`/api/admin/cuentas/${id(idCuenta)}/suspender`, { motivo, hasta: hasta || null }),
    reactivar: (idCuenta) => apiPost(`/api/admin/cuentas/${id(idCuenta)}/reactivar`, {}),
    cerrarSesiones: (idCuenta) => apiPost(`/api/admin/cuentas/${id(idCuenta)}/cerrar-sesiones`, {}),
    eliminar: (idCuenta, { confirmacion, motivo }) => apiDelete(`/api/admin/cuentas/${id(idCuenta)}`, { confirmacion, motivo }),
    auditoria: (pagina = 1) => apiGet(`/api/admin/auditoria?${consulta({ pagina })}`)
};
