// Sistema de animaciones (v3.8): un solo observador, limpieza al desmontar, nada oculto sin soporte o con
// «reducir movimiento», contadores con el valor REAL en el DOM y esqueletos accesibles.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useAnimarCambio, useRevelar } from './useAnimaciones.js';
import { _reiniciarParaPruebas, animarCambio, iniciarAnimaciones, prefiereMenosMovimiento } from '../utils/animaciones.js';
import { Contador } from '../components/common/Contador.jsx';
import { Esqueleto } from '../components/common/Esqueleto.jsx';

/** IntersectionObserver simulado: registra cuántos se crean y qué observa cada uno */
function simularObservador() {
    const instancias = [];
    class IOFalso {
        constructor(cb, opciones) { this.cb = cb; this.opciones = opciones; this.vistos = new Set(); instancias.push(this); }
        observe(el) { this.vistos.add(el); }
        unobserve(el) { this.vistos.delete(el); }
        disconnect() { this.vistos.clear(); }
        entrar(el) { this.cb([{ target: el, isIntersecting: true }]); }
    }
    vi.stubGlobal('IntersectionObserver', IOFalso);
    return instancias;
}
const simularMovimiento = (reducir) => vi.stubGlobal('matchMedia', (q) => ({
    matches: reducir && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}
}));

function Seccion({ id = 'sec' }) {
    const revelar = useRevelar();
    return <section data-testid={id} ref={revelar} data-revelar="arriba">Contenido</section>;
}

beforeEach(() => { _reiniciarParaPruebas(); document.documentElement.className = ''; });
afterEach(() => { vi.unstubAllGlobals(); _reiniciarParaPruebas(); document.documentElement.className = ''; });

describe('animaciones de entrada', () => {
    it('un único observador para todos los elementos; se revela al entrar en pantalla y deja de observarse', () => {
        const io = simularObservador();
        simularMovimiento(false);
        expect(iniciarAnimaciones()).toBe(true);
        expect(document.documentElement).toHaveClass('lt-js');
        render(<><Seccion id="a" /><Seccion id="b" /></>);
        expect(io).toHaveLength(1);
        const a = screen.getByTestId('a');
        expect(io[0].vistos.size).toBe(2);
        expect(a).not.toHaveClass('lt-visible');
        act(() => io[0].entrar(a));
        expect(a).toHaveClass('lt-visible');
        expect(io[0].vistos.has(a)).toBe(false);             // una vez visible, no se vuelve a vigilar
    });

    it('al desmontar se deja de observar (sin fugas) y un re-render no vuelve a registrar el elemento', () => {
        const io = simularObservador();
        simularMovimiento(false);
        iniciarAnimaciones();
        function Contenedor() {
            const [n, setN] = useState(0);
            const [ver, setVer] = useState(true);
            return <><button type="button" onClick={() => setN(n + 1)}>{`render ${n}`}</button><button type="button" onClick={() => setVer(false)}>quitar</button>{ver ? <Seccion /> : null}</>;
        }
        render(<Contenedor />);
        const observe = vi.spyOn(io[0], 'observe');
        act(() => screen.getByText('render 0').click());
        expect(observe).not.toHaveBeenCalled();               // la referencia es estable
        expect(io[0].vistos.size).toBe(1);
        act(() => screen.getByText('quitar').click());
        expect(io[0].vistos.size).toBe(0);
    });

    it('sin IntersectionObserver no se oculta nada: el contenido queda visible al instante', () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        simularMovimiento(false);
        expect(iniciarAnimaciones()).toBe(false);
        expect(document.documentElement).not.toHaveClass('lt-js');
        render(<Seccion />);
        expect(screen.getByTestId('sec')).toHaveClass('lt-visible');
    });

    it('con «reducir movimiento» no se activa el estado oculto ni las animaciones por JavaScript', () => {
        simularObservador();
        simularMovimiento(true);
        expect(prefiereMenosMovimiento()).toBe(true);
        expect(iniciarAnimaciones()).toBe(false);
        expect(document.documentElement).not.toHaveClass('lt-js');
        const el = document.createElement('div');
        el.animate = vi.fn();
        expect(animarCambio(el, 'adelante')).toBeNull();
        expect(el.animate).not.toHaveBeenCalled();
    });
});

describe('useAnimarCambio', () => {
    it('no anima en el primer render; anima con el tipo calculado al cambiar la clave', () => {
        simularMovimiento(false);
        const animate = vi.fn(() => ({ cancel() {} }));
        function Vista({ mes }) {
            const ref = useAnimarCambio(mes, (antes, ahora) => (ahora > antes ? 'adelante' : 'atras'));
            return <div ref={(el) => { ref.current = el; if (el) el.animate = animate; }}>{mes}</div>;
        }
        const { rerender } = render(<Vista mes="2026-10" />);
        expect(animate).not.toHaveBeenCalled();
        rerender(<Vista mes="2026-11" />);
        expect(animate).toHaveBeenCalledTimes(1);
        expect(animate.mock.calls[0][0][0].transform).toBe('translateX(18px)');     // avanza: entra por la derecha
        rerender(<Vista mes="2026-09" />);
        expect(animate.mock.calls[1][0][0].transform).toBe('translateX(-18px)');
        rerender(<Vista mes="2026-09" />);
        expect(animate).toHaveBeenCalledTimes(2);             // sin cambio de clave, no se repite
    });

    it('sin Web Animations API (jsdom, navegadores antiguos) no falla', () => {
        simularMovimiento(false);
        expect(animarCambio(document.createElement('div'), 'adelante')).toBeNull();
        expect(animarCambio(null, 'adelante')).toBeNull();
    });
});

describe('Contador', () => {
    it('el valor REAL está siempre en el texto (lectores de pantalla, pruebas, copiar)', () => {
        const { container } = render(<strong id="pct"><Contador valor={57} sufijo="%" /></strong>);
        const pct = container.querySelector('#pct');
        expect(pct.textContent).toBe('57%');
        const c = pct.querySelector('.lt-contador');
        expect(c.style.getPropertyValue('--lt-n')).toBe('57');
        expect(c.dataset.sufijo).toBe('%');
    });
    it('valores no enteros se muestran tal cual, sin animar ni redondear', () => {
        const { container } = render(<Contador valor={2.5} sufijo=" h" />);
        expect(container.textContent).toBe('2.5 h');
        expect(container.querySelector('.lt-contador')).toBeNull();
    });
});

describe('Esqueleto', () => {
    it('anuncia la carga a los lectores de pantalla y marca aria-busy', () => {
        render(<Esqueleto texto="Cargando proyectos…" filas={3} />);
        const estado = screen.getByRole('status');
        expect(estado).toHaveAttribute('aria-busy', 'true');
        expect(estado).toHaveTextContent('Cargando proyectos…');
        expect(estado.querySelectorAll('.lt-esqueleto-bloque')).toHaveLength(3);
    });
});
