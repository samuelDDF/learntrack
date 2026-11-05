// Utilidades de las pruebas del frontend: fetch simulado por ruta y render con enrutador.
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProveedorAvisos } from '../comun/ui/Avisos.jsx';

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

export function pintar(ui, { ruta = '/' } = {}) {
    return render(<MemoryRouter initialEntries={[ruta]}><ProveedorAvisos>{ui}</ProveedorAvisos></MemoryRouter>);
}
