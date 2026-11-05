// Borrado lógico (va a la papelera) con aviso «Deshacer». Lo usan Mi panel, Mi agenda y Proyectos.
import { useCallback } from 'react';
import { useAvisos } from '../../comun/ui/Avisos.jsx';
import { mensajeDeError } from '../../api/cliente.js';
import { actividades as apiActividades, papelera } from '../api.js';

/** Devuelve eliminar(actividad) → null si fue bien o el texto del error */
export function useEliminarActividad(alCambiar) {
    const { aviso } = useAvisos();
    return useCallback(async (actividad) => {
        let res;
        try { res = await apiActividades.eliminar(actividad.id); } catch (e) { return mensajeDeError(e); }
        if (!res.ok) return mensajeDeError(res, 'No se pudo eliminar.');
        alCambiar(res.data);
        aviso(`🗑 «${actividad.titulo}» se movió a la papelera.`, {
            accion: 'Deshacer',
            alPulsar: async () => {
                const r = await papelera.restaurar(actividad.id).catch(() => null);
                if (r?.ok) { alCambiar(r.data.actividades); aviso('♻ Restaurada.'); } else aviso('No se pudo restaurar; búscala en la papelera.');
            }
        });
        return null;
    }, [alCambiar, aviso]);
}
