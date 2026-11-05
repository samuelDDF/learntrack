// Usuario de la sesión actual (/api/auth/me), pedido UNA vez por carga de página y compartido por la cabecera, el
// chat (voz y nombre del asistente) y cada pantalla. La sesión vive en una cookie HttpOnly: aquí solo se lee quién
// es la persona. La autorización real la hace SIEMPRE el servidor.
import { auth } from '../api/publico.js';
import { olvidarApariencia, usuarioPrecargado } from './tema.js';
import { navegador } from '../api/cliente.js';

let promesa = null;
const oyentes = new Set();

/** Devuelve el usuario ({ id, nombre, email, temaSeleccionado, vozAsistente, nombreIA, avatarUrl, … }) o null */
export function obtenerUsuario({ refrescar = false } = {}) {
    if (!refrescar && !promesa && usuarioPrecargado()) promesa = Promise.resolve(usuarioPrecargado());
    if (refrescar || !promesa) {
        promesa = auth.yo().then((r) => (r.ok ? r.data.usuario ?? null : null)).catch(() => null);
    }
    return promesa;
}

/** Tras guardar cambios del perfil (nombre, foto, voz…) la cabecera y demás piezas se actualizan con esto */
export function actualizarUsuario(cambios) {
    promesa = (promesa ?? Promise.resolve({})).then((u) => ({ ...(u ?? {}), ...cambios }));
    promesa.then((u) => oyentes.forEach((fn) => fn(u)));
    return promesa;
}
export function alActualizarUsuario(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
}

/** Cierra la sesión EN EL SERVIDOR (borra el token de la BD), olvida la apariencia y navega con recarga completa */
export async function cerrarSesion(destino = '/') {
    try { await auth.logout(); } catch { /* se redirige igualmente */ }
    olvidarApariencia();
    promesa = null;
    navegador.irA(destino);
}

/** Solo para las pruebas */
export function _reiniciarSesion() { promesa = null; oyentes.clear(); }
