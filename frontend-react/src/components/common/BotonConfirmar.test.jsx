import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BotonConfirmar } from './BotonConfirmar.jsx';

describe('BotonConfirmar (acciones destructivas en dos clics)', () => {
    it('el primer clic pide confirmación y el segundo ejecuta', async () => {
        const alConfirmar = vi.fn();
        render(<BotonConfirmar alConfirmar={alConfirmar} aria-label="Eliminar Lectura">Eliminar</BotonConfirmar>);
        const b = screen.getByRole('button', { name: 'Eliminar Lectura' });
        fireEvent.click(b);
        expect(alConfirmar).not.toHaveBeenCalled();
        expect(b).toHaveTextContent('¿Seguro?');
        expect(b).toHaveAccessibleName(/Pulsa otra vez para confirmar: Eliminar Lectura/);
        await act(async () => { fireEvent.click(b); });
        expect(alConfirmar).toHaveBeenCalledTimes(1);
    });
    it('si no se confirma a tiempo vuelve a su estado', () => {
        vi.useFakeTimers();
        render(<BotonConfirmar alConfirmar={() => {}} ms={1000}>Quitar</BotonConfirmar>);
        fireEvent.click(screen.getByRole('button'));
        act(() => { vi.advanceTimersByTime(1100); });
        expect(screen.getByRole('button')).toHaveTextContent('Quitar');
        vi.useRealTimers();
    });
});
