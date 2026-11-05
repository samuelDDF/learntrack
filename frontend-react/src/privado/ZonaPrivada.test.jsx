import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ZonaPrivada from './ZonaPrivada.jsx';
import { simularFetch } from '../pruebas/utilidades.jsx';
import { navegador } from '../api/cliente.js';
import { _reiniciarSesion } from '../comun/sesion.js';

describe('Zona privada', () => {
    beforeEach(() => { _reiniciarSesion(); vi.spyOn(navegador, 'irA').mockImplementation(() => {}); });

    it('sin sesión no pinta nada privado y va al acceso', async () => {
        simularFetch({ 'GET /api/auth/me': { json: { usuario: null } } });
        render(<MemoryRouter initialEntries={['/panel']}><ZonaPrivada /></MemoryRouter>);
        await waitFor(() => expect(navegador.irA).toHaveBeenCalledWith('/?acceso=login'));
        expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).toBeNull();
    });

    it('con sesión: cabecera con navegación (incluido Repaso), saludo y clase de zona en <body>', async () => {
        simularFetch({
            'GET /api/auth/me': { json: { usuario: { id: 'u', nombre: 'Ana López', email: 'a@b.co' } } },
            'GET /api/repaso/pendientes': { json: { hoy: '2026-10-28', pendientes: 0, actividades: [] } },
            'GET /api/repaso': { json: { actividades: [] } },
            'GET /api/actividades': { json: [] }
        });
        render(<MemoryRouter initialEntries={['/repaso']}><ZonaPrivada /></MemoryRouter>);
        expect(await screen.findByText('Hola, Ana')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Repaso' })).toHaveAttribute('aria-current', 'page');
        expect(document.body).toHaveClass('zona-privada', 'pagina-repaso');
        expect(await screen.findByRole('heading', { level: 1, name: /Repaso espaciado/ })).toBeInTheDocument();
    });
});
