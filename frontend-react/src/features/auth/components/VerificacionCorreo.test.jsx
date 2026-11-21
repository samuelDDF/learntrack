// v3.10 · Pantalla «Verifica tu correo electrónico»: casillas, pegar, solo números, cuenta atrás, reenvío con espera,
// mensajes de error, sin doble envío y flujo completo desde el registro y desde un inicio de sesión sin verificar.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { VerificacionCorreo } from './VerificacionCorreo.jsx';
import { pintar, pintarApp, simularFetch, ubicacion } from '../../../pruebas/utilidades.jsx';

const ESTADO = { emailOculto: 'usua***@gmail.com', codigoActivo: true, expiraEnSegundos: 600, reenviarEnSegundos: 60, intentosRestantes: 5, minutosValidez: 10 };
const casillas = () => screen.getAllByRole('textbox', { name: /Dígito \d de 6/ });
const pintarPaso = (props = {}) => pintar(<VerificacionCorreo verificacion={ESTADO} alIrALogin={vi.fn()} alUsarOtroCorreo={vi.fn()} {...props} />, { usuario: null });
const pegar = (el, texto) => fireEvent.paste(el, { clipboardData: { getData: () => texto } });
const llamadas = (f, ruta) => f.mock.calls.filter(([u]) => u === ruta);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('paso de verificación', () => {
    it('muestra el correo oculto, seis casillas numéricas y el botón desactivado hasta completar el código', () => {
        simularFetch({});
        pintarPaso();
        expect(screen.getByText('usua***@gmail.com')).toBeInTheDocument();
        expect(screen.getByText(/Se ha enviado un código de verificación a/)).toBeInTheDocument();
        expect(casillas()).toHaveLength(6);
        expect(casillas()[0]).toHaveAttribute('autocomplete', 'one-time-code');
        expect(casillas()[0]).toHaveAttribute('inputmode', 'numeric');
        expect(casillas()[0]).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Verificar correo' })).toBeDisabled();
        expect(screen.getByText('El código caduca en 10:00.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reenviar código (1:00)' })).toBeDisabled();
    });

    it('solo admite números, avanza solo, retrocede con borrar y acepta pegar el código completo (con espacios)', () => {
        simularFetch({});
        pintarPaso();
        const [c0, c1, c2] = casillas();
        fireEvent.change(c0, { target: { value: 'a' } });
        expect(c0).toHaveValue('');
        fireEvent.change(c0, { target: { value: '4' } });
        expect(c0).toHaveValue('4');
        expect(c1).toHaveFocus();
        fireEvent.change(c1, { target: { value: '8' } });
        expect(c2).toHaveFocus();
        fireEvent.keyDown(c2, { key: 'Backspace' });
        expect(c1).toHaveFocus();
        expect(c1).toHaveValue('');
        pegar(c1, ' 048 213 ');
        expect(casillas().map((c) => c.value).join('')).toBe('048213');
        expect(screen.getByRole('button', { name: 'Verificar correo' })).toBeEnabled();
        // El autocompletado del móvil escribe el código entero en la primera casilla
        pegar(c0, '999999');
        fireEvent.change(casillas()[0], { target: { value: '135790' } });
        expect(casillas().map((c) => c.value).join('')).toBe('135790');
    });

    it('código correcto: una sola petición aunque se pulse dos veces, y la sesión queda cargada en la app', async () => {
        let resolver;
        const f = simularFetch({
            'POST /api/auth/verificar-correo': () => new Promise((ok) => { resolver = () => ok({ json: { usuario: { nombre: 'Ana' } } }); }),
            'GET /api/auth/me': { json: { usuario: { id: 'u1', nombre: 'Ana' } } }
        });
        pintarPaso();
        pegar(casillas()[0], '482913');
        const boton = screen.getByRole('button', { name: 'Verificar correo' });
        fireEvent.click(boton);
        fireEvent.click(boton);
        fireEvent.submit(boton.closest('form'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Verificando…' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Verificando…' })).toHaveAttribute('aria-busy', 'true');
        resolver();
        await waitFor(() => expect(llamadas(f, '/api/auth/me')).toHaveLength(1));
        expect(llamadas(f, '/api/auth/verificar-correo')).toHaveLength(1);
        expect(JSON.parse(llamadas(f, '/api/auth/verificar-correo')[0][1].body)).toEqual({ codigo: '482913' });
        expect(document.getElementById('verif-info')).toHaveTextContent('¡Correo verificado! Entrando en LearnTrack…');
    });

    it('código incorrecto: mensaje del servidor, casillas vacías y foco en la primera; no entra', async () => {
        const f = simularFetch({ 'POST /api/auth/verificar-correo': { status: 400, json: { error: 'Código incorrecto. Te quedan 4 intentos.', codigo: 'incorrecto' } } });
        pintarPaso();
        pegar(casillas()[0], '111111');
        fireEvent.click(screen.getByRole('button', { name: 'Verificar correo' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Código incorrecto. Te quedan 4 intentos.');
        expect(casillas().every((c) => c.value === '')).toBe(true);
        expect(casillas()[0]).toHaveFocus();
        expect(casillas()[0]).toHaveAttribute('aria-invalid', 'true');
        expect(llamadas(f, '/api/auth/me')).toHaveLength(0);
    });

    it('código expirado: lo avisa, desactiva «Verificar» y deja pedir otro', async () => {
        simularFetch({ 'POST /api/auth/verificar-correo': { status: 410, json: { error: 'El código ha expirado. Pide uno nuevo con «Reenviar código».', codigo: 'expirado', verificacion: { ...ESTADO, codigoActivo: false, expiraEnSegundos: 0, reenviarEnSegundos: 0 } } } });
        pintarPaso();
        pegar(casillas()[0], '222222');
        fireEvent.click(screen.getByRole('button', { name: 'Verificar correo' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('El código ha expirado.');
        expect(screen.getByText('El código ha expirado o ya no es válido. Pide uno nuevo.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reenviar código' })).toBeEnabled();
        pegar(casillas()[0], '333333');
        expect(screen.getByRole('button', { name: 'Verificar correo' })).toBeDisabled();
    });

    it('cuenta atrás: caducidad y espera de reenvío bajan cada segundo; al terminar se puede reenviar', () => {
        vi.useFakeTimers();
        simularFetch({});
        pintarPaso({ verificacion: { ...ESTADO, expiraEnSegundos: 3, reenviarEnSegundos: 2 } });
        expect(screen.getByText('El código caduca en 0:03.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reenviar código (0:02)' })).toBeDisabled();
        act(() => { vi.advanceTimersByTime(2000); });
        expect(screen.getByRole('button', { name: 'Reenviar código' })).toBeEnabled();
        act(() => { vi.advanceTimersByTime(1000); });
        expect(screen.getByText('El código ha expirado o ya no es válido. Pide uno nuevo.')).toBeInTheDocument();
    });

    it('reenviar: código nuevo (aviso y nueva espera); si el servidor pide esperar, lo muestra', async () => {
        let n = 0;
        const f = simularFetch({
            'POST /api/auth/reenviar-codigo': () => (++n === 1
                ? { json: { verificacion: { ...ESTADO, reenviarEnSegundos: 60 } } }
                : { status: 429, json: { error: 'Ya te enviamos un código hace un momento. Podrás pedir otro en 45 s.', codigo: 'espera', reenviarEnSegundos: 45 } })
        });
        pintarPaso({ verificacion: { ...ESTADO, reenviarEnSegundos: 0 } });
        fireEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
        expect(await screen.findByText('Te enviamos un código nuevo. El anterior ya no sirve.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reenviar código (1:00)' })).toBeDisabled();
        expect(llamadas(f, '/api/auth/reenviar-codigo')).toHaveLength(1);
    });

    it('verificación caducada en el servidor: vuelve al inicio de sesión con el motivo', async () => {
        const alIrALogin = vi.fn();
        simularFetch({ 'POST /api/auth/verificar-correo': { status: 401, json: { error: 'Esta verificación ya terminó o caducó. Inicia sesión con tu correo y tu contraseña para continuar.', codigo: 'sin_verificacion' } } });
        pintarPaso({ alIrALogin });
        pegar(casillas()[0], '444444');
        fireEvent.click(screen.getByRole('button', { name: 'Verificar correo' }));
        await waitFor(() => expect(alIrALogin).toHaveBeenCalledWith(expect.stringMatching(/ya terminó o caducó/)));
    });
});

describe('flujo en la ventana de acceso', () => {
    const sinSesion = { 'GET /api/auth/me': { json: { usuario: null } } };
    /** Rellena «Crear cuenta» DENTRO de la ventana de acceso (el contacto flotante también tiene «Nombre») */
    async function rellenarRegistro() {
        const dlg = within(await screen.findByRole('dialog', { name: 'Accede a LearnTrack' }));
        fireEvent.change(dlg.getByLabelText('Nombre'), { target: { value: 'Ana' } });
        fireEvent.change(dlg.getByLabelText('Correo electrónico'), { target: { value: 'usuario@gmail.com' } });
        fireEvent.change(dlg.getByLabelText('Contraseña'), { target: { value: 'clave1234' } });
        // v3.13: fecha de nacimiento (mayor de edad) y la casilla de aceptación de los documentos legales
        fireEvent.change(dlg.getByLabelText('Fecha de nacimiento'), { target: { value: '1995-05-20' } });
        fireEvent.click(dlg.getByRole('checkbox', { name: /He leído y acepto/ }));
        fireEvent.click(dlg.getByRole('button', { name: 'Crear cuenta' }));
    }

    it('crear cuenta → /verificar-correo (no entra al panel) → código → /panel, sin recargar', async () => {
        let verificado = false;
        const f = simularFetch({
            'GET /api/auth/me': () => ({ json: { usuario: verificado ? { id: 'u1', nombre: 'Ana' } : null } }),
            'POST /api/auth/registro': { status: 202, json: { verificacion: ESTADO } },
            'POST /api/auth/verificar-correo': () => { verificado = true; return { json: { usuario: { nombre: 'Ana' } } }; }
        });
        pintarApp('/registro');
        await rellenarRegistro();
        expect(await screen.findByRole('heading', { name: 'Verifica tu correo electrónico' })).toBeInTheDocument();
        expect(ubicacion.actual.pathname).toBe('/verificar-correo');
        expect(document.title).toBe('Verifica tu correo | LearnTrack');
        expect(screen.queryByRole('tab')).toBeNull();
        pegar(casillas()[0], '123456');
        fireEvent.click(screen.getByRole('button', { name: 'Verificar correo' }));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/panel'));
        expect(llamadas(f, '/api/auth/registro')).toHaveLength(1);
    });

    it('error del SMTP al registrarse: pasa a la verificación con el error y «Reenviar código» disponible', async () => {
        simularFetch({ ...sinSesion, 'POST /api/auth/registro': { status: 503, json: { error: 'No pudimos enviar el correo con el código.', codigo: 'correo_no_enviado', verificacion: { ...ESTADO, codigoActivo: false, expiraEnSegundos: 0, reenviarEnSegundos: 0 } } } });
        pintarApp('/registro');
        await rellenarRegistro();
        await waitFor(() => expect(document.getElementById('verif-error')).toHaveTextContent('No pudimos enviar el correo con el código.'));
        expect(screen.getByRole('button', { name: 'Reenviar código' })).toBeEnabled();
    });

    it('iniciar sesión con una cuenta sin verificar lleva a la verificación (sin entrar)', async () => {
        simularFetch({ ...sinSesion, 'POST /api/auth/login': { status: 403, json: { error: 'Antes de entrar tienes que verificar tu correo.', codigo: 'verificacion_pendiente', verificacion: ESTADO } } });
        pintarApp('/login');
        fireEvent.change(await screen.findByLabelText('Correo electrónico', { selector: '#login-email' }), { target: { value: 'usuario@gmail.com' } });
        fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave1234' } });
        fireEvent.click(within(document.querySelector('.auth-dialog')).getByRole('button', { name: 'Iniciar sesión' }));
        expect(await screen.findByRole('heading', { name: 'Verifica tu correo electrónico' })).toBeInTheDocument();
        expect(document.getElementById('verif-info')).toHaveTextContent('Tu correo aún no está verificado.');
        expect(ubicacion.actual.pathname).toBe('/verificar-correo');
    });

    it('/verificar-correo (p. ej. tras recargar) retoma la verificación de este navegador; si caducó, vuelve a /login', async () => {
        simularFetch({ ...sinSesion, 'GET /api/auth/verificacion': { json: { verificacion: ESTADO } } });
        const { unmount } = pintarApp('/verificar-correo');
        expect(await screen.findByText('usua***@gmail.com')).toBeInTheDocument();
        unmount();
        simularFetch({ ...sinSesion, 'GET /api/auth/verificacion': { status: 404, json: { error: 'x', codigo: 'sin_verificacion' } } });
        pintarApp('/verificar-correo');
        expect(await screen.findByRole('heading', { name: 'Accede a LearnTrack' })).toBeInTheDocument();
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/login'));
        expect(screen.getByRole('alert')).toHaveTextContent('Tu verificación terminó o caducó.');
    });
});
