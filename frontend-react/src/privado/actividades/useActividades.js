// Lista de actividades de una pantalla, normalizada con la regla común (compartido/carga.js).
import { useCallback, useState } from 'react';
import { normalizarActividad } from '@compartido/carga.js';
import { actividades as apiActividades } from '../api.js';

export function useActividades({ archivadas = false } = {}) {
    const [lista, setLista] = useState([]);
    const [cargada, setCargada] = useState(false);
    const [sincronizando, setSincronizando] = useState(false);     // v3.8: indicador visual mientras se pide la lista
    const fijar = useCallback((nueva) => {
        setLista((Array.isArray(nueva) ? nueva : []).map(normalizarActividad));
        setCargada(true);
    }, []);
    const recargar = useCallback(async () => {
        setSincronizando(true);
        try {
            const r = await apiActividades.listar({ archivadas });
            if (r.ok) fijar(r.data);
            else setCargada(true);
            return r;
        } finally {
            setSincronizando(false);
        }
    }, [archivadas, fijar]);
    return { actividades: lista, fijar, recargar, cargada, sincronizando };
}

/** Proyectos usados (sugerencias del campo «Proyecto» del formulario) */
export const proyectosDe = (lista) => [...new Set(lista.map((a) => a.proyecto).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es'));
