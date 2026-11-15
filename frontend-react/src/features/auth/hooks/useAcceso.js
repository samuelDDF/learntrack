// Abrir, cambiar de paso y cerrar la ventana de acceso. Cada paso es una RUTA (/login, /registro,
// /verificar-correo) que se pinta encima de la página desde la que se abrió («fondo»), sin recargar.
//  · El fondo y la página privada pedida («desde») viajan en el estado del historial, no en la URL.
//  · Cambiar de paso reemplaza la entrada del historial: «Atrás» cierra la ventana en lugar de recorrer pestañas.
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { PAGINAS_ACCESO, RUTA_DE_PESTANA, RUTA_INICIO, RUTA_LOGIN } from '../../../app/rutas.js';

const soloRuta = ({ pathname, search, hash }) => ({ pathname, search, hash });

export function useAcceso() {
    const navegar = useNavigate();
    const location = useLocation();
    const enVentana = Boolean(PAGINAS_ACCESO[location.pathname]);

    /** Abre la ventana en el paso pedido (desde cualquier página pública) */
    const abrir = useCallback((cual = 'login') => {
        const fondo = enVentana ? location.state?.fondo ?? null : soloRuta(location);
        navegar(RUTA_DE_PESTANA[cual] ?? RUTA_LOGIN, { state: { fondo } });
    }, [navegar, location, enVentana]);

    /** Cambia de paso dentro de la ventana (conserva fondo y destino) */
    const cambiarPaso = useCallback((cual) => {
        navegar(RUTA_DE_PESTANA[cual] ?? RUTA_LOGIN, { replace: true, state: location.state ?? null });
    }, [navegar, location.state]);

    /** Cierra la ventana: vuelve a la página de fondo, o al inicio si se llegó directamente a /login */
    const cerrar = useCallback(() => {
        if (location.state?.fondo) navegar(-1);
        else navegar(RUTA_INICIO, { replace: true });
    }, [navegar, location.state]);

    return { abrir, cambiarPaso, cerrar };
}
