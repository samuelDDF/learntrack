// Estado de la PWA: registra el service worker y avisa si no hay conexión.
// Sin aviso de «versión nueva» (se quitó a petición): las navegaciones van SIEMPRE a la red y los archivos llevan
// su huella en el nombre, así que al recargar o volver a abrir LearnTrack ya se usa la versión publicada; el
// service worker nuevo se activa solo cuando se cierra la app (nunca cambia el código en mitad de una sesión).
import { useEffect, useState } from 'react';

export function ActualizacionPWA({ registrar }) {
    const [sinConexion, setSinConexion] = useState(false);
    useEffect(() => {
        registrar?.();
        const enLinea = () => setSinConexion(!navigator.onLine);
        enLinea();
        window.addEventListener('online', enLinea);
        window.addEventListener('offline', enLinea);
        return () => { window.removeEventListener('online', enLinea); window.removeEventListener('offline', enLinea); };
    }, [registrar]);
    return sinConexion ? (
        <p className="aviso-red" role="status">Sin conexión: puedes ver lo que ya está abierto, pero los cambios no se guardarán hasta que vuelva la red.</p>
    ) : null;
}
