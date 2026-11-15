// Lo que en una web de varias páginas hace el navegador solo y en una SPA hay que hacer a mano, en cada navegación:
//  · Título del documento (y «noindex» en la página 404).
//  · Desplazamiento: arriba del todo al cambiar de página, o hasta el ancla (#servicios) si la dirección la trae.
//  · Foco: al cambiar de página se lleva al contenido principal (<main id="contenido">), así quien usa lector de
//    pantalla o teclado empieza por la página nueva y no se queda en el enlace pulsado.
// La ventana de acceso (/login…) no cuenta como cambio de página: se abre encima de la que ya se ve.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { PAGINAS_ACCESO, PAGINAS_PRIVADAS, PAGINAS_PUBLICAS } from '../../app/rutas.js';

const TITULO_404 = 'Página no encontrada | LearnTrack';

function tituloDe(pathname) {
    if (PAGINAS_PUBLICAS[pathname]) return PAGINAS_PUBLICAS[pathname].titulo;
    if (PAGINAS_ACCESO[pathname]) return PAGINAS_ACCESO[pathname].titulo;
    if (PAGINAS_PRIVADAS[pathname]) return `${PAGINAS_PRIVADAS[pathname].titulo} | LearnTrack`;
    return TITULO_404;
}

/** Página que se ve de verdad: con la ventana de acceso abierta, la de fondo (o el inicio si se llegó directo) */
const paginaVisible = (location) => (PAGINAS_ACCESO[location.pathname] ? location.state?.fondo?.pathname ?? '/' : location.pathname);

function enfocarContenido() {
    const main = document.getElementById('contenido');
    if (!main) return;
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
}

export function GestorNavegacion() {
    const location = useLocation();
    const { pathname, hash } = location;
    const anterior = useRef(null);

    useEffect(() => {
        document.title = tituloDe(pathname);
        const es404 = document.title === TITULO_404;
        let robots = null;
        if (es404) {
            robots = document.createElement('meta');
            robots.name = 'robots'; robots.content = 'noindex';
            document.head.append(robots);
        }
        return () => robots?.remove();
    }, [pathname]);

    const visible = paginaVisible(location);
    useEffect(() => {
        const primera = anterior.current === null;
        const cambio = anterior.current !== visible;
        anterior.current = visible;
        if (PAGINAS_ACCESO[pathname]) return;               // la ventana se abre encima: nada se mueve
        if (hash) {
            // El ancla puede no existir aún (página que se descarga al pedirla): se reintenta en el siguiente cuadro
            const ir = () => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
            requestAnimationFrame(ir);
            return;
        }
        if (!cambio || primera) return;                      // primera carga: el navegador ya está arriba
        window.scrollTo(0, 0);
        // Tras pintar la página nueva (si se está descargando, el foco va al contenedor cuando aparezca)
        requestAnimationFrame(enfocarContenido);
    }, [visible, pathname, hash]);

    return null;
}
