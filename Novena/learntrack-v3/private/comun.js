// Utilidades compartidas del cliente privado (módulo ES). Todo el texto dinámico entra con textContent.

/** Fecha LOCAL del navegador (nunca toISOString/UTC: en Bogotá a las 8 p. m. el UTC ya es mañana) */
export function hoyISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const tzOffset = () => new Date().getTimezoneOffset();

/** Crea elementos sin innerHTML. props: class, texto, on: { evento: fn }, estilo: { prop: valor } (CSSOM, permitido por la CSP) */
export function h(tag, props = {}, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'texto') el.textContent = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
        else if (k === 'estilo') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const hijo of hijos.flat()) if (hijo !== null && hijo !== undefined && hijo !== false) el.append(hijo);
    return el;
}

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

export async function cerrarSesion(boton) {
    boton.disabled = true;
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* se redirige igualmente */ }
    location.assign('/');
}
