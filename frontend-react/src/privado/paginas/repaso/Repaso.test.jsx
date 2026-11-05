import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import Repaso, { cuandoRepaso } from './Repaso.jsx';
import { simularFetch, pintar } from '../../../pruebas/utilidades.jsx';
import { hoyISO } from '../../../comun/fechas-locales.js';
import { sumarDias } from '@compartido/fechas.js';

const HOY = hoyISO();
const tema = (id, titulo, repaso) => ({ id, titulo, tipo: 'estudio', proyecto: '', repaso });

describe('Repaso espaciado (interfaz nueva para /api/repaso)', () => {
    it('cuandoRepaso: hoy, mañana, en N días y atrasado', () => {
        expect(cuandoRepaso(HOY, HOY)).toBe('hoy');
        expect(cuandoRepaso(sumarDias(HOY, 1), HOY)).toBe('mañana');
        expect(cuandoRepaso(sumarDias(HOY, 6), HOY)).toBe('en 6 días');
        expect(cuandoRepaso(sumarDias(HOY, -3), HOY)).toBe('hace 3 días (atrasado)');
    });

    it('lista lo pendiente, califica (el cálculo lo hace el servidor) y lo quita de hoy', async () => {
        const pendiente = tema('t1', 'Redes: subnetting', { facilidad: 2.5, intervalo: 0, repeticiones: 0, proximaFecha: HOY, ultimoRepaso: null });
        const f = simularFetch({
            'GET /api/repaso/pendientes': { json: { hoy: HOY, pendientes: 1, actividades: [pendiente] } },
            'GET /api/repaso': { json: { actividades: [pendiente] } },
            'GET /api/actividades': { json: [pendiente, tema('t2', 'Cálculo', null)] },
            'POST /api/repaso/t1/calificar': (c) => ({ json: { calificacion: c.calificacion, resultado: { facilidad: 2.6, intervalo: 1, repeticiones: 1, proximaFecha: sumarDias(HOY, 1) }, actividad: { ...pendiente, repaso: { ...pendiente.repaso, proximaFecha: sumarDias(HOY, 1), repeticiones: 1, intervalo: 1, facilidad: 2.6 } } } })
        });
        pintar(<Repaso />);
        const tarjeta = (await screen.findByRole('heading', { level: 3, name: 'Redes: subnetting' })).closest('li');
        fireEvent.click(within(tarjeta).getByRole('button', { name: /^5: Perfecto/ }));
        expect(await screen.findByText(/Redes: subnetting: 5\/5 → próximo/)).toBeInTheDocument();
        expect(JSON.parse(f.mock.calls.find(([u]) => u === '/api/repaso/t1/calificar')[1].body)).toEqual({ calificacion: 5 });
        expect(screen.getByText('¡Repasos de hoy completados! 🎉')).toBeInTheDocument();
        // Solo se ofrecen para añadir las actividades que aún no están en repaso
        const opciones = within(screen.getByLabelText('Actividad')).getAllByRole('option').map((o) => o.textContent);
        expect(opciones.some((t) => t.startsWith('Cálculo'))).toBe(true);
        expect(opciones.some((t) => t.startsWith('Redes'))).toBe(false);
    });

    it('activar un tema envía la fecha del primer repaso', async () => {
        const f = simularFetch({
            'GET /api/repaso/pendientes': { json: { hoy: HOY, pendientes: 0, actividades: [] } },
            'GET /api/repaso': { json: { actividades: [] } },
            'GET /api/actividades': { json: [tema('t2', 'Cálculo', null)] },
            'POST /api/repaso/t2/activar': (c) => ({ json: { actividad: tema('t2', 'Cálculo', { proximaFecha: c.proximaFecha, facilidad: 2.5, intervalo: 0, repeticiones: 0 }) } })
        });
        pintar(<Repaso />);
        await screen.findByRole('option', { name: /Cálculo/ });
        fireEvent.change(screen.getByLabelText('Actividad'), { target: { value: 't2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Empezar a repasar' }));
        await waitFor(() => expect(f.mock.calls.some(([u]) => u === '/api/repaso/t2/activar')).toBe(true));
        expect(JSON.parse(f.mock.calls.find(([u]) => u === '/api/repaso/t2/activar')[1].body)).toEqual({ proximaFecha: HOY });
        expect(await screen.findByText(/«Cálculo» entra en repaso/)).toBeInTheDocument();
    });
});
