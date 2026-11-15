// Avatar: foto de perfil privada (se descarga con credenciales) o la inicial del nombre.
import { useEffect, useState } from 'react';
import { cargarImagenPrivada } from '../../../services/http.js';

export const inicialDe = (nombre) => (String(nombre ?? '').trim()[0] ?? '?').toUpperCase();

export function Avatar({ usuario, clase = 'avatar-mini', alt = '' }) {
    const ruta = usuario?.avatarUrl ?? null;
    const [url, setUrl] = useState(null);
    useEffect(() => {
        let activo = true;
        let blobUrl = null;
        if (!ruta) { setUrl(null); return undefined; }
        cargarImagenPrivada(ruta).then((creada) => {
            blobUrl = creada;
            if (activo) setUrl(creada);
            else URL.revokeObjectURL(creada);
        }).catch(() => { if (activo) setUrl(null); });
        return () => { activo = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }, [ruta]);
    return (
        <span className={`avatar ${clase}`} aria-hidden={alt ? undefined : 'true'}>
            {url ? <img src={url} alt={alt} /> : <span className="avatar-inicial">{inicialDe(usuario?.nombre)}</span>}
        </span>
    );
}
