// Papelera v3.9: selección (una, varias, todas), restaurar y eliminar para siempre lo seleccionado, «Vaciar papelera»
// independiente de la selección, confirmaciones, sin peticiones dobles y sin cerrar la papelera al cerrar la confirmación.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Papelera } from './Papelera.jsx';
import { pintar, simularFetch } from '../../pruebas/utilidades.jsx';

const act = (id, titulo) => ({ id, titulo, tipo: 'estudio', exigencia: 2, horas: 1, fecha_inicio: '2026-10-07', fecha_fin: '2026-10-07', hora_inicio: null, hora_fin: null, estado: 'pendiente', eliminadaEn: '2026-10-30T15:00:00.000Z' });
const TRES = [act('a1', 'Lectura'), act('b2', 'Taller'), act('c3', 'Ensayo')];

function abrir({ actividades = TRES, rutas = {}, alCerrar = vi.fn(), alRestaurar = vi.fn() } = {}) {
    const fetch = simularFetch({ 'GET /api/papelera': { json: { dias: 30, actividades } }, ...rutas });
    pintar(<Papelera abierta alCerrar={alCerrar} alRestaurar={alRestaurar} />);
    return { fetch, alCerrar, alRestaurar, usuario: userEvent.setup() };
}
const casilla = (titulo) => screen.getByRole('checkbox', { name: new RegExp(titulo) });
/** El resultado se muestra DENTRO de la papelera (el aviso flotante queda detrás de la ventana modal) */
const verEstado = (texto) => waitFor(() => expect(document.getElementById('papelera-estado')).toHaveTextContent(texto));
const llamadas = (fetch, metodo, ruta) => fetch.mock.calls.filter(([url, init = {}]) => String(url) === ruta && (init.method ?? 'GET') === metodo);

describe('selección', () => {
    it('sin selección: Restaurar/Eliminar ocultos; «Vaciar papelera» visible y activo', async () => {
        abrir();
        await screen.findByText('Lectura');
        expect(screen.queryByRole('button', { name: /Restaurar \(/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Eliminar permanentemente/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Vaciar papelera' })).toBeEnabled();
    });

    it('una, varias, deseleccionar y cancelar: contador, marcas visuales y acciones', async () => {
        const { usuario } = abrir();
        await screen.findByText('Lectura');
        await usuario.click(casilla('Lectura'));
        expect(screen.getByText('1 seleccionada')).toBeInTheDocument();
        expect(casilla('Lectura').closest('li')).toHaveClass('seleccionada');
        expect(screen.getByRole('button', { name: '♻ Restaurar (1)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Eliminar permanentemente (1)' })).toBeInTheDocument();
        await usuario.click(screen.getByText('Taller'));                // la etiqueta también selecciona
        expect(screen.getByText('2 seleccionadas')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Eliminar permanentemente (2)' })).toBeInTheDocument();
        await usuario.click(casilla('Lectura'));
        expect(screen.getByText('1 seleccionada')).toBeInTheDocument();
        expect(casilla('Lectura').closest('li')).not.toHaveClass('seleccionada');
        await usuario.click(screen.getByRole('button', { name: 'Cancelar selección' }));
        expect(screen.queryByRole('button', { name: /Restaurar \(/ })).toBeNull();
        expect(screen.getAllByRole('checkbox').every((c) => !c.checked)).toBe(true);
    });

    it('«Seleccionar todas» marca y desmarca todo (estado mixto con selección parcial)', async () => {
        const { usuario } = abrir();
        await screen.findByText('Lectura');
        await usuario.click(casilla('Lectura'));
        expect(screen.getByLabelText('Seleccionar todas').indeterminate).toBe(true);
        await usuario.click(screen.getByLabelText('Seleccionar todas'));
        expect(screen.getByText('3 seleccionadas')).toBeInTheDocument();
        expect(screen.getByLabelText('Seleccionar todas')).toBeChecked();
        await usuario.click(screen.getByLabelText('Seleccionar todas'));
        expect(screen.queryByText(/seleccionadas?$/)).toBeNull();
    });
});

describe('acciones', () => {
    it('restaurar la selección: una sola petición con los ids, se actualiza la lista y se limpia la selección', async () => {
        const nuevas = [act('a1', 'Lectura'), act('c3', 'Ensayo')].map(({ eliminadaEn, ...x }) => x);
        const { fetch, usuario, alRestaurar } = abrir({ rutas: { 'POST /api/papelera/restaurar': (cuerpo) => ({ json: { restauradas: nuevas.filter((a) => cuerpo.ids.includes(a.id)), actividades: nuevas, avisos: [] } }) } });
        await screen.findByText('Lectura');
        await usuario.click(casilla('Lectura'));
        await usuario.click(casilla('Ensayo'));
        await usuario.click(screen.getByRole('button', { name: '♻ Restaurar (2)' }));
        await verEstado('♻ 2 actividades restauradas.');
        const [[, init]] = llamadas(fetch, 'POST', '/api/papelera/restaurar');
        expect(JSON.parse(init.body).ids.sort()).toEqual(['a1', 'c3']);
        expect(alRestaurar).toHaveBeenCalledWith(nuevas);
        expect(screen.queryByText('Lectura')).toBeNull();
        expect(screen.getByText('Taller')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Restaurar \(/ })).toBeNull();
    });

    it('eliminar para siempre: la confirmación dice cuántas; Cancelar no borra; confirmar borra solo lo seleccionado', async () => {
        const { fetch, usuario, alCerrar } = abrir({ rutas: { 'DELETE /api/papelera/seleccion': (cuerpo) => ({ json: { eliminadas: cuerpo.ids.length } }) } });
        await screen.findByText('Lectura');
        await usuario.click(casilla('Lectura'));
        await usuario.click(casilla('Taller'));
        await usuario.click(screen.getByRole('button', { name: 'Eliminar permanentemente (2)' }));
        const ventana = screen.getByRole('alertdialog');
        expect(ventana).toHaveTextContent('Se eliminarán para siempre 2 actividades de la papelera. Esta acción no se puede deshacer.');
        expect(within(ventana).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
        await usuario.click(within(ventana).getByRole('button', { name: 'Cancelar' }));
        expect(llamadas(fetch, 'DELETE', '/api/papelera/seleccion')).toHaveLength(0);
        expect(alCerrar).not.toHaveBeenCalled();                 // cerrar la confirmación NO cierra la papelera
        expect(screen.getByText('2 seleccionadas')).toBeInTheDocument();
        await usuario.click(screen.getByRole('button', { name: 'Eliminar permanentemente (2)' }));
        await usuario.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar 2 actividades' }));
        await verEstado('🗑 2 actividades eliminadas para siempre.');
        const [[, init]] = llamadas(fetch, 'DELETE', '/api/papelera/seleccion');
        expect(JSON.parse(init.body).ids.sort()).toEqual(['a1', 'b2']);
        expect(screen.queryByText('Lectura')).toBeNull();
        expect(screen.getByText('Ensayo')).toBeInTheDocument();
        expect(screen.queryByText(/seleccionadas?$/)).toBeNull();
        expect(alCerrar).not.toHaveBeenCalled();
    });

    it('vaciar: funciona con o sin selección, confirma que es TODO, informa la cantidad y queda deshabilitado', async () => {
        const { fetch, usuario } = abrir({ rutas: { 'DELETE /api/papelera': { json: { eliminadas: 3 } } } });
        await screen.findByText('Lectura');
        await usuario.click(casilla('Taller'));                  // hay una seleccionada: da igual
        await usuario.click(screen.getByRole('button', { name: 'Vaciar papelera' }));
        const ventana = screen.getByRole('alertdialog');
        expect(ventana).toHaveTextContent('TODAS las actividades de la papelera (3 actividades), estén seleccionadas o no');
        expect(ventana).toHaveTextContent('no se puede deshacer');
        await usuario.click(within(ventana).getByRole('button', { name: 'Vaciar papelera' }));
        await verEstado('🗑 Papelera vaciada: se eliminaron 3 actividades para siempre.');
        expect(llamadas(fetch, 'DELETE', '/api/papelera')).toHaveLength(1);
        expect(screen.getByText('La papelera está vacía.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Vaciar papelera' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Restaurar \(/ })).toBeNull();
    });

    it('con la papelera vacía, «Vaciar papelera» sigue visible pero deshabilitado', async () => {
        abrir({ actividades: [] });
        await screen.findByText('La papelera está vacía.');
        expect(screen.getByRole('button', { name: 'Vaciar papelera' })).toBeDisabled();
    });

    it('mientras se vacía no se pueden lanzar otras operaciones ni repetirla (sin peticiones dobles)', async () => {
        let terminar;
        const { fetch, usuario } = abrir({ rutas: { 'DELETE /api/papelera': () => new Promise((ok) => { terminar = () => ok({ json: { eliminadas: 3 } }); }) } });
        await screen.findByText('Lectura');
        await usuario.click(screen.getByRole('button', { name: 'Vaciar papelera' }));
        const confirmarBtn = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Vaciar papelera' });
        await usuario.click(confirmarBtn);
        await waitFor(() => expect(confirmarBtn).toBeDisabled());
        expect(confirmarBtn).toHaveAttribute('aria-busy', 'true');
        await usuario.click(confirmarBtn);
        expect(screen.getAllByRole('checkbox').every((c) => c.disabled)).toBe(true);
        expect(screen.getByRole('button', { name: 'Restaurar Lectura' })).toBeDisabled();
        terminar();
        await verEstado(/Papelera vaciada/);
        expect(llamadas(fetch, 'DELETE', '/api/papelera')).toHaveLength(1);
    });

    it('el error del servidor se muestra y no se pierde nada de la lista', async () => {
        const { usuario } = abrir({ rutas: { 'DELETE /api/papelera/seleccion': { status: 404, json: { error: 'Ninguna de esas actividades está en tu papelera.' } } } });
        await screen.findByText('Lectura');
        await usuario.click(casilla('Lectura'));
        await usuario.click(screen.getByRole('button', { name: 'Eliminar permanentemente (1)' }));
        await usuario.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar 1 actividad' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Ninguna de esas actividades está en tu papelera.');
        expect(screen.getByText('Lectura')).toBeInTheDocument();
    });

    it('el botón «♻ Restaurar» de cada fila sigue funcionando (sin seleccionar)', async () => {
        const { fetch, usuario, alRestaurar } = abrir({ rutas: { 'POST /api/papelera/b2/restaurar': { json: { restaurada: act('b2', 'Taller'), actividades: [], avisos: [] } } } });
        await screen.findByText('Taller');
        await usuario.click(screen.getByRole('button', { name: 'Restaurar Taller' }));
        await verEstado('♻ «Taller» restaurada.');
        expect(llamadas(fetch, 'POST', '/api/papelera/b2/restaurar')).toHaveLength(1);
        expect(alRestaurar).toHaveBeenCalledWith([]);
        expect(screen.queryByText('Taller')).toBeNull();
    });
});
