import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { ChatIA } from './ChatIA.jsx';
import { simularFetch, pintar } from '../../../pruebas/utilidades.jsx';
import { _reiniciarSesion } from '../../../services/sesion.js';

const RUTAS_BASE = {
    'GET /api/auth/me': { json: { usuario: { id: 'u1', nombre: 'Ana', nombreIA: 'Luna' } } },
    'GET /api/ia/capacidades': { json: { archivos: true, formatos: ['.txt', '.pdf'], imagenes: false } }
};

/** Reconocedor de voz simulado: la prueba decide qué «se dijo» */
class ReconocedorFalso {
    static ultimo = null;
    constructor() { ReconocedorFalso.ultimo = this; }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
    decir(texto) { this.onresult?.({ results: [[{ transcript: texto }]] }); }
}

describe('ChatIA', () => {
    beforeEach(() => { _reiniciarSesion(); Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true }); });
    afterEach(() => { delete window.webkitSpeechRecognition; });

    it('se presenta con el nombre del asistente y envía el mensaje con fecha y hora locales', async () => {
        const f = simularFetch({ ...RUTAS_BASE, 'POST /api/ia/chat': { json: { tipo: 'respuesta', mensaje: 'Mañana tienes cálculo.' } } });
        pintar(<ChatIA bienvenida="Escribe algo." />, { usuario: undefined });
        expect(await screen.findByText(/¡Hola! Soy Luna, tu asistente\. Escribe algo\./)).toBeInTheDocument();
        const caja = screen.getByLabelText('Mensaje para el asistente');
        fireEvent.change(caja, { target: { value: '¿Qué tengo mañana?' } });
        fireEvent.keyDown(caja, { key: 'Enter' });
        expect(await screen.findByText('Mañana tienes cálculo.')).toBeInTheDocument();
        const llamada = f.mock.calls.find(([u]) => u === '/api/ia/chat');
        const cuerpo = JSON.parse(llamada[1].body);
        expect(cuerpo.texto).toBe('¿Qué tengo mañana?');
        expect(cuerpo.fechaHoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(cuerpo.horaLocal).toMatch(/^\d{2}:\d{2}$/);
    });

    it('lo que dice el modelo se pinta como TEXTO, nunca como HTML', async () => {
        simularFetch({ ...RUTAS_BASE, 'POST /api/ia/chat': { json: { tipo: 'respuesta', mensaje: '<img src=x onerror="window.__xss=1">hola', avisos: ['<b>ojo</b>'] } } });
        const { container } = pintar(<ChatIA />, { usuario: undefined });
        fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'hola' } });
        fireEvent.submit(container.querySelector('form'));
        expect(await screen.findByText('<img src=x onerror="window.__xss=1">hola')).toBeInTheDocument();
        expect(container.querySelector('.chatia-log img')).toBeNull();
        expect(container.querySelector('.chatia-log b')).toBeNull();
        expect(window.__xss).toBeUndefined();
    });

    it('dictado: escribe lo reconocido en el cuadro de texto (sin innerHTML) y separa conectores', async () => {
        window.webkitSpeechRecognition = ReconocedorFalso;
        simularFetch(RUTAS_BASE);
        const { container } = pintar(<ChatIA />, { usuario: undefined });
        const mic = screen.getByRole('button', { name: 'Dictar por voz' });
        expect(mic).not.toBeDisabled();
        fireEvent.click(mic);
        expect(screen.getByRole('button', { name: 'Detener dictado' })).toHaveAttribute('aria-pressed', 'true');
        act(() => ReconocedorFalso.ultimo.decir('mañana estudio y luego entreno <script>x</script>'));
        expect(screen.getByLabelText('Mensaje para el asistente')).toHaveValue('mañana estudio, luego entreno <script>x</script>');
        expect(container.querySelector('script')).toBeNull();
        act(() => ReconocedorFalso.ultimo.stop());
        expect(screen.getByText('✓ Dictado listo: revisa el texto y pulsa Enviar.')).toBeInTheDocument();
    });

    it('sin reconocimiento de voz el micrófono queda desactivado con una explicación', async () => {
        simularFetch(RUTAS_BASE);
        pintar(<ChatIA />, { usuario: undefined });
        expect(screen.getByRole('button', { name: 'Dictado por voz no disponible en este navegador' })).toBeDisabled();
        expect(screen.getByText('🎤 El dictado por voz no está disponible en este navegador.')).toBeInTheDocument();
    });

    it('propuesta: muestra los cambios y Aplicar llama a la API; luego ofrece Deshacer', async () => {
        const alActualizar = vi.fn();
        const propuesta = {
            id: 'a'.repeat(32), tipo: 'liberar', titulo: 'Liberar el viernes', expira: new Date(Date.now() + 600000).toISOString(), seleccionable: false,
            items: [{ idx: 0, op: 'mover', titulo: 'Taller', detalle: 'vie → lun', motivo: 'Cabe el lunes', marcado: true }],
            cargas: [{ etiqueta: 'vie', antes: 90, despues: 30, nivelAntes: 'rojo', nivelDespues: 'verde' }]
        };
        const f = simularFetch({
            ...RUTAS_BASE,
            'POST /api/ia/chat': { json: { tipo: 'propuesta', mensaje: 'Te propongo esto.', propuesta } },
            [`POST /api/propuestas/${propuesta.id}/aplicar`]: { json: { tipo: 'aplicado', mensaje: 'Listo', loteId: 'b'.repeat(24), actividades: [{ id: 'x' }] } }
        });
        const { container } = pintar(<ChatIA alActualizar={alActualizar} />, { usuario: undefined });
        fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'libera mi viernes' } });
        fireEvent.submit(container.querySelector('form'));
        const tarjeta = await screen.findByRole('article', { name: 'Propuesta: Liberar el viernes' });
        expect(within(tarjeta).getByText('90 %')).toHaveClass('nivel-rojo');
        fireEvent.click(within(tarjeta).getByRole('button', { name: 'Aplicar' }));
        expect(await within(tarjeta).findByText('✓ Aplicada')).toBeInTheDocument();
        expect(within(tarjeta).getByRole('button', { name: '↩ Deshacer' })).toBeInTheDocument();
        expect(alActualizar).toHaveBeenCalledWith([{ id: 'x' }]);
        expect(f.mock.calls.some(([u]) => u === `/api/propuestas/${propuesta.id}/aplicar`)).toBe(true);
    });

    it('aclaración: elegir una opción responde con aclaracionId y respuestas', async () => {
        const f = simularFetch({
            ...RUTAS_BASE,
            'POST /api/ia/chat': (cuerpo) => (cuerpo.aclaracionId
                ? { json: { tipo: 'aplicado', mensaje: 'Agendé a las 15:00', loteId: 'c'.repeat(24) } }
                : { json: { tipo: 'aclaracion', mensaje: '¿A qué hora?', aclaracion: { id: 'd'.repeat(32), preguntas: [{ id: 'hora', texto: '¿A qué hora?', opciones: [{ etiqueta: '15:00', valor: '15:00' }, { etiqueta: '17:00', valor: '17:00' }] }] } } })
        });
        const { container } = pintar(<ChatIA />, { usuario: undefined });
        fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'mañana estudio' } });
        fireEvent.submit(container.querySelector('form'));
        fireEvent.click(await screen.findByRole('button', { name: '15:00' }));
        expect(await screen.findByText('Agendé a las 15:00')).toBeInTheDocument();
        const ultima = JSON.parse(f.mock.calls.filter(([u]) => u === '/api/ia/chat').at(-1)[1].body);
        expect(ultima.aclaracionId).toBe('d'.repeat(32));
        expect(ultima.respuestas).toEqual({ hora: '15:00' });
    });

    it('un error del servidor se muestra como burbuja de error', async () => {
        simularFetch({ ...RUTAS_BASE, 'POST /api/ia/chat': { status: 503, json: { error: 'El asistente de IA no está disponible ahora mismo.' } } });
        const { container } = pintar(<ChatIA />, { usuario: undefined });
        fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'hola' } });
        fireEvent.submit(container.querySelector('form'));
        await waitFor(() => expect(container.querySelector('.msg.error')).toHaveTextContent('El asistente de IA no está disponible ahora mismo.'));
    });

    it('archivo + mensaje viajan juntos (multipart) y se rechazan formatos no admitidos', async () => {
        const f = simularFetch({ ...RUTAS_BASE, 'POST /api/ia/archivo': { json: { tipo: 'aplicado', mensaje: '📥 Añadí 1 elemento', loteId: 'e'.repeat(24) } } });
        const { container } = pintar(<ChatIA />, { usuario: undefined });
        await waitFor(() => expect(container.querySelector('input[type="file"]').accept).toBe('.txt,.pdf'));
        const input = container.querySelector('input[type="file"]');
        fireEvent.change(input, { target: { files: [new File(['x'], 'malo.exe')] } });
        expect(await screen.findByText(/No puedo leer «malo\.exe»/)).toBeInTheDocument();
        fireEvent.change(input, { target: { files: [new File(['Parcial el 3 de noviembre'], 'plan.txt', { type: 'text/plain' })] } });
        fireEvent.change(screen.getByLabelText('Mensaje para el asistente'), { target: { value: 'son de Redes' } });
        fireEvent.submit(container.querySelector('form'));
        expect(await screen.findByText('📥 Añadí 1 elemento')).toBeInTheDocument();
        const [, init] = f.mock.calls.find(([u]) => u === '/api/ia/archivo');
        expect(init.body).toBeInstanceOf(FormData);
        expect(init.body.get('instruccion')).toBe('son de Redes');
        expect(init.body.get('archivo').name).toBe('plan.txt');
    });
});
