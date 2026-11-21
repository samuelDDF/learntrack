// Diseño de la ZONA PÚBLICA: cabecera con el menú público y el acceso, la página (Outlet), el contacto flotante y el
// pie. Las páginas se pintan sin recargar; la ventana de acceso la pinta CapaAcceso encima de este diseño.
import { Suspense, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Cabecera, Pie } from './Cabecera.jsx';
import { Cargando } from '../common/Cargando.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useAcceso } from '../../features/auth/hooks/useAcceso.js';
import { ContactoFlotante } from '../../features/landing/components/ContactoFlotante.jsx';
import { NAVEGACION_PUBLICA, PAGINAS_ACCESO, PAGINAS_PUBLICAS, RUTA_ADMIN, RUTA_PANEL } from '../../app/rutas.js';
import '../../features/landing/inicio.css';
import '../../features/landing/paginas-info.css';

function NavAcceso() {
    const { usuario, cerrarSesion } = useAuth();
    const { abrir } = useAcceso();
    const [saliendo, setSaliendo] = useState(false);
    const salir = async () => { setSaliendo(true); await cerrarSesion({ destino: '/' }); setSaliendo(false); };
    return (
        <div className="nav-acceso" id="nav-acceso">
            {usuario ? (
                <>
                    <Link className="btn btn-header btn-header-sec" to={usuario.esAdmin ? RUTA_ADMIN : RUTA_PANEL}>{usuario.esAdmin ? 'Administración' : 'Mi panel'}</Link>
                    <button type="button" className="btn btn-header btn-header-sec" disabled={saliendo} onClick={salir}>Cerrar sesión</button>
                </>
            ) : (
                <button type="button" className="btn btn-header btn-header-sec" data-auth="login" onClick={() => abrir('login')}>Iniciar sesión / Registro</button>
            )}
        </div>
    );
}

export default function LayoutPublico({ children }) {
    const { pathname } = useLocation();
    const existe = Boolean(PAGINAS_PUBLICAS[pathname] || PAGINAS_ACCESO[pathname]);
    return (
        <>
            <Cabecera enlaces={NAVEGACION_PUBLICA} despues={<NavAcceso />} />
            <Suspense fallback={<Cargando pantalla texto="Cargando…" />}>
                {children ?? <Outlet />}
            </Suspense>
            {existe ? <ContactoFlotante /> : null}
            <Pie />
        </>
    );
}
