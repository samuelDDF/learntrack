// Datos de la cuenta para Mi perfil y Configuración: GET /api/perfil al entrar y, tras cada cambio guardado, la
// apariencia y la cabecera (nombre, foto, voz, nombre de la IA) se ponen al día sin recargar.
import { useCallback, useEffect, useState } from 'react';
import { useAvisos } from '../../../hooks/useAvisos.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { useTema } from '../../../hooks/useTema.js';
import { perfil as apiPerfil } from '../services/perfil.service.js';

export function usePerfil() {
    const { aviso } = useAvisos();
    const { actualizarUsuario } = useAuth();
    const { aplicar } = useTema();
    const [datos, setDatos] = useState(null);           // { perfil, integraciones }
    const [error, setError] = useState(false);

    /** Aplica lo que devuelve el servidor y avisa a la cabecera */
    const pintarTodo = useCallback((d) => {
        setDatos((prev) => ({ perfil: d.perfil, integraciones: d.integraciones ?? prev?.integraciones ?? { modo: 'simulado' } }));
        const p = d.perfil;
        aplicar({ temaSeleccionado: p.temaSeleccionado, variablesTema: p.variablesTema, imagenFondoUrl: p.imagenFondoUrl });
        actualizarUsuario({ nombre: p.nombre, email: p.email, avatarUrl: p.avatarUrl, vozAsistente: p.vozAsistente, nombreIA: p.nombreIA });
    }, [aplicar, actualizarUsuario]);
    const fijarPerfil = useCallback((perfil, integraciones) => setDatos((prev) => ({ perfil, integraciones: integraciones ?? prev?.integraciones })), []);

    useEffect(() => {
        let vivo = true;
        apiPerfil.obtener().then((r) => {
            if (!vivo) return;
            if (!r.ok) throw new Error();
            pintarTodo(r.data);
        }).catch(() => { if (vivo) { setError(true); aviso('No se pudo cargar tu configuración. Recarga la página.'); } });
        return () => { vivo = false; };
    }, [pintarTodo, aviso]);

    return { perfil: datos?.perfil ?? null, integraciones: datos?.integraciones, error, pintarTodo, fijarPerfil };
}
