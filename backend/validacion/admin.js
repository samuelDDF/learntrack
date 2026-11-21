// Validación de las acciones del panel de administración (v3.13). Nada llega a la base de datos sin pasar por aquí.
import { limpiarTexto, normalizarEmail, esObjeto, errorPassword } from './texto.js';

const LARGO_MINIMO_ADMIN = 14;
/** Contraseña del administrador (la pide scripts/admin.js): más exigente que la de una cuenta normal */
export function errorPasswordAdmin(password, email) {
    const base = errorPassword(password);
    if (base) return base;
    if (password.length < LARGO_MINIMO_ADMIN) return `Debe tener al menos ${LARGO_MINIMO_ADMIN} caracteres.`;
    const clases = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rx) => rx.test(password)).length;
    if (clases < 3) return 'Combina al menos tres de: minúsculas, mayúsculas, números y símbolos.';
    const usuario = String(email).split('@')[0].toLowerCase();
    if (usuario.length >= 4 && password.toLowerCase().includes(usuario)) return 'No uses tu correo dentro de la contraseña.';
    return null;
}

const ESTADOS_FILTRO = ['', 'activa', 'suspendida', 'sin_verificar', 'menor_pendiente'];
export const esIdCuenta = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);

/** ?q=&estado=&pagina= del listado */
export function validarConsultaCuentas(query) {
    const q = limpiarTexto(typeof query?.q === 'string' ? query.q : '', 80);
    const estado = typeof query?.estado === 'string' ? query.estado : '';
    if (!ESTADOS_FILTRO.includes(estado)) return { error: 'Filtro de estado no válido.' };
    const pagina = Number(query?.pagina ?? 1);
    if (!Number.isInteger(pagina) || pagina < 1 || pagina > 10000) return { error: 'Página no válida.' };
    return { valor: { q, estado, pagina } };
}

export function validarPagina(query) {
    const pagina = Number(query?.pagina ?? 1);
    return Number.isInteger(pagina) && pagina >= 1 && pagina <= 10000 ? { valor: pagina } : { error: 'Página no válida.' };
}

/** Suspensión: motivo obligatorio (5–300) y fecha de fin opcional (futura, máximo un año) */
export function validarSuspension(body, ahora = new Date()) {
    if (!esObjeto(body)) return { error: 'Datos no válidos.' };
    const motivo = limpiarTexto(body.motivo, 300);
    if (motivo.length < 5) return { error: 'Escribe el motivo de la suspensión (5 a 300 caracteres).' };
    let hasta = null;
    if (body.hasta !== undefined && body.hasta !== null && body.hasta !== '') {
        const f = typeof body.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.hasta) ? new Date(`${body.hasta}T23:59:59`) : null;
        if (!f || Number.isNaN(f.getTime()) || f <= ahora || f > new Date(ahora.getTime() + 366 * 86400000)) return { error: 'La fecha de fin debe ser futura y como máximo dentro de un año.' };
        hasta = f;
    }
    return { valor: { motivo, hasta } };
}

/** Eliminación: hay que reescribir el correo de la cuenta (evita borrados accidentales) y dar un motivo */
export function validarEliminacion(body) {
    if (!esObjeto(body)) return { error: 'Datos no válidos.' };
    const confirmacion = normalizarEmail(body.confirmacion);
    const motivo = limpiarTexto(body.motivo ?? '', 300);
    if (!confirmacion) return { error: 'Escribe el correo de la cuenta para confirmar.' };
    if (motivo.length < 5) return { error: 'Escribe el motivo de la eliminación (5 a 300 caracteres).' };
    return { valor: { confirmacion, motivo } };
}
