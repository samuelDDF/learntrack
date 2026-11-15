// Estado y operaciones de la papelera (GET/POST/DELETE /api/papelera…). v3.9, ahora como hook de la página /papelera:
//  · Selección (una, varias o todas) en React (un Set de ids), nunca en el DOM.
//  · Mientras una operación está en curso, `ocupado` bloquea las demás (sin peticiones dobles).
//  · Cada resultado se anuncia en la página (estado) y como aviso flotante.
import { useEffect, useMemo, useState } from 'react';
import { useAvisos } from '../../../hooks/useAvisos.js';
import { mensajeDeError } from '../../../services/errores.js';
import { papelera } from '../services/papelera.service.js';

export const actividadesTxt = (n) => `${n} ${n === 1 ? 'actividad' : 'actividades'}`;

export function usePapelera() {
    const [datos, setDatos] = useState(null);           // null = cargando · { dias, actividades }
    const [error, setError] = useState('');
    const [estado, setEstado] = useState('');           // resultado de la última operación
    const [seleccion, setSeleccion] = useState(() => new Set());
    const [ocupado, setOcupado] = useState(null);       // null | id (restaurar fila) | 'restaurar' | 'eliminar' | 'vaciar'
    const { aviso } = useAvisos();

    useEffect(() => {
        let vivo = true;
        papelera.listar().then((r) => {
            if (!vivo) return;
            if (r.ok) setDatos(r.data); else { setDatos({ dias: null, actividades: [] }); setError('No pude cargar la papelera.'); }
        }).catch(() => { if (vivo) { setDatos({ dias: null, actividades: [] }); setError('No pude cargar la papelera.'); } });
        return () => { vivo = false; };
    }, []);

    const lista = useMemo(() => datos?.actividades ?? [], [datos]);
    const n = seleccion.size;
    const todas = lista.length > 0 && n === lista.length;

    const alternar = (actividadId) => setSeleccion((s) => {
        const nueva = new Set(s);
        if (nueva.has(actividadId)) nueva.delete(actividadId); else nueva.add(actividadId);
        return nueva;
    });
    const alternarTodas = () => setSeleccion(todas ? new Set() : new Set(lista.map((a) => a.id)));
    const limpiarSeleccion = () => setSeleccion(new Set());
    /** Quita de la lista (y de la selección) lo que ya no está en la papelera */
    const quitar = (ids) => {
        const fuera = new Set(ids);
        setDatos((d) => ({ ...d, actividades: d.actividades.filter((x) => !fuera.has(x.id)) }));
        setSeleccion((s) => new Set([...s].filter((x) => !fuera.has(x))));
    };
    const empezar = (que) => { setOcupado(que); setError(''); setEstado(''); };
    const anunciar = (texto) => { setEstado(texto); aviso(texto); };
    const conAvisos = (texto, avisos) => `${texto}${avisos?.length ? ` ${avisos.join(' ')}` : ''}`;

    /** Restaurar UNA (botón de la fila) */
    async function restaurarUna(a) {
        if (ocupado) return;
        empezar(a.id);
        try {
            const res = await papelera.restaurar(a.id);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo restaurar.')); return; }
            quitar([a.id]);
            anunciar(conAvisos(`♻ «${a.titulo}» restaurada.`, res.data.avisos));
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); }
    }

    /** Restaurar la SELECCIÓN */
    async function restaurarSeleccion() {
        if (ocupado || n === 0) return;
        empezar('restaurar');
        try {
            const res = await papelera.restaurarVarias([...seleccion]);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo restaurar la selección.')); return; }
            quitar(res.data.restauradas.map((a) => a.id));
            limpiarSeleccion();
            const k = res.data.restauradas.length;
            anunciar(conAvisos(`♻ ${actividadesTxt(k)} ${k === 1 ? 'restaurada' : 'restauradas'}.`, res.data.avisos));
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); }
    }

    /** Eliminar para siempre la SELECCIÓN (tras confirmar) */
    async function eliminarSeleccion() {
        if (ocupado || n === 0) return;
        empezar('eliminar');
        const ids = [...seleccion];
        try {
            const res = await papelera.eliminarDefinitivamente(ids);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo eliminar la selección.')); return; }
            quitar(ids);
            limpiarSeleccion();
            anunciar(`🗑 ${actividadesTxt(res.data.eliminadas)} ${res.data.eliminadas === 1 ? 'eliminada' : 'eliminadas'} para siempre.`);
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); }
    }

    /** Vaciar TODA la papelera (no depende de la selección) */
    async function vaciar() {
        if (ocupado) return;
        empezar('vaciar');
        try {
            const res = await papelera.vaciar();
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo vaciar la papelera.')); return; }
            setDatos((d) => ({ ...d, actividades: [] }));
            limpiarSeleccion();
            anunciar(res.data.eliminadas
                ? `🗑 Papelera vaciada: se eliminaron ${actividadesTxt(res.data.eliminadas)} para siempre.`
                : 'La papelera ya estaba vacía.');
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); }
    }

    return {
        cargando: datos === null, dias: datos?.dias ?? null, lista, error, estado, ocupado,
        seleccion, n, todas, alguna: n > 0 && !todas,
        alternar, alternarTodas, limpiarSeleccion, restaurarUna, restaurarSeleccion, eliminarSeleccion, vaciar
    };
}
