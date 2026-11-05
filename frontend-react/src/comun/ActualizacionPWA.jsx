// Aviso «Hay una versión nueva» del service worker (registerType: 'prompt'): la app NUNCA se actualiza en mitad
// de una sesión sin que la persona lo acepte, así no se mezclan archivos de dos versiones.
import { useEffect, useState } from 'react';

export function ActualizacionPWA({ registrar }) {
    const [actualizar, setActualizar] = useState(null);
    const [sinConexion, setSinConexion] = useState(false);
    useEffect(() => {
        let vivo = true;
        registrar?.({
            alHaberNueva: (aplicar) => { if (vivo) setActualizar(() => aplicar); }
        });
        const enLinea = () => setSinConexion(!navigator.onLine);
        enLinea();
        window.addEventListener('online', enLinea);
        window.addEventListener('offline', enLinea);
        return () => { vivo = false; window.removeEventListener('online', enLinea); window.removeEventListener('offline', enLinea); };
    }, [registrar]);
    return (
        <>
            {sinConexion ? (
                <p className="aviso-red" role="status">Sin conexión: puedes ver lo que ya está abierto, pero los cambios no se guardarán hasta que vuelva la red.</p>
            ) : null}
            {actualizar ? (
                <div className="aviso-actualizacion" role="alertdialog" aria-labelledby="pwa-nueva-titulo">
                    <p id="pwa-nueva-titulo">Hay una versión nueva de LearnTrack.</p>
                    <button type="button" className="btn" onClick={() => actualizar()}>Actualizar</button>
                    <button type="button" className="btn btn-volver" onClick={() => setActualizar(null)}>Más tarde</button>
                </div>
            ) : null}
        </>
    );
}
