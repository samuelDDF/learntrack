// Capa de la ventana de acceso: si la dirección es /login, /registro o /verificar-correo, pinta la ventana encima de
// la página (la de fondo la pinta el enrutador). Con sesión abierta, RutaPublica lleva al panel.
// Compatibilidad: los enlaces antiguos /?acceso=login|registro|verificar se convierten en la ruta nueva.
import { Navigate, useLocation } from 'react-router';
import { DialogoAcceso } from './DialogoAcceso.jsx';
import { useAcceso } from '../hooks/useAcceso.js';
import { RutaPublica } from '../../../components/navigation/RutaPublica.jsx';
import { PAGINAS_ACCESO, RUTA_DE_PESTANA } from '../../../app/rutas.js';

export function CapaAcceso() {
    const { pathname, search } = useLocation();
    const { cambiarPaso, cerrar } = useAcceso();
    const pagina = PAGINAS_ACCESO[pathname];

    if (!pagina) {
        const antigua = new URLSearchParams(search).get('acceso');
        return RUTA_DE_PESTANA[antigua] ? <Navigate to={RUTA_DE_PESTANA[antigua]} replace /> : null;
    }
    return (
        <RutaPublica>
            <DialogoAcceso pestana={pagina.pestana} alCerrar={cerrar} alCambiarPestana={cambiarPaso} />
        </RutaPublica>
    );
}
