// Utilidades de las pruebas del frontend: fetch simulado por ruta y render con enrutador y proveedores globales.
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { Proveedores } from '../app/providers.jsx';
import { Enrutador } from '../app/router.jsx';
import { fijarUsuario } from '../services/sesion.js';

/**
 * Sustituye fetch: rutas = { 'GET /api/x': respuesta | (cuerpo, init) => respuesta }.
 * respuesta = { status = 200, json }. Devuelve el mock (llamadas en .mock.calls).
 */
export function simularFetch(rutas) {
    const fn = vi.fn(async (url, init = {}) => {
        const metodo = (init.method ?? 'GET').toUpperCase();
        const ruta = String(url).split('?')[0];
        const h = rutas[`${metodo} ${String(url)}`] ?? rutas[`${metodo} ${ruta}`];
        if (!h) return new Response(JSON.stringify({ error: `sin simular: ${metodo} ${url}` }), { status: 404 });
        const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        const r = typeof h === 'function' ? await h(cuerpo, init) : h;
        return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
}

/** Dirección actual del enrutador (para comprobar navegaciones sin recargar) */
export const ubicacion = { actual: null };
function Sonda() {
    ubicacion.actual = useLocation();
    return null;
}

/**
 * Pinta un componente con el enrutador en memoria y los proveedores globales (sesión, tema y avisos).
 * usuario: la sesión de partida (por defecto, sin sesión y sin pedir nada). undefined = se pregunta a
 * GET /api/auth/me como en la app real.
 */
export function pintar(ui, opciones = {}) {
    const { ruta = '/' } = opciones;
    const usuario = 'usuario' in opciones ? opciones.usuario : null;
    if (usuario !== undefined) fijarUsuario(usuario);
    return render(<MemoryRouter initialEntries={[ruta]}><Proveedores>{ui}<Sonda /></Proveedores></MemoryRouter>);
}

/** Pinta la APLICACIÓN completa (enrutador central) en `ruta` */
export function pintarApp(ruta = '/', { usuario } = {}) {
    return pintar(<Enrutador />, { ruta, usuario });
}
