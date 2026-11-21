// v3.13 · Registro con aceptación de documentos y edad, páginas legales, pantallas de cuenta pendiente,
// autorización del representante y guardia del panel de administración (en el navegador; el servidor tiene sus pruebas).
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { pintarApp, simularFetch, ubicacion } from '../../pruebas/utilidades.jsx';
import { VERSIONES_VIGENTES, TERMINOS, PRIVACIDAD } from '@compartido/legal.js';
import { hoyISO } from '../../utils/fechas.js';

const sinSesion = { 'GET /api/auth/me': { json: { usuario: null } } };
const ESTADO = { email: 'u***@gmail.com', codigoActivo: true, expiraEnSegundos: 600, reenviarEnSegundos: 60, intentosRestantes: 5 };
const llamadas = (f, url) => f.mock.calls.filter(([u]) => String(u).split('?')[0] === url);
const cuerpo = (f, url) => JSON.parse(llamadas(f, url).at(-1)[1].body);
const haceAnios = (n) => { const [a, m, d] = hoyISO().split('-'); return `${Number(a) - n}-${m}-${d === '29' && m === '02' ? '28' : d}`; };

async function rellenar({ nacimiento = '1995-05-20', aceptar = true } = {}) {
    const dlg = within(await screen.findByRole('dialog', { name: 'Accede a LearnTrack' }));
    fireEvent.change(dlg.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(dlg.getByLabelText('Correo electrónico', { selector: '#registro-email' }), { target: { value: 'ana@gmail.com' } });
    fireEvent.change(dlg.getByLabelText('Contraseña'), { target: { value: 'clave1234' } });
    fireEvent.change(dlg.getByLabelText('Fecha de nacimiento'), { target: { value: nacimiento } });
    if (aceptar) fireEvent.click(dlg.getByRole('checkbox', { name: /He leído y acepto/ }));
    return dlg;
}

describe('registro: aceptación de los documentos legales y edad', () => {
    it('la casilla empieza DESMARCADA, enlaza a /terminos y /privacidad, y sin marcarla no se envía nada', async () => {
        const f = simularFetch(sinSesion);
        pintarApp('/registro');
        const dlg = await rellenar({ aceptar: false });
        const casilla = dlg.getByRole('checkbox', { name: /He leído y acepto los Términos y Condiciones y la Política de Tratamiento de Datos Personales de LearnTrack/ });
        expect(casilla).not.toBeChecked();
        expect(dlg.getByRole('link', { name: 'Términos y Condiciones' })).toHaveAttribute('href', '/terminos');
        expect(dlg.getByRole('link', { name: 'Política de Tratamiento de Datos Personales' })).toHaveAttribute('href', '/privacidad');
        expect(dlg.getByRole('link', { name: 'Términos y Condiciones' })).toHaveAttribute('target', '_blank');
        fireEvent.click(dlg.getByRole('button', { name: 'Crear cuenta' }));
        expect(dlg.getByRole('alert')).toHaveTextContent(/debes aceptar los Términos y Condiciones/);
        expect(casilla).toHaveFocus();
        expect(llamadas(f, '/api/auth/registro')).toHaveLength(0);
    });

    it('al aceptar se envían la aceptación, las versiones vigentes y la fecha de nacimiento', async () => {
        const f = simularFetch({ ...sinSesion, 'POST /api/auth/registro': { status: 202, json: { verificacion: ESTADO } } });
        pintarApp('/registro');
        const dlg = await rellenar();
        fireEvent.click(dlg.getByRole('button', { name: 'Crear cuenta' }));
        await waitFor(() => expect(llamadas(f, '/api/auth/registro')).toHaveLength(1));
        expect(cuerpo(f, '/api/auth/registro')).toMatchObject({ nombre: 'Ana', aceptaDocumentos: true, versiones: VERSIONES_VIGENTES, fechaNacimiento: '1995-05-20' });
        expect(cuerpo(f, '/api/auth/registro').representante).toBeUndefined();
    });

    it('menos de 14 años: no se envía; de 14 a 17 pide los datos del representante y los envía', async () => {
        const f = simularFetch({ ...sinSesion, 'POST /api/auth/registro': { status: 202, json: { verificacion: ESTADO } } });
        pintarApp('/registro');
        let dlg = await rellenar({ nacimiento: haceAnios(12) });
        expect(dlg.getByText(/LearnTrack es para personas de 14 años o más/)).toBeInTheDocument();
        fireEvent.click(dlg.getByRole('button', { name: 'Crear cuenta' }));
        expect(dlg.getByRole('alert')).toHaveTextContent('al menos 14 años');
        expect(llamadas(f, '/api/auth/registro')).toHaveLength(0);

        fireEvent.change(dlg.getByLabelText('Fecha de nacimiento'), { target: { value: haceAnios(15) } });
        dlg = within(await screen.findByRole('dialog', { name: 'Accede a LearnTrack' }));
        expect(dlg.getByRole('group', { name: 'Tu madre, padre o representante legal' })).toBeInTheDocument();
        fireEvent.click(dlg.getByRole('button', { name: 'Crear cuenta' }));
        expect(dlg.getByRole('alert')).toHaveTextContent('Completa todos los campos');     // faltan los del representante
        fireEvent.change(dlg.getByLabelText('Nombre completo'), { target: { value: 'Marta Gómez' } });
        fireEvent.change(document.getElementById('registro-rep-email'), { target: { value: 'marta@gmail.com' } });
        fireEvent.change(dlg.getByLabelText('Parentesco'), { target: { value: 'madre' } });
        fireEvent.click(dlg.getByRole('button', { name: 'Crear cuenta' }));
        await waitFor(() => expect(llamadas(f, '/api/auth/registro')).toHaveLength(1));
        expect(cuerpo(f, '/api/auth/registro').representante).toEqual({ nombre: 'Marta Gómez', email: 'marta@gmail.com', parentesco: 'madre' });
    });
});

describe('páginas legales', () => {
    it('/terminos muestra las 16 secciones, la versión y resalta los datos pendientes', async () => {
        simularFetch(sinSesion);
        pintarApp('/terminos');
        expect(await screen.findByRole('heading', { level: 1, name: TERMINOS.titulo })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(16);
        expect(screen.getByText(new RegExp(`Versión ${TERMINOS.version}`))).toBeInTheDocument();
        expect(document.querySelectorAll('mark.legal-pendiente').length).toBeGreaterThan(1);
        expect(document.title).toBe('Términos y Condiciones | LearnTrack');
    });

    it('/privacidad muestra la política completa y el pie enlaza a ambos documentos', async () => {
        simularFetch(sinSesion);
        pintarApp('/privacidad');
        expect(await screen.findByRole('heading', { level: 1, name: PRIVACIDAD.titulo })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(PRIVACIDAD.secciones.length);
        const pie = within(document.querySelector('footer'));
        expect(pie.getByRole('link', { name: 'Términos y Condiciones' })).toHaveAttribute('href', '/terminos');
        expect(pie.getByRole('link', { name: 'Política de Tratamiento de Datos' })).toHaveAttribute('href', '/privacidad');
    });
});

describe('cuenta pendiente y administración (guardias del navegador)', () => {
    const conUsuario = (usuario, extra = {}) => simularFetch({ 'GET /api/auth/me': { json: { usuario } }, ...extra });

    it('versión nueva de los documentos: en lugar de la zona privada se pide aceptarla', async () => {
        let aceptado = false;
        const f = simularFetch({
            'GET /api/auth/me': () => ({ json: { usuario: aceptado ? { id: 'u', nombre: 'Ana' } : { id: 'u', nombre: 'Ana', documentosPendientes: { documentos: ['terminos'], versiones: VERSIONES_VIGENTES } } } }),
            'POST /api/auth/aceptar-documentos': () => { aceptado = true; return { json: { ok: true } }; }
        });
        pintarApp('/panel');
        expect(await screen.findByRole('heading', { name: 'Actualizamos nuestros documentos' })).toBeInTheDocument();
        const boton = screen.getByRole('button', { name: 'Aceptar y continuar' });
        expect(boton).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', { name: /He leído y acepto/ }));
        fireEvent.click(boton);
        await waitFor(() => expect(llamadas(f, '/api/auth/aceptar-documentos')).toHaveLength(1));
        expect(cuerpo(f, '/api/auth/aceptar-documentos')).toEqual({ acepto: true, versiones: VERSIONES_VIGENTES });
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Actualizamos nuestros documentos' })).toBeNull());
    });

    it('menor sin autorización: pantalla de espera con el correo del representante oculto y reenviar', async () => {
        conUsuario({ id: 'u', nombre: 'Leo', representante: { estado: 'pendiente', parentesco: 'madre', correo: 'm***@g***.com', enviado: true, reenviable: false } });
        pintarApp('/calendario');
        expect(await screen.findByRole('heading', { name: 'Falta la autorización de tu representante' })).toBeInTheDocument();
        expect(screen.getByText('m***@g***.com')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reenviar el correo' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Eliminar mi cuenta' })).toBeEnabled();
    });

    it('la cuenta de administración no entra en la zona privada: va a /admin', async () => {
        conUsuario({ id: 'a', nombre: 'Administración', esAdmin: true }, {
            'GET /api/admin/resumen': { json: { total: 0, suspendidas: 0, sinVerificar: 0, menoresPendientes: 0, nuevas7d: 0, activas7d: 0, integridad: { administradores: 1, unico: true, indiceUnico: true } } },
            'GET /api/admin/cuentas': { json: { total: 0, pagina: 1, porPagina: 25, cuentas: [] } }
        });
        pintarApp('/panel');
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/admin'));
        expect(await screen.findByRole('heading', { name: 'Panel de administración' })).toBeInTheDocument();
    });

    it('/admin a una cuenta normal (o sin sesión) se ve como una página inexistente', async () => {
        const f = conUsuario({ id: 'u', nombre: 'Ana' });
        pintarApp('/admin');
        expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument();
        expect(f.mock.calls.some(([u]) => String(u).startsWith('/api/admin'))).toBe(false);
    });
});

describe('autorización del representante (enlace del correo)', () => {
    const TOKEN = 'A'.repeat(43);
    it('lee el token del fragmento, lo quita de la dirección y autoriza solo con la casilla marcada', async () => {
        const f = simularFetch({
            ...sinSesion,
            'POST /api/auth/representante/consultar': { json: { menor: { nombre: 'Leo' }, representante: { nombre: 'Marta', parentesco: 'madre' }, versiones: VERSIONES_VIGENTES } },
            'POST /api/auth/representante/decidir': { json: { decision: 'autorizar', mensaje: 'Gracias. Autorizaste a Leo a usar LearnTrack.' } }
        });
        pintarApp(`/autorizacion-representante#t=${TOKEN}`);
        expect(await screen.findByText('Leo')).toBeInTheDocument();
        expect(ubicacion.actual.hash).toBe('');
        expect(cuerpo(f, '/api/auth/representante/consultar')).toEqual({ token: TOKEN });
        const autorizar = screen.getByRole('button', { name: 'Autorizar la cuenta' });
        expect(autorizar).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(autorizar);
        expect(await screen.findByText('Gracias. Autorizaste a Leo a usar LearnTrack.')).toBeInTheDocument();
        expect(cuerpo(f, '/api/auth/representante/decidir')).toEqual({ token: TOKEN, decision: 'autorizar', acepto: true, versiones: VERSIONES_VIGENTES });
    });

    it('«No autorizo» pide confirmación antes de eliminar la cuenta', async () => {
        const f = simularFetch({
            ...sinSesion,
            'POST /api/auth/representante/consultar': { json: { menor: { nombre: 'Leo' }, representante: { nombre: 'Marta', parentesco: 'madre' }, versiones: VERSIONES_VIGENTES } },
            'POST /api/auth/representante/decidir': { json: { decision: 'rechazar', mensaje: 'Entendido.' } }
        });
        pintarApp(`/autorizacion-representante#t=${TOKEN}`);
        fireEvent.click(await screen.findByRole('button', { name: 'No autorizo' }));
        expect(llamadas(f, '/api/auth/representante/decidir')).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: 'Sí, no autorizo' }));
        expect(await screen.findByText('Entendido.')).toBeInTheDocument();
        expect(cuerpo(f, '/api/auth/representante/decidir')).toEqual({ token: TOKEN, decision: 'rechazar' });
    });

    it('sin token válido no consulta nada', async () => {
        const f = simularFetch(sinSesion);
        pintarApp('/autorizacion-representante');
        expect(await screen.findByText(/no es válido o ya caducó/)).toBeInTheDocument();
        expect(llamadas(f, '/api/auth/representante/consultar')).toHaveLength(0);
    });
});
