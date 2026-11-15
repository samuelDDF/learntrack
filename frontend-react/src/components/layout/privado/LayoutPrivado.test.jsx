import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { pintarApp, simularFetch, ubicacion } from '../../../pruebas/utilidades.jsx';
import { EVENTO_SESION_CADUCADA } from '../../../services/http.js';
import { _reiniciarSesion } from '../../../services/sesion.js';

const ANA = { id: 'u', nombre: 'Ana López', email: 'a@b.co' };
const REPASO = {
    'GET /api/repaso/pendientes': { json: { hoy: '2026-10-28', pendientes: 0, actividades: [] } },
    'GET /api/repaso': { json: { actividades: [] } },
    'GET /api/actividades': { json: [] }
};

describe('Zona privada (RutaPrivada + LayoutPrivado)', () => {
    it('sin sesión no pinta nada privado y va a /login recordando la página pedida', async () => {
        simularFetch({ 'GET /api/auth/me': { json: { usuario: null } } });
        pintarApp('/calendario');
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/login'));
        expect(ubicacion.actual.state).toEqual({ desde: { pathname: '/calendario', search: '', hash: '' } });
        expect(screen.queryByText(/Hola,/)).toBeNull();
        expect(document.documentElement).not.toHaveClass('zona-privada');
        expect(await screen.findByRole('heading', { name: 'Accede a LearnTrack' })).toBeInTheDocument();
    });

    it('tras entrar vuelve a la página privada que se pidió', async () => {
        let conSesion = false;
        simularFetch({
            ...REPASO,
            'GET /api/auth/me': () => ({ json: { usuario: conSesion ? ANA : null } }),
            'POST /api/auth/login': () => { conSesion = true; return { json: { usuario: ANA } }; }
        });
        pintarApp('/repaso');
        fireEvent.change(await screen.findByLabelText('Correo electrónico', { selector: '#login-email' }), { target: { value: 'a@b.co' } });
        fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave1234' } });
        fireEvent.submit(document.getElementById('form-login'));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/repaso'));
        expect(await screen.findByRole('heading', { level: 1, name: /Repaso espaciado/ })).toBeInTheDocument();
    });

    it('con sesión: cabecera con navegación (Repaso y Bienestar), saludo, título y clase de zona en <html> y <body>', async () => {
        simularFetch({ 'GET /api/auth/me': { json: { usuario: ANA } }, ...REPASO });
        pintarApp('/repaso');
        expect(await screen.findByText('Hola, Ana')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Repaso' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Bienestar' })).toHaveAttribute('href', '/bienestar');
        expect(document.documentElement).toHaveClass('zona-privada');
        expect(document.body).toHaveClass('zona-privada', 'pagina-repaso');
        expect(await screen.findByRole('heading', { level: 1, name: /Repaso espaciado/ })).toBeInTheDocument();
        expect(document.title).toBe('Repaso | LearnTrack');
    });

    it('volver a la parte pública SIN recargar quita la zona privada (los estilos privados dejan de aplicarse)', async () => {
        simularFetch({ 'GET /api/auth/me': { json: { usuario: ANA } }, ...REPASO });
        pintarApp('/repaso');
        await screen.findByText('Hola, Ana');
        expect(document.documentElement).toHaveClass('zona-privada');
        fireEvent.click(screen.getByRole('link', { name: 'LearnTrack' }));
        expect(await screen.findByRole('heading', { level: 1, name: /Organiza tu vida/ })).toBeInTheDocument();
        expect(ubicacion.actual.pathname).toBe('/');
        expect(document.documentElement).not.toHaveClass('zona-privada');
        expect(document.body).not.toHaveClass('zona-privada');
        expect(screen.getByRole('link', { name: 'Mi panel' })).toBeInTheDocument();
    });

    it('sesión caducada (401 en una petición): la app lo detecta y lleva a /login sin recargar', async () => {
        simularFetch({ 'GET /api/auth/me': { json: { usuario: ANA } }, ...REPASO });
        pintarApp('/repaso');
        await screen.findByText('Hola, Ana');
        window.dispatchEvent(new CustomEvent(EVENTO_SESION_CADUCADA));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/login'));
        expect(ubicacion.actual.state.desde.pathname).toBe('/repaso');
        expect(screen.queryByText('Hola, Ana')).toBeNull();
    });

    it('«Cerrar sesión» y «Cambiar de cuenta» del panel lateral: cierran en el servidor y van a / o a /login', async () => {
        const f = simularFetch({ 'GET /api/auth/me': { json: { usuario: ANA } }, 'POST /api/auth/logout': { json: { ok: true } }, ...REPASO });
        const { unmount } = pintarApp('/repaso');
        fireEvent.click(await screen.findByRole('button', { name: /Mi perfil/ }));
        fireEvent.click(screen.getByRole('button', { name: /Cambiar de cuenta/ }));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/login'));
        expect(f.mock.calls.filter(([u]) => u === '/api/auth/logout')).toHaveLength(1);
        unmount();
        _reiniciarSesion();

        simularFetch({ 'GET /api/auth/me': { json: { usuario: ANA } }, 'POST /api/auth/logout': { json: { ok: true } }, ...REPASO });
        pintarApp('/repaso');
        fireEvent.click(await screen.findByRole('button', { name: /Mi perfil/ }));
        fireEvent.click(screen.getByRole('button', { name: /Cerrar sesión/ }));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/'));
        expect(screen.getByRole('button', { name: 'Iniciar sesión / Registro' })).toBeInTheDocument();
    });

    it('«Editar mi perfil» y el engranaje llevan a /perfil y /configuracion', async () => {
        simularFetch({ 'GET /api/auth/me': { json: { usuario: ANA } }, ...REPASO });
        pintarApp('/repaso');
        fireEvent.click(await screen.findByRole('button', { name: /Mi perfil/ }));
        expect(screen.getByRole('link', { name: /Editar mi perfil/ })).toHaveAttribute('href', '/perfil');
        const menu = document.getElementById('menu-configuracion');
        expect(menu.querySelector('[data-seccion="informacion"]')).toHaveAttribute('href', '/perfil#informacion');
        expect(menu.querySelector('[data-seccion="privacidad"]')).toHaveAttribute('href', '/perfil#privacidad');
        expect(menu.querySelector('[data-seccion="voz"]')).toHaveAttribute('href', '/configuracion#voz');
    });
});
