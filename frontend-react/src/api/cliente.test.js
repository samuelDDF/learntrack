import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, navegador, ErrorConexion, mensajeDeError } from './cliente.js';
import { simularFetch } from '../pruebas/utilidades.jsx';

describe('cliente HTTP (contrato HTTP de la aplicación)', () => {
    beforeEach(() => { vi.spyOn(navegador, 'irA').mockImplementation(() => {}); });

    it('envía JSON con la zona horaria y devuelve { ok, status, data }', async () => {
        const f = simularFetch({ 'POST /api/actividades': (cuerpo) => ({ status: 201, json: { recibido: cuerpo } }) });
        const r = await api('/api/actividades', { titulo: 'Leer' });
        expect(r).toEqual({ ok: true, status: 201, data: { recibido: { titulo: 'Leer' } } });
        const [, init] = f.mock.calls[0];
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.headers['X-Zona-Horaria']).toBeTruthy();
        expect(init.credentials).toBe('same-origin');
    });

    it('GET sin cuerpo; un Blob viaja con su Content-Type (foto de perfil)', async () => {
        const f = simularFetch({ 'GET /api/perfil': { json: { ok: 1 } }, 'PUT /api/perfil/avatar': { json: {} } });
        await api('/api/perfil');
        expect(f.mock.calls[0][1].method).toBe('GET');
        expect(f.mock.calls[0][1].body).toBeUndefined();
        await api('/api/perfil/avatar', new Blob(['x'], { type: 'image/jpeg' }), 'PUT');
        expect(f.mock.calls[1][1].headers['Content-Type']).toBe('image/jpeg');
    });

    it('401 en la zona privada → al acceso; en la pública (login) solo devuelve el error', async () => {
        simularFetch({ 'GET /api/actividades': { status: 401, json: { error: 'Debes iniciar sesión.' } }, 'POST /api/auth/login': { status: 401, json: { error: 'Correo o contraseña incorrectos.' } } });
        await expect(api('/api/actividades')).rejects.toBeInstanceOf(ErrorConexion);
        expect(navegador.irA).toHaveBeenCalledWith('/?acceso=login');
        navegador.irA.mockClear();
        const r = await api('/api/auth/login', { email: 'a', password: 'b' }, 'POST', { redirigir401: false });
        expect(r.status).toBe(401);
        expect(mensajeDeError(r)).toBe('Correo o contraseña incorrectos.');
        expect(navegador.irA).not.toHaveBeenCalled();
    });

    it('solo admite rutas propias /api/… (nunca otro origen)', async () => {
        await expect(api('https://evil.example/api/x')).rejects.toThrow(TypeError);
        await expect(api('/otra')).rejects.toThrow(TypeError);
    });

    it('sin conexión o con tiempo agotado lanza ErrorConexion con un mensaje legible', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        await expect(api('/api/x')).rejects.toMatchObject({ name: 'ErrorConexion', message: 'No se pudo conectar con el servidor.' });
        vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((_, mal) => init.signal.addEventListener('abort', () => mal(new DOMException('abortado', 'AbortError'))))));
        const error = await api('/api/x', undefined, 'GET', { espera: 20 }).catch((e) => e);
        expect(error).toBeInstanceOf(ErrorConexion);
        expect(error.tiempoAgotado).toBe(true);
    });
});
