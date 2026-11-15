// Apariencia GLOBAL (tema, paleta y fondo) y ZONA visual de la página.
//  · El tema lo aplica /tema-inicial.js antes de pintar (sin destello); aquí se mantiene en sincronía con la sesión:
//    al entrar se aplica el de la cuenta y al salir se olvida (la siguiente persona no hereda los colores).
//  · usarZonaPrivada: mientras se ve una pantalla con sesión, pone la clase «zona-privada» en <html> y <body>. Los
//    estilos de los temas (styles/privado/temas.css) solo actúan bajo esa clase, así la parte pública conserva su
//    aspecto aunque la SPA ya haya cargado los estilos privados (navegar entre zonas ya no recarga la página).
import { createContext, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { aplicarApariencia, olvidarApariencia } from '../services/tema.js';

export const TemaContext = createContext(null);

const aparienciaDe = (u) => ({ temaSeleccionado: u.temaSeleccionado, variablesTema: u.variablesTema ?? null, imagenFondoUrl: u.imagenFondoUrl ?? null });

export function ProveedorTema({ children }) {
    const { usuario, cargando } = useAuth();
    const habiaSesion = useRef(false);

    // Sesión ↔ apariencia: entrar aplica la de la cuenta; salir (o caducar) la olvida
    useEffect(() => {
        if (cargando) return;
        if (usuario) {
            aplicarApariencia(aparienciaDe(usuario));
            habiaSesion.current = true;
        } else if (habiaSesion.current) {
            olvidarApariencia();
            habiaSesion.current = false;
        }
    }, [usuario?.id, cargando]);          // eslint-disable-line react-hooks/exhaustive-deps

    /** Cambia la apariencia al instante (vista previa o guardada). guardar=false: no la recuerda en este navegador */
    const aplicar = useCallback((a, guardar) => aplicarApariencia(a, guardar), []);

    /** Marca la zona visual de la página (la usa el diseño privado mientras está montado). Devuelve cómo quitarla. */
    const usarZonaPrivada = useCallback((clasePagina = '') => {
        const clases = ['zona-privada', ...clasePagina.split(' ').filter(Boolean)];
        document.documentElement.classList.add('zona-privada');
        document.body.classList.add(...clases);
        return () => {
            document.documentElement.classList.remove('zona-privada');
            document.body.classList.remove(...clases);
        };
    }, []);

    const valor = useMemo(() => ({ aplicar, usarZonaPrivada }), [aplicar, usarZonaPrivada]);
    return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>;
}
