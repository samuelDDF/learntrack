// Formato de fechas y estados del panel de administración
const FECHA = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
const FECHA_HORA = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export const fecha = (v) => (v ? FECHA.format(new Date(v)) : '—');
export const fechaHora = (v) => (v ? FECHA_HORA.format(new Date(v)) : '—');

/** Estado de una cuenta para mostrarlo: { texto, clase } */
export function estadoCuenta(c) {
    if (c.estado === 'suspendida') return { texto: 'Suspendida', clase: 'adm-estado-suspendida' };
    if (!c.correoVerificado) return { texto: 'Sin verificar', clase: 'adm-estado-pendiente' };
    if (c.representante?.estado === 'pendiente') return { texto: 'Menor: falta autorización', clase: 'adm-estado-pendiente' };
    return { texto: 'Activa', clase: 'adm-estado-activa' };
}

export const ACCIONES_AUDITORIA = {
    admin_creado: 'Administrador creado',
    admin_contrasena_restablecida: 'Contraseña del administrador restablecida',
    inicio_sesion_admin: 'Inicio de sesión del administrador',
    suspender: 'Cuenta suspendida',
    reactivar: 'Cuenta reactivada',
    eliminar: 'Cuenta eliminada',
    cerrar_sesiones: 'Sesiones cerradas'
};

export const FILTROS = [
    { valor: '', texto: 'Todas' },
    { valor: 'activa', texto: 'Activas' },
    { valor: 'suspendida', texto: 'Suspendidas' },
    { valor: 'sin_verificar', texto: 'Sin verificar' },
    { valor: 'menor_pendiente', texto: 'Menores sin autorización' }
];
