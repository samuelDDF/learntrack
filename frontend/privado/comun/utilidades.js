// Utilidades compartidas por las pantallas privadas (módulo ES). Todo el texto dinámico entra con textContent.
export { h, cerrarSesion } from '/comun/dom.js';
import { h } from '/comun/dom.js';

/** Fecha LOCAL del navegador (nunca toISOString/UTC: en Bogotá a las 8 p. m. el UTC ya es mañana) */
export function hoyISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const tzOffset = () => new Date().getTimezoneOffset();

/** fetch JSON con manejo de sesión caducada. Devuelve { ok, status, data } */
export async function api(url, cuerpo, metodo = cuerpo === undefined ? 'GET' : 'POST') {
    const opciones = { method: metodo };
    if (cuerpo instanceof FormData) opciones.body = cuerpo;
    else if (cuerpo !== undefined) { opciones.headers = { 'Content-Type': 'application/json' }; opciones.body = JSON.stringify(cuerpo); }
    const res = await fetch(url, opciones);
    if (res.status === 401) { location.assign('/?acceso=login'); throw new Error('Sesión no válida'); }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

/** Abre un <dialog> solo si no está abierto (showModal lanza si ya lo está) */
export function abrirDialogo(dlg) {
    if (dlg && !dlg.open) dlg.showModal();
}

/** Aviso flotante con acción opcional (p. ej. «Deshacer») */
export function aviso(texto, { accion = null, alPulsar = null, ms = 7000 } = {}) {
    let zona = document.getElementById('zona-avisos');
    if (!zona) { zona = h('div', { id: 'zona-avisos', class: 'zona-avisos', role: 'status', 'aria-live': 'polite' }); document.body.append(zona); }
    const caja = h('div', { class: 'aviso-flotante' }, h('span', { texto }));
    if (accion && alPulsar) caja.append(h('button', { type: 'button', class: 'aviso-accion', texto: accion, on: { click: () => { caja.remove(); alPulsar(); } } }));
    zona.append(caja);
    setTimeout(() => caja.remove(), ms);
}

/**
 * Confirmación en dos clics sin diálogos del navegador: el primer clic cambia el texto del botón y el segundo
 * ejecuta `alConfirmar`. Si no se confirma en `ms`, el botón vuelve a su estado. Devuelve una función que lo
 * restablece a mano (p. ej. al cerrar una ventana).
 */
export function confirmarEnDosPasos(boton, alConfirmar, { textoConfirmar = '¿Seguro?', ms = 4000 } = {}) {
    const original = boton.textContent;
    let temporizador = null;
    const restablecer = () => {
        clearTimeout(temporizador);
        delete boton.dataset.confirmando;
        boton.textContent = original;
        boton.classList.remove('confirmar');
    };
    boton.addEventListener('click', () => {
        if (boton.dataset.confirmando !== '1') {
            boton.dataset.confirmando = '1';
            boton.textContent = textoConfirmar;
            boton.classList.add('confirmar');
            temporizador = setTimeout(() => { if (boton.isConnected) restablecer(); }, ms);
            return;
        }
        restablecer();
        alConfirmar();
    });
    return restablecer;
}
