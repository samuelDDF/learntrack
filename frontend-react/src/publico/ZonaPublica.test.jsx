import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ZonaPublica from './ZonaPublica.jsx';
import { simularFetch } from '../pruebas/utilidades.jsx';
import { navegador } from '../api/cliente.js';
import { _reiniciarSesion } from '../comun/sesion.js';

const ver = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><ZonaPublica /></MemoryRouter>);
const sinSesion = { 'GET /api/auth/me': { json: { usuario: null } } };

describe('Zona pública', () => {
    beforeEach(() => { _reiniciarSesion(); vi.spyOn(navegador, 'irA').mockImplementation(() => {}); });

    it('inicio, planificador y asistente con su título; ruta desconocida → «Página no encontrada»', async () => {
        simularFetch(sinSesion);
        ver('/');
        expect(screen.getByRole('heading', { level: 1, name: /Organiza tu vida/ })).toBeInTheDocument();
        expect(document.title).toMatch(/LearnTrack/);
        ver('/planificador');
        expect(screen.getByRole('heading', { level: 1, name: 'Planificador inteligente' })).toBeInTheDocument();
        ver('/asistente');
        expect(screen.getByRole('heading', { level: 1, name: 'Asistente con IA Local' })).toBeInTheDocument();
        ver('/no-existe');
        expect(screen.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument();
        await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex'));
    });

    it('acceso: un error del servidor se muestra; al entrar va SIEMPRE a /panel', async () => {
        let intentos = 0;
        simularFetch({
            ...sinSesion,
            'POST /api/auth/login': () => (++intentos === 1 ? { status: 401, json: { error: 'Correo o contraseña incorrectos.' } } : { json: { usuario: { nombre: 'Ana' } } })
        });
        ver('/');
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión / Registro' }));
        fireEvent.change(await screen.findByLabelText('Correo electrónico', { selector: '#login-email' }), { target: { value: 'ana@prueba.co' } });
        fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave1234' } });
        const dlg = within(document.querySelector('.auth-dialog'));
        fireEvent.click(dlg.getByRole('button', { name: 'Iniciar sesión' }));
        expect(await dlg.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
        expect(navegador.irA).not.toHaveBeenCalled();
        fireEvent.click(dlg.getByRole('button', { name: 'Iniciar sesión' }));
        await waitFor(() => expect(navegador.irA).toHaveBeenCalledWith('/panel'));
    });

    it('registro: valida los campos en el navegador antes de enviar', async () => {
        const f = simularFetch(sinSesion);
        ver('/');
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión / Registro' }));
        fireEvent.click(await screen.findByRole('tab', { name: 'Crear cuenta' }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Completa todos los campos con datos válidos.');
        expect(f.mock.calls.some(([u]) => u === '/api/auth/registro')).toBe(false);
    });

    it('/?acceso=login abre el acceso (lo usa el servidor al proteger páginas privadas)', async () => {
        simularFetch(sinSesion);
        ver('/?acceso=login');
        expect(await screen.findByRole('heading', { name: 'Accede a LearnTrack' })).toBeInTheDocument();
    });

    it('con sesión: «Mi panel» y «Cerrar sesión», que cierra en el servidor', async () => {
        const f = simularFetch({ 'GET /api/auth/me': { json: { usuario: { id: 'u', nombre: 'Ana' } } }, 'POST /api/auth/logout': { json: { ok: true } } });
        ver('/');
        fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
        await waitFor(() => expect(navegador.irA).toHaveBeenCalledWith('/'));
        expect(f.mock.calls.some(([u, i]) => u === '/api/auth/logout' && i.method === 'POST')).toBe(true);
        expect(screen.getAllByRole('button', { name: 'Ir a mi panel' }).length).toBeGreaterThan(0);
    });

    it('menú hamburguesa accesible (aria-expanded) y contacto que no envía datos incompletos', async () => {
        const f = simularFetch({ ...sinSesion, 'POST /api/contacto': { status: 201, json: { ok: true } } });
        ver('/');
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
