// Registro, inicio de sesión, perfil y baja de la cuenta.
import {
    limpiarTexto, normalizarEmail, esEmail, esNombre, esObjeto, errorPassword, esPasswordEscrita,
    MENSAJE_NOMBRE, MENSAJE_EMAIL
} from './texto.js';

export function validarRegistro(body) {
    const nombre = limpiarTexto(body?.nombre, 60);
    const email = normalizarEmail(body?.email);
    const password = body?.password;
    if (!esNombre(nombre)) return { error: MENSAJE_NOMBRE };
    if (!esEmail(email)) return { error: MENSAJE_EMAIL };
    const e = errorPassword(password);
    if (e) return { error: e };
    return { valor: { nombre, email, password } };
}

export function validarLogin(body) {
    const email = normalizarEmail(body?.email);
    const password = body?.password;
    if (!esEmail(email) || !esPasswordEscrita(password)) return { error: 'Correo o contraseña no válidos.' };
    return { valor: { email, password } };
}

/**
 * PUT /api/perfil: solo se aplican los campos presentes (parche). Cambiar correo o contraseña exige `passwordActual`.
 * Devuelve { valor: { cambios, passwordActual, passwordNueva, sensible } } o { error }.
 */
export function validarPerfil(body, temasValidos) {
    if (!esObjeto(body)) return { error: 'Datos no válidos.' };
    const cambios = {};
    if (body.nombre !== undefined) {
        const nombre = limpiarTexto(body.nombre, 60);
        if (!esNombre(nombre)) return { error: MENSAJE_NOMBRE };
        cambios.nombre = nombre;
    }
    if (body.email !== undefined) {
        const email = normalizarEmail(body.email);
        if (!esEmail(email)) return { error: MENSAJE_EMAIL };
        cambios.email = email;
    }
    if (body.temaEstetico !== undefined) {
        if (!temasValidos.includes(body.temaEstetico)) return { error: 'Tema no válido.' };
        cambios.temaEstetico = body.temaEstetico;
    }
    if (body.notificacionesActivas !== undefined) {
        if (typeof body.notificacionesActivas !== 'boolean') return { error: 'La preferencia de notificaciones no es válida.' };
        cambios.notificacionesActivas = body.notificacionesActivas;
    }
    if (body.preferenciasNotificaciones !== undefined) {
        if (!esObjeto(body.preferenciasNotificaciones)) return { error: 'Las preferencias de notificaciones no son válidas.' };
        const prefs = {};
        for (const clave of ['alertasTareas', 'recordatoriosIA']) {
            const v = body.preferenciasNotificaciones[clave];
            if (v === undefined) continue;
            if (typeof v !== 'boolean') return { error: 'Las preferencias de notificaciones no son válidas.' };
            prefs[clave] = v;
        }
        if (Object.keys(prefs).length) cambios.preferenciasNotificaciones = prefs;
    }
    const { passwordNueva, passwordActual } = body;
    if (passwordNueva !== undefined) {
        const e = errorPassword(passwordNueva, 'La nueva contraseña');
        if (e) return { error: e };
    }
    const sensible = cambios.email !== undefined || passwordNueva !== undefined;
    if (sensible && !esPasswordEscrita(passwordActual)) return { error: 'Para cambiar el correo o la contraseña escribe tu contraseña actual.' };
    if (passwordNueva !== undefined && passwordNueva === passwordActual) return { error: 'La nueva contraseña debe ser distinta de la actual.' };
    if (Object.keys(cambios).length === 0 && passwordNueva === undefined) return { error: 'No hay cambios que guardar.' };
    return { valor: { cambios, passwordActual: sensible ? passwordActual : undefined, passwordNueva, sensible } };
}

export function validarServicio(servicio, validos) {
    return typeof servicio === 'string' && validos.includes(servicio) ? servicio : null;
}

/** DELETE /api/perfil: contraseña + escribir ELIMINAR (doble confirmación) */
export function validarEliminarCuenta(body) {
    if (!esObjeto(body)) return { error: 'Datos no válidos.' };
    if (!esPasswordEscrita(body.password)) return { error: 'Escribe tu contraseña para confirmar.' };
    if (body.confirmacion !== 'ELIMINAR') return { error: 'Escribe ELIMINAR (en mayúsculas) para confirmar.' };
    return { valor: { password: body.password } };
}
