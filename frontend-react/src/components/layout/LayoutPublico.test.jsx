import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { pintarApp, simularFetch, ubicacion } from '../../pruebas/utilidades.jsx';

const sinSesion = { 'GET /api/auth/me': { json: { usuario: null } } };

describe('Zona pública (SPA)', () => {
    it('inicio, planificador y asistente con su título; ruta desconocida → «Página no encontrada»', async () => {
        simularFetch(sinSesion);
        const { unmount } = pintarApp('/');
        expect(screen.getByRole('heading', { level: 1, name: /Organiza tu vida/ })).toBeInTheDocument();
        await waitFor(() => expect(document.title).toBe('LearnTrack | Organiza tu vida y aprende mejor'));
        unmount();
        pintarApp('/planificador');
        expect(await screen.findByRole('heading', { level: 1, name: 'Planificador inteligente' })).toBeInTheDocument();
        expect(document.title).toBe('Planificador inteligente | LearnTrack');
        fireEvent.click(screen.getByRole('link', { name: 'Asistente IA' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Asistente con IA Local' })).toBeInTheDocument();
        expect(ubicacion.actual.pathname).toBe('/asistente');
        expect(screen.getByRole('link', { name: 'Asistente IA' })).toHaveAttribute('aria-current', 'page');
    });

    it('404: página propia con «noindex» y enlace de vuelta al inicio sin recargar', async () => {
        simularFetch(sinSesion);
        pintarApp('/no-existe');
        expect(screen.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument();
        await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex'));
        fireEvent.click(screen.getByRole('link', { name: 'Volver al inicio' }));
        expect(await screen.findByRole('heading', { level: 1, name: /Organiza tu vida/ })).toBeInTheDocument();
        expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    });

    it('la ventana de acceso tiene su dirección (/login ↔ /registro) y se abre ENCIMA de la página; cerrar vuelve a ella', async () => {
        simularFetch(sinSesion);
        pintarApp('/planificador');
        await screen.findByRole('heading', { level: 1, name: 'Planificador inteligente' });
        fireEvent.click(within(document.getElementById('nav-acceso')).getByRole('button', { name: 'Iniciar sesión / Registro' }));
        expect(await screen.findByRole('heading', { name: 'Accede a LearnTrack' })).toBeInTheDocument();
        expect(ubicacion.actual.pathname).toBe('/login');
        expect(document.title).toBe('Iniciar sesión | LearnTrack');
        // La página de fondo sigue siendo la misma
        expect(screen.getByRole('heading', { level: 1, name: 'Planificador inteligente' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Crear cuenta' }));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/registro'));
        expect(screen.getByRole('tab', { name: 'Crear cuenta' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/planificador'));
        expect(screen.queryByRole('heading', { name: 'Accede a LearnTrack' })).toBeNull();
    });

    it('acceso: un error del servidor se muestra; al entrar va al panel SIN recargar (la sesión la pone el servidor)', async () => {
        let intentos = 0;
        let conSesion = false;
        simularFetch({
            'GET /api/auth/me': () => ({ json: { usuario: conSesion ? { id: 'u1', nombre: 'Ana' } : null } }),
            'POST /api/auth/login': () => {
                if (++intentos === 1) return { status: 401, json: { error: 'Correo o contraseña incorrectos.' } };
                conSesion = true;
                return { json: { usuario: { nombre: 'Ana' } } };
            }
        });
        pintarApp('/login');
        fireEvent.change(await screen.findByLabelText('Correo electrónico', { selector: '#login-email' }), { target: { value: 'ana@prueba.co' } });
        fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave1234' } });
        const dlg = within(document.querySelector('.auth-dialog'));
        fireEvent.click(dlg.getByRole('button', { name: 'Iniciar sesión' }));
        expect(await dlg.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
        expect(ubicacion.actual.pathname).toBe('/login');
        fireEvent.click(dlg.getByRole('button', { name: 'Iniciar sesión' }));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/panel'));
    });

    it('registro: valida los campos en el navegador antes de enviar', async () => {
        const f = simularFetch(sinSesion);
        pintarApp('/registro');
        fireEvent.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Completa todos los campos con datos válidos.');
        expect(f.mock.calls.some(([u]) => u === '/api/auth/registro')).toBe(false);
    });

    it('compatibilidad: /?acceso=login (enlaces de versiones anteriores) abre /login', async () => {
        simularFetch(sinSesion);
        pintarApp('/?acceso=login');
        expect(await screen.findByRole('heading', { name: 'Accede a LearnTrack' })).toBeInTheDocument();
        expect(ubicacion.actual.pathname).toBe('/login');
    });

    it('con sesión: «Mi panel» es un enlace; «Cerrar sesión» cierra en el servidor y la cabecera vuelve al acceso', async () => {
        const f = simularFetch({ 'GET /api/auth/me': { json: { usuario: { id: 'u', nombre: 'Ana' } } }, 'POST /api/auth/logout': { json: { ok: true } } });
        pintarApp('/');
        expect(await screen.findByRole('link', { name: 'Mi panel' })).toHaveAttribute('href', '/panel');
        expect(screen.getAllByRole('link', { name: 'Ir a mi panel' }).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        expect(await screen.findByRole('button', { name: 'Iniciar sesión / Registro' })).toBeInTheDocument();
        expect(f.mock.calls.some(([u, i]) => u === '/api/auth/logout' && i.method === 'POST')).toBe(true);
        expect(ubicacion.actual.pathname).toBe('/');
    });

    it('con sesión, /login no tiene sentido: lleva al panel', async () => {
        simularFetch({ 'GET /api/auth/me': { json: { usuario: { id: 'u', nombre: 'Ana' } } } });
        pintarApp('/login');
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/panel'));
    });

    it('menú hamburguesa accesible (aria-expanded) y contacto que no envía datos incompletos', async () => {
        const f = simularFetch({ ...sinSesion, 'POST /api/contacto': { status: 201, json: { ok: true } } });
        pintarApp('/');
        const menu = screen.getByRole('button', { name: 'Abrir menú' });
        expect(menu).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(menu);
        expect(screen.getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Abrir contacto' }));
        fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
        expect(screen.getByText('Completa todos los campos con un correo válido.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Visitante' } });
        fireEvent.change(screen.getByLabelText('Correo electrónico', { selector: '#correo-mini' }), { target: { value: 'v@prueba.co' } });
        fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola, quiero probar' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
        expect(await screen.findByText('Mensaje enviado. Te responderemos pronto.')).toBeInTheDocument();
        const [url, init] = f.mock.calls.find(([u]) => u === '/api/contacto');
        expect(url).toBe('/api/contacto');
        expect(init.method).toBe('POST');
    });
});
