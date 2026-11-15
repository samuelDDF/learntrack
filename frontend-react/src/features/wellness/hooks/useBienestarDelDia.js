// Carga mental, consejo de la IA e historial del día, a partir de las actividades y del check-in.
//  · El porcentaje se calcula con la regla común (compartido/carga.js), la MISMA que usa el servidor y la Agenda.
//  · Cada vez que cambian las actividades de hoy o el check-in: el servidor registra el % del día en el historial
//    (lo recalcula él; solo guarda días <= hoy) y se pide un consejo nuevo a la IA (el último pedido gana).
import { useCallback, useEffect, useRef, useState } from 'react';
import { cargaDelDia, actividadesDelDia, capacidadDe } from '@compartido/carga.js';
import { bienestar } from '../services/bienestar.service.js';
import { asistente } from '../../ai-assistant/services/asistente.service.js';

const MENSAJE_IA_POR_DEFECTO = 'Pensando en ti...';

export function useBienestarDelDia({ actividades, fecha, checkin, checkinListo }) {
    const [historial, setHistorial] = useState(null);
    const [consejo, setConsejo] = useState({ texto: MENSAJE_IA_POR_DEFECTO, pensando: true });
    const turnoIA = useRef(0);

    const hoy = actividadesDelDia(actividades, fecha);
    const carga = cargaDelDia(actividades, fecha, capacidadDe(checkin));

    useEffect(() => {
        let vivo = true;
        bienestar.historial()
            .then((r) => { if (vivo) setHistorial(r.ok ? r.data : {}); })
            .catch(() => { if (vivo) setHistorial({}); });
        return () => { vivo = false; };
    }, []);

    const firmaHoy = hoy.map((a) => `${a.id}:${a.horas}:${a.exigencia}:${a.estado}:${a.titulo}`).join('|');
    const pedirConsejo = useCallback(async (porcentaje, lista) => {
        const turno = ++turnoIA.current;
        setConsejo({ texto: MENSAJE_IA_POR_DEFECTO, pensando: true });
        if (lista.length === 0) return;
        const contexto = checkin ? `INFO EXTRA DEL USUARIO HOY -> Durmió: ${checkin.sueno} / Objetivo de hoy: ${checkin.enfoque}` : '';
        try {
            const r = await asistente.consejo({
                estadoAnimo: checkin?.animo ?? 'medio', porcentajeCarga: porcentaje,
                actividades: [contexto, ...lista.map((a) => `${a.titulo} (${a.horas} hrs)`)].filter(Boolean)
            });
            if (turno !== turnoIA.current) return;
            setConsejo({ texto: (r.ok && r.data.consejo) || MENSAJE_IA_POR_DEFECTO, pensando: false });
        } catch {
            if (turno === turnoIA.current) setConsejo({ texto: MENSAJE_IA_POR_DEFECTO, pensando: false });
        }
    }, [checkin]);

    useEffect(() => {
        if (!checkinListo || !checkin) return;
        if (hoy.length > 0) {
            bienestar.registrarHistorial(fecha, fecha).then((r) => { if (r?.ok) setHistorial(r.data); }).catch(() => {});
        }
        pedirConsejo(carga.porcentaje, hoy);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checkinListo, checkin, firmaHoy]);

    return { hoy, carga, historial, consejo };
}
