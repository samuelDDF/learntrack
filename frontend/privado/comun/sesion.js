// Usuario de la sesión actual (/api/auth/me), pedido UNA sola vez por página y compartido por la barra de
// navegación, el chat (voz preferida) y cada pantalla. Sin sesión, api() redirige al acceso.
import { api } from '/app/comun/utilidades.js';

let promesa = null;

/** Devuelve el usuario ({ id, nombre, email, temaSeleccionado, vozAsistente, avatarUrl, … }) o null */
export function usuarioActual({ refrescar = false } = {}) {
    // La primera vez se aprovecha la petición que ya hizo tema-inicial.js en el <head>
    if (!refrescar && !promesa && window.LearnTrackTema?.usuario) promesa = window.LearnTrackTema.usuario;
    if (refrescar || !promesa) {
        promesa = api('/api/auth/me')
            .then((r) => (r.ok ? r.data.usuario ?? null : null))
            .catch(() => null);
    }
    return promesa;
}

/** Tras guardar cambios del perfil (nombre, foto, voz…) la barra y demás piezas se actualizan con esto */
export function actualizarUsuario(cambios) {
    promesa = (promesa ?? Promise.resolve({})).then((u) => ({ ...(u ?? {}), ...cambios }));
    promesa.then((u) => document.dispatchEvent(new CustomEvent('usuario-actualizado', { detail: u })));
    return promesa;
}
