// Almacén ÚNICO del usuario de la sesión (/api/auth/me). Lo usan AuthContext (React) y los módulos que no son
// componentes (p. ej. la voz del asistente). La sesión vive en una cookie HttpOnly: aquí solo se sabe QUIÉN es la
// persona; la autorización real la hace SIEMPRE el servidor en cada petición.
import { auth } from '../features/auth/services/auth.service.js';
import { usuarioPrecargado } from './tema.js';

let promesa = null;
const oyentes = new Set();
const avisar = (u) => oyentes.forEach((fn) => fn(u));

/** Devuelve el usuario ({ id, nombre, email, temaSeleccionado, vozAsistente, nombreIA, avatarUrl, … }) o null */
export function obtenerUsuario({ refrescar = false } = {}) {
    if (!refrescar && !promesa && usuarioPrecargado()) promesa = Promise.resolve(usuarioPrecargado());
    if (refrescar || !promesa) {
        promesa = auth.yo().then((r) => (r.ok ? r.data.usuario ?? null : null)).catch(() => null);
        if (refrescar) promesa.then(avisar);
    }
    return promesa;
}

/** Fija el usuario (null al cerrar sesión o al caducar) y avisa a quien escuche */
export function fijarUsuario(usuario) {
    promesa = Promise.resolve(usuario ?? null);
    avisar(usuario ?? null);
    return promesa;
}

/** Tras guardar cambios del perfil (nombre, foto, voz…) la cabecera y demás piezas se actualizan con esto */
export function actualizarUsuario(cambios) {
    promesa = (promesa ?? Promise.resolve({})).then((u) => (u ? { ...u, ...cambios } : u));
    promesa.then(avisar);
    return promesa;
}

export function alActualizarUsuario(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
}

/** Solo para las pruebas */
export function _reiniciarSesion() { promesa = null; oyentes.clear(); }
