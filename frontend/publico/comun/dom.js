// Utilidades del navegador compartidas por TODAS las páginas (públicas y privadas). Módulo ES.

/**
 * Crea un elemento sin innerHTML: el texto entra siempre con textContent (así nunca se interpreta HTML).
 * props: class, texto, on: { evento: fn }, estilo: { propiedad: valor } (CSSOM, permitido por la CSP),
 *        y cualquier otro atributo (true = atributo vacío; false/null/undefined = se omite).
 */
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

/** Página a la que se entra tras iniciar sesión */
export const RUTA_PANEL = '/panel';

/** Cierra la sesión en el servidor y vuelve al inicio */
export async function cerrarSesion(boton) {
    if (boton) boton.disabled = true;
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* se redirige igualmente */ }
    location.assign('/');
}
document.addEventListener('DOMContentLoaded', () => {
    // Referencias a los elementos del botón flotante
    const btnFlotante = document.getElementById('btn-flotante');
    const popupContacto = document.getElementById('contacto-popup');
    const btnCerrarPopup = document.getElementById('cerrar-popup');

    // Verificamos que existan en la página actual antes de ejecutar la lógica
    if (btnFlotante && popupContacto && btnCerrarPopup) {
        
        // Al hacer clic en el asistente, alternamos la clase 'activo'
        btnFlotante.addEventListener('click', () => {
            popupContacto.classList.toggle('activo');
        });

        // Al hacer clic en la "X", removemos la clase 'activo'
        btnCerrarPopup.addEventListener('click', () => {
            popupContacto.classList.remove('activo');
        });

        // Opcional: Cerrar el popup si el usuario presiona la tecla Escape (Esc)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && popupContacto.classList.contains('activo')) {
                popupContacto.classList.remove('activo');
            }
        });
    }
});