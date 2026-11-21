// Estudio (v3.12) en el navegador: la persona DECIDE (sugerencias), AJUSTA (plan de sesiones) y CONFIRMA (análisis de
// documentos). Se comprueba qué se envía a la API y que nada se guarda sin pulsar el botón.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { SugerenciaEstudio, PlanSesiones, AnalisisDocumento } from './EstudioIA.jsx';
import { simularFetch, pintar } from '../../../pruebas/utilidades.jsx';
import { hoyISO } from '../../../utils/fechas.js';
import { sumarDias } from '@compartido/fechas.js';

const HOY = hoyISO();
const ID = 'b'.repeat(24);
const llamadas = (f, url) => f.mock.calls.filter(([u]) => u === url);
const resumen = { progreso: 0, horasCompletadas: 0, horasProgramadas: 0, horasEstimadas: 4, horasPendientes: 4, situacion: 'sin_fecha', diasRestantes: null };

describe('SugerenciaEstudio', () => {
    it('explica el motivo y permite aceptar, posponer o descartar', async () => {
        const f = simularFetch({ [`POST /api/estudio/${ID}/sugerencia`]: (c) => ({ json: { mensaje: c.accion === 'posponer' ? 'Te lo recuerdo dentro de 7 días.' : 'ok', objetivo: { id: ID } } }) });
        pintar(<SugerenciaEstudio sugerencia={{ objetivo: { id: ID, tema: 'API REST', estado: 'sugerido', categoria: 'tema', menciones: 2, resumen }, motivo: 'Lo dijiste en el chat: «No entiendo las API REST».' }} />);
        expect(screen.getByText(/Lo dijiste en el chat/)).toBeInTheDocument();
        expect(screen.getByText(/mencionado 2 veces/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Posponer 7 días' }));
        expect(await screen.findByText('Te lo recuerdo dentro de 7 días.')).toBeInTheDocument();
        expect(JSON.parse(llamadas(f, `/api/estudio/${ID}/sugerencia`)[0][1].body)).toEqual({ accion: 'posponer', dias: 7 });
        expect(screen.queryByRole('button', { name: 'Añadir a Estudio' })).toBeNull();
    });

    it('«Añadir y planificar» muestra el plan para revisarlo', async () => {
        const plan = { sesiones: [{ objetivoId: ID, tema: 'API REST', fecha: sumarDias(HOY, 1), hora_inicio: '15:00', hora_fin: '16:00', horas: 1, motivo: 'hueco libre' }], avisos: [], explicaciones: ['Primero va lo que vence antes.'], temas: [{ id: ID, tema: 'API REST', fechaLimite: null }] };
        const f = simularFetch({ [`POST /api/estudio/${ID}/sugerencia`]: { json: { mensaje: '«API REST» ya está en Estudio.', objetivo: { id: ID }, plan } } });
        pintar(<SugerenciaEstudio sugerencia={{ objetivo: { id: ID, tema: 'API REST', estado: 'sugerido', resumen }, motivo: 'x' }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Añadir y planificar' }));
        expect(await screen.findByRole('button', { name: 'Guardar 1 sesión en el calendario' })).toBeInTheDocument();
        expect(JSON.parse(llamadas(f, `/api/estudio/${ID}/sugerencia`)[0][1].body)).toEqual({ accion: 'aceptar', planificar: true });
        expect(llamadas(f, '/api/estudio/sesiones')).toHaveLength(0, 'aún no se guardó ninguna sesión');
    });
});

describe('PlanSesiones', () => {
    const plan = {
        sesiones: [
            { objetivoId: ID, tema: 'SQL', fecha: sumarDias(HOY, 1), hora_inicio: '15:00', hora_fin: '16:00', horas: 1, motivo: 'hueco libre' },
            { objetivoId: ID, tema: 'SQL', fecha: sumarDias(HOY, 3), hora_inicio: '16:00', hora_fin: '17:00', horas: 1, motivo: 'hueco libre' }
        ],
        avisos: ['No encontré hueco para 1 h de «SQL».'], explicaciones: [], temas: [{ id: ID, tema: 'SQL', fechaLimite: sumarDias(HOY, 5) }]
    };

    it('se ajusta hora y duración, se quita una sesión y solo se envía lo elegido', async () => {
        const f = simularFetch({ 'POST /api/estudio/sesiones': (c) => ({ status: 201, json: { mensaje: `Guardé ${c.sesiones.length} sesión de estudio en tu calendario.`, loteId: 'c'.repeat(24), avisos: [], actividades: [] } }) });
        pintar(<PlanSesiones plan={plan} />);
        expect(screen.getByText(/Ojo: No encontré hueco/)).toBeInTheDocument();
        const [primera, segunda] = screen.getAllByRole('listitem');
        fireEvent.change(within(primera).getByLabelText('Hora'), { target: { value: '18:30' } });
        fireEvent.change(within(primera).getByLabelText('Duración'), { target: { value: '1.5' } });
        fireEvent.click(within(segunda).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 sesión en el calendario' }));
        expect(await screen.findByText(/Guardé 1 sesión/)).toBeInTheDocument();
        expect(JSON.parse(llamadas(f, '/api/estudio/sesiones')[0][1].body)).toEqual({ sesiones: [{ objetivoId: ID, fecha: sumarDias(HOY, 1), hora_inicio: '18:30', horas: 1.5 }] });
        expect(screen.getByRole('button', { name: /Deshacer/ })).toBeInTheDocument();
    });

    it('si el servidor detecta un cruce, lo marca en esa sesión y no da nada por guardado', async () => {
        simularFetch({ 'POST /api/estudio/sesiones': { status: 409, json: { error: 'Algunas sesiones ya no caben: corrígelas y vuelve a guardar. No guardé ninguna.', conflictos: [{ indice: 1, motivo: 'Sesión 2: se cruza con «Clase».' }] } } });
        pintar(<PlanSesiones plan={plan} />);
        fireEvent.click(screen.getByRole('button', { name: 'Guardar 2 sesiones en el calendario' }));
        expect(await screen.findByText('Sesión 2: se cruza con «Clase».')).toBeInTheDocument();
        expect(screen.getByText(/No guardé ninguna/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar 2 sesiones en el calendario' })).toBeEnabled();
    });
});

describe('AnalisisDocumento', () => {
    const entrega = sumarDias(HOY, 9);
    const analisis = {
        titulo: 'Taller 3', resumen: 'Lista de tareas en JavaScript.', requisitos: ['Usar JavaScript'], entregables: ['Código .zip'], avisos: [],
        temas: [
            { tema: 'Funciones en JavaScript', tipo: 'tema', horas: 2, enDocumento: true, motivo: 'Lo pide el taller.', cita: 'funciones' },
            { tema: 'HTML básico', tipo: 'tema', horas: 1, enDocumento: false, motivo: 'Conocimiento previo.', cita: null }
        ],
        fechas: [
            { tipo: 'publicacion', texto: '10 de noviembre', fecha: sumarDias(HOY, -3), pasada: true, requiereConfirmacion: false, cita: 'Publicado el 10' },
            { tipo: 'entrega', texto: 'x', fecha: entrega, pasada: false, requiereConfirmacion: false, cita: 'Entrega' },
            { tipo: 'examen', texto: 'el viernes', fecha: null, pasada: false, requiereConfirmacion: true, motivo: 'La fecha es relativa («el viernes»): confirma a qué día se refiere.', cita: 'Quiz el viernes' }
        ],
        fechaLimiteSugerida: entrega, entregaSugerida: { titulo: 'Entrega: Taller 3', fecha: entrega, tipo: 'entrega' }
    };

    it('muestra lo identificado, deja corregir y solo guarda lo confirmado', async () => {
        const f = simularFetch({ 'POST /api/estudio/lote': (c) => ({ status: 201, json: { mensaje: `Guardé ${c.objetivos.length} temas en Estudio y la entrega en tu calendario.`, creados: c.objetivos.map((o, i) => ({ id: String(i).repeat(24), tema: o.tema })), existentes: [], entrega: { loteId: 'd'.repeat(24) }, avisos: [] } }) });
        pintar(<AnalisisDocumento analisis={analisis} />);
        expect(screen.getByText('Publicación')).toBeInTheDocument();
        expect(screen.getByText(/confirma a qué día se refiere/)).toBeInTheDocument();
        expect(screen.getByText(/Conocimiento previo que deduzco/)).toBeInTheDocument();
        expect(screen.getByLabelText('Incluir HTML básico')).not.toBeChecked();   // lo deducido no se marca solo
        expect(llamadas(f, '/api/estudio/lote')).toHaveLength(0);
        fireEvent.click(screen.getByLabelText('Incluir HTML básico'));
        fireEvent.change(screen.getAllByLabelText('Nombre del tema')[0], { target: { value: 'Funciones' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar 2 temas en Estudio' }));
        expect(await screen.findByText(/Guardé 2 temas/)).toBeInTheDocument();
        const cuerpo = JSON.parse(llamadas(f, '/api/estudio/lote')[0][1].body);
        expect(cuerpo.objetivos.map((o) => o.tema)).toEqual(['Funciones', 'HTML básico']);
        expect(cuerpo.fechaLimite).toBe(entrega);
        expect(cuerpo.entrega).toEqual({ titulo: 'Entrega: Taller 3', fecha: entrega });
        expect(screen.getByRole('button', { name: 'Planificar sesiones de estudio' })).toBeInTheDocument();
    });

    it('«Sin fecha límite» no envía fecha ni entrega; «Descartar» no llama a la API', async () => {
        const f = simularFetch({ 'POST /api/estudio/lote': { status: 201, json: { mensaje: 'Guardé 1 tema en Estudio.', creados: [], existentes: [], entrega: null, avisos: [] } } });
        const { unmount } = pintar(<AnalisisDocumento analisis={analisis} />);
        fireEvent.click(screen.getByLabelText('Sin fecha límite'));
        expect(screen.getByLabelText('Título de la entrega')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 tema en Estudio' }));
        await waitFor(() => expect(llamadas(f, '/api/estudio/lote')).toHaveLength(1));
        const cuerpo = JSON.parse(llamadas(f, '/api/estudio/lote')[0][1].body);
        expect([cuerpo.fechaLimite, cuerpo.entrega]).toEqual([null, null]);
        unmount();
        pintar(<AnalisisDocumento analisis={analisis} />);
        fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
        expect(screen.getByText(/no se guardó nada/)).toBeInTheDocument();
        expect(llamadas(f, '/api/estudio/lote')).toHaveLength(1);
    });
});
