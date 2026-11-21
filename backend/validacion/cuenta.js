// Registro, inicio de sesión, perfil y baja de la cuenta.
import {
    limpiarTexto, normalizarEmail, esEmail, esNombre, esObjeto, errorPassword, esPasswordEscrita,
    MENSAJE_NOMBRE, MENSAJE_EMAIL
} from './texto.js';
import { esHex } from '../../compartido/paleta.js';
import { VERSIONES_VIGENTES, EDAD_MINIMA, MAYORIA_EDAD, edadEn } from '../../compartido/legal.js';

const PARENTESCOS = ['madre', 'padre', 'tutor'];
const esFechaReal = (f) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;

/**
 * Registro (v3.13). Además de nombre, correo y contraseña exige, SIEMPRE en el servidor:
 *  · aceptaDocumentos === true (la casilla de Términos y Política) y las versiones que se mostraron = las vigentes;
 *  · fechaNacimiento: mínimo 14 años; de 14 a 17, los datos del representante legal (que luego autoriza por correo).
 * `hoy` (YYYY-MM-DD) es la fecha local del servidor; se pasa para poder probarlo.
 * Cualquier otro campo del cuerpo (p. ej. «rol») se ignora: no existe forma de registrarse como administrador.
 */
export function validarRegistro(body, { hoy = new Date().toISOString().slice(0, 10) } = {}) {
    const nombre = limpiarTexto(body?.nombre, 60);
    const email = normalizarEmail(body?.email);
    const password = body?.password;
    if (!esNombre(nombre)) return { error: MENSAJE_NOMBRE };
    if (!esEmail(email)) return { error: MENSAJE_EMAIL };
    const e = errorPassword(password);
    if (e) return { error: e };

    if (body?.aceptaDocumentos !== true) {
        return { error: 'Para crear la cuenta debes aceptar los Términos y Condiciones y la Política de Tratamiento de Datos Personales.', codigo: 'aceptacion_requerida' };
    }
    const versiones = body?.versiones ?? {};
    if (versiones.terminos !== VERSIONES_VIGENTES.terminos || versiones.privacidad !== VERSIONES_VIGENTES.privacidad) {
        return { error: 'Los documentos legales se actualizaron. Recarga la página para ver la versión vigente y acéptala de nuevo.', codigo: 'version_documentos', status: 409 };
    }

    const fechaNacimiento = body?.fechaNacimiento;
    if (!esFechaReal(fechaNacimiento) || fechaNacimiento > hoy || fechaNacimiento < '1900-01-01') return { error: 'Escribe una fecha de nacimiento válida.' };
    const edad = edadEn(fechaNacimiento, hoy);
    if (edad < EDAD_MINIMA) return { error: `Para usar LearnTrack debes tener al menos ${EDAD_MINIMA} años.`, codigo: 'edad_minima' };

    let representante = null;
    if (edad < MAYORIA_EDAD) {
        const r = body?.representante;
        const nombreR = limpiarTexto(r?.nombre, 80);
        const emailR = normalizarEmail(r?.email);
        if (!esObjeto(r) || !esNombre(nombreR) || !esEmail(emailR) || !PARENTESCOS.includes(r.parentesco)) {
            return { error: 'Como eres menor de edad, escribe el nombre, el correo y el parentesco de tu madre, padre o representante legal.', codigo: 'representante_requerido' };
        }
        if (emailR === email) return { error: 'El correo de tu representante debe ser distinto del tuyo.', codigo: 'representante_requerido' };
        representante = { nombre: nombreR, email: emailR, parentesco: r.parentesco };
    }
    return { valor: { nombre, email, password, fechaNacimiento, representante } };
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
    if (body.temaSeleccionado !== undefined) {
        if (!temasValidos.includes(body.temaSeleccionado)) return { error: 'Tema no válido.' };
        cambios.temaSeleccionado = body.temaSeleccionado;
    }
    if (body.coloresPersonalizados !== undefined) {
        const c = body.coloresPersonalizados;
        if (!Array.isArray(c) || c.length !== 5 || !c.every(esHex)) return { error: 'La paleta debe tener 5 colores en formato #rrggbb.' };
        cambios.coloresPersonalizados = c.map((x) => x.toLowerCase());
    }
    if (body.nombreIA !== undefined) {
        const nombre = typeof body.nombreIA === 'string' ? limpiarTexto(body.nombreIA, 30) : '';
        if (!/^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,29}$/u.test(nombre)) return { error: 'El nombre del asistente debe tener de 1 a 30 letras o números.' };
        cambios.nombreIA = nombre;
    }
    if (body.vozAsistente !== undefined) {
        if (typeof body.vozAsistente !== 'string' || body.vozAsistente.length > 200) return { error: 'Voz no válida.' };
        cambios.vozAsistente = limpiarTexto(body.vozAsistente, 200);
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
