// Parte izquierda de la cabecera privada: avatar (abre el panel lateral del perfil: editar perfil, cambiar de cuenta,
// cerrar sesión y festivos) y engranaje (menú de Configuración).
import { useState } from 'react';
import { Link } from 'react-router';
import { Dialogo } from '../../comun/ui/Dialogo.jsx';
import { cerrarSesion } from '../../comun/sesion.js';
import { Avatar } from './Avatar.jsx';
import { MenuConfiguracion } from './MenuConfiguracion.jsx';
import { ImportadorFestivos } from './ImportadorFestivos.jsx';
import './barra-navegacion.css';

function IconoCerrar() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
        </svg>
    );
}

function PanelPerfil({ usuario, alCerrar }) {
    const [saliendo, setSaliendo] = useState(false);
    const salir = (destino) => { setSaliendo(true); cerrarSesion(destino); };
    return (
        <>
            <div className="offcanvas-cabecera">
                <Avatar usuario={usuario} clase="avatar-grande" />
                <div className="offcanvas-quien">
                    <h2 id="offcanvas-titulo">{usuario?.nombre ?? 'Mi perfil'}</h2>
                    <p className="offcanvas-email">{usuario?.email ?? ''}</p>
                </div>
                <button type="button" className="barra-icono offcanvas-cerrar" title="Cerrar" onClick={alCerrar}>
                    <IconoCerrar /><span className="solo-lectores">Cerrar</span>
                </button>
            </div>
            <nav className="offcanvas-acciones" aria-label="Cuenta">
                <Link className="boton" to="/configuracion#informacion" onClick={alCerrar}>✏️ Editar mi perfil</Link>
                <button type="button" className="boton" id="btn-cambiar-cuenta" disabled={saliendo} onClick={() => salir('/?acceso=login')}>🔁 Cambiar de cuenta</button>
                <button type="button" className="boton boton-peligro" id="btn-salir" disabled={saliendo} onClick={() => salir('/')}>↪ Cerrar sesión</button>
            </nav>
            <ImportadorFestivos />
        </>
    );
}

export function BarraCuenta({ usuario }) {
    const [perfilAbierto, setPerfilAbierto] = useState(false);
    return (
        <div className="barra-cuenta" id="barra-cuenta">
            <button type="button" className="barra-icono barra-avatar" id="btn-perfil" aria-haspopup="dialog" aria-expanded={perfilAbierto}
                aria-controls="menu-perfil" title={usuario?.nombre ? `Mi perfil (${usuario.nombre})` : 'Mi perfil'} onClick={() => setPerfilAbierto(true)}>
                <Avatar usuario={usuario} /><span className="solo-lectores">Mi perfil</span>
            </button>
            <MenuConfiguracion />
            <Dialogo abierto={perfilAbierto} alCerrar={() => setPerfilAbierto(false)} className="offcanvas" id="menu-perfil" aria-labelledby="offcanvas-titulo">
                <PanelPerfil usuario={usuario} alCerrar={() => setPerfilAbierto(false)} />
            </Dialogo>
        </div>
    );
}
