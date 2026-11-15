// Enrutador central (v3.11): páginas nuevas a partir de piezas existentes (/perfil, /bienestar), direcciones antiguas
// de Configuración y navegación entre páginas privadas sin recargar.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { pintarApp, simularFetch, ubicacion } from '../pruebas/utilidades.jsx';

const ANA = { id: 'u1', nombre: 'Ana López', email: 'ana@prueba.co' };
const PERFIL = {
    perfil: { ...ANA, temaSeleccionado: 'tech-focus', variablesTema: null, imagenFondoUrl: null, avatarUrl: null, vozAsistente: '', nombreIA: 'Nexo', notificacionesActivas: true, preferenciasNotificaciones: {}, integraciones: {} },
    integraciones: { modo: 'simulado', servicios: [] }
};
const pestanas = () => within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent);

describe('Mi perfil y Configuración (dos páginas con pestañas)', () => {
    it('/perfil: Información básica y Privacidad y seguridad', async () => {
        simularFetch({ 'GET /api/perfil': { json: PERFIL } });
        pintarApp('/perfil', { usuario: ANA });
        expect(await screen.findByRole('heading', { level: 1, name: 'Mi perfil' })).toBeInTheDocument();
        expect(pestanas()).toEqual(['👤Información básica', '🔒Privacidad y seguridad']);
        expect(await screen.findByRole('heading', { level: 2, name: 'Información básica' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /Privacidad/ }));
        expect(await screen.findByRole('heading', { level: 2, name: 'Privacidad y seguridad' })).toBeInTheDocument();
        expect(ubicacion.actual.hash).toBe('#privacidad');
        await waitFor(() => expect(document.title).toBe('Mi perfil | LearnTrack'));
    });

    it('/configuracion: Voz, Estética, Cuentas vinculadas y Notificaciones', async () => {
        simularFetch({ 'GET /api/perfil': { json: PERFIL } });
        pintarApp('/configuracion#estetica', { usuario: ANA });
        expect(await screen.findByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument();
        expect(pestanas()).toEqual(['🗣️Voz de la IA', '🎨Estética de la página', '🔗Cuentas vinculadas', '🔔Notificaciones']);
        expect(screen.getByRole('tab', { name: /Estética/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('direcciones antiguas: /configuracion#informacion y #perfil llevan a /perfil; #apariencia a #estetica', async () => {
        simularFetch({ 'GET /api/perfil': { json: PERFIL } });
        const { unmount } = pintarApp('/configuracion#informacion', { usuario: ANA });
        await waitFor(() => expect(`${ubicacion.actual.pathname}${ubicacion.actual.hash}`).toBe('/perfil#informacion'));
        expect(await screen.findByRole('heading', { level: 1, name: 'Mi perfil' })).toBeInTheDocument();
        unmount();
        const otra = pintarApp('/configuracion#perfil', { usuario: ANA });
        await waitFor(() => expect(`${ubicacion.actual.pathname}${ubicacion.actual.hash}`).toBe('/perfil#informacion'));
        otra.unmount();
        pintarApp('/configuracion#apariencia', { usuario: ANA });
        await waitFor(() => expect(screen.getByRole('tab', { name: /Estética/ })).toHaveAttribute('aria-selected', 'true'));
    });
});

describe('Bienestar (/bienestar)', () => {
    const HOY = new Date();
    const fecha = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, '0')}-${String(HOY.getDate()).padStart(2, '0')}`;

    it('sin check-in hoy: la ventana del check-in se abre (obligatoria); al guardarlo se ve el resumen y la carga', async () => {
        const f = simularFetch({
            'GET /api/actividades': { json: [] },
            'GET /api/historial': { json: { '2026-10-01': 40 } },
            [`GET /api/checkin?fecha=${fecha}`]: { json: { checkin: null } },
            'PUT /api/checkin': (cuerpo) => ({ json: { checkin: cuerpo } })
        });
        pintarApp('/bienestar', { usuario: ANA });
        expect(await screen.findByRole('heading', { level: 1, name: 'Bienestar' })).toBeInTheDocument();
        const dialogo = await screen.findByRole('dialog', { name: 'Check-in Diario' });
        fireEvent.change(within(dialogo).getByLabelText(/emocionalmente/), { target: { value: 'bajo' } });
        fireEvent.change(within(dialogo).getByLabelText(/dormiste/), { target: { value: 'bien' } });
        fireEvent.change(within(dialogo).getByLabelText(/objetivo mental/), { target: { value: 'descansar' } });
        fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar y Continuar' }));
        // (margen amplio: la primera vez Vitest transforma al vuelo las piezas que la página carga de forma diferida)
        await waitFor(() => expect(document.getElementById('checkin-resumen')).toBeTruthy(), { timeout: 3000 });
        expect(screen.getByText('Cansado / Saturado / Estresado')).toBeInTheDocument();
        expect(JSON.parse(f.mock.calls.find(([u, i]) => u === '/api/checkin' && i.method === 'PUT')[1].body)).toMatchObject({ fecha, animo: 'bajo', sueno: 'bien', enfoque: 'descansar' });
        expect(screen.getByText('🟢 Estado Equilibrado')).toBeInTheDocument();
        expect(document.getElementById('porcentaje-carga')).toHaveTextContent('0%');
        expect(screen.getByRole('link', { name: 'Bienestar' })).toHaveAttribute('aria-current', 'page');
    });
});

describe('navegación privada sin recargar', () => {
    it('del panel a la papelera (enlace) y de vuelta con «Volver»', async () => {
        simularFetch({
            'GET /api/actividades': { json: [] },
            'GET /api/historial': { json: {} },
            'GET /api/papelera': { json: { dias: 30, actividades: [] } }
        });
        pintarApp('/panel', { usuario: ANA });
        const enlace = await screen.findByRole('link', { name: '🗑 Papelera' });
        fireEvent.click(enlace);
        expect(await screen.findByRole('heading', { level: 1, name: '🗑 Papelera' })).toBeInTheDocument();
        expect(ubicacion.actual.pathname).toBe('/papelera');
        fireEvent.click(screen.getByRole('link', { name: '← Volver a mi panel' }));
        await waitFor(() => expect(ubicacion.actual.pathname).toBe('/panel'));
        expect(await screen.findByRole('heading', { level: 1, name: /Hola Ana López/ })).toBeInTheDocument();
    });
});
