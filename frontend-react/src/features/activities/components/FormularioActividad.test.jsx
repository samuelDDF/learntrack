import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { useFormularioActividad } from './FormularioActividad.jsx';
import { simularFetch, pintar } from '../../../pruebas/utilidades.jsx';

function Prueba({ actividad = null, alCambiar }) {
    const f = useFormularioActividad({ alCambiar, proyectos: ['Tesis'] });
    return <><button type="button" onClick={() => f.abrir(actividad, { fecha: '2026-11-02' })}>abrir</button>{f.formulario}</>;
}

describe('Formulario de actividad', () => {
    it('crea con el contrato de la API y avisa con la lista nueva', async () => {
        const f = simularFetch({ 'POST /api/actividades': (c) => ({ json: [{ id: 'n', ...c }] }) });
        const alCambiar = vi.fn();
        pintar(<Prueba alCambiar={alCambiar} />);
        fireEvent.click(screen.getByText('abrir'));
        fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Fútbol' } });
        fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'deporte' } });
        expect(screen.getByLabelText('Exigencia')).toHaveValue('-2');           // ocio/deporte recargan
        fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '08:00' } });
        fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '09:30' } });
        expect(screen.getByLabelText('Horas')).toHaveValue(1.5);
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(alCambiar).toHaveBeenCalled());
        const cuerpo = JSON.parse(f.mock.calls[0][1].body);
        expect(cuerpo).toMatchObject({ titulo: 'Fútbol', tipo: 'deporte', exigencia: -2, horas: 1.5, fecha_inicio: '2026-11-02', fecha_fin: '2026-11-02', hora_inicio: '08:00', hora_fin: '09:30', estado: 'pendiente' });
    });

    it('al editar no envía el estado si no cambió (deja actuar al auto-estado) y valida el título', async () => {
        const f = simularFetch({ 'PUT /api/actividades/a1': { json: [] } });
        const actividad = { id: 'a1', titulo: 'Lectura', tipo: 'estudio', exigencia: 1, horas: 1, estado: 'en_proceso', proyecto: '', fija: false, fecha_inicio: '2026-11-02', fecha_fin: '2026-11-02', hora_inicio: null, hora_fin: null };
        pintar(<Prueba actividad={actividad} alCambiar={() => {}} />);
        fireEvent.click(screen.getByText('abrir'));
        expect(screen.getByRole('heading', { name: 'Editar actividad' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Título'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(screen.getByRole('alert')).toHaveTextContent('El título es obligatorio.');
        fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Lectura cap. 2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(f).toHaveBeenCalled());
        const cuerpo = JSON.parse(f.mock.calls[0][1].body);
        expect(cuerpo.titulo).toBe('Lectura cap. 2');
        expect(cuerpo).not.toHaveProperty('estado');
    });
});
