import { useEffect, useState } from 'react';
import { obtenerUsuario, alActualizarUsuario } from './sesion.js';

/** { usuario, cargando } — se actualiza cuando Configuración cambia el nombre, la foto o la voz */
export function useUsuario() {
    const [estado, setEstado] = useState({ usuario: null, cargando: true });
    useEffect(() => {
        let vivo = true;
        obtenerUsuario().then((u) => { if (vivo) setEstado({ usuario: u, cargando: false }); });
        const quitar = alActualizarUsuario((u) => { if (vivo) setEstado({ usuario: u, cargando: false }); });
        return () => { vivo = false; quitar(); };
    }, []);
    return estado;
}
