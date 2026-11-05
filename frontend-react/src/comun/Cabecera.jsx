// Cabecera común (pública y privada): logo, navegación principal y, en móvil, menú hamburguesa accesible.
//  · enlaces: [{ a: '/panel', texto: 'Mi panel' }] (navegación interna sin recargar, con aria-current automático)
//  · antes: lo que va a la izquierda del logo (avatar y engranaje en la zona privada)
//  · despues: lo que va a la derecha (acceso / saludo)
import { useEffect, useId, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';

function IconoMenu({ abierto }) {
    return (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
            {abierto ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
    );
}

export function Cabecera({ enlaces, antes = null, despues = null, logoInterno = false }) {
    const [abierto, setAbierto] = useState(false);
    const { pathname } = useLocation();
    const idNav = useId();
    useEffect(() => { setAbierto(false); }, [pathname]);
    useEffect(() => {
        if (!abierto) return undefined;
        const alTeclear = (e) => { if (e.key === 'Escape') setAbierto(false); };
        document.addEventListener('keydown', alTeclear);
        return () => document.removeEventListener('keydown', alTeclear);
    }, [abierto]);
    const logo = <img src="/recursos/favicon.svg" alt="LearnTrack" className="logo-img" width="32" height="32" />;
    return (
        <header className="site-header">
            <a className="skip-link" href="#contenido">Saltar al contenido</a>
            <div className="header-inner">
                <div className="header-grupo-izquierdo">
                    {antes}
                    {/* El logo lleva al inicio público: desde la zona privada es una navegación completa (otra zona) */}
                    {logoInterno ? <Link className="brand" to="/">{logo}</Link> : <a className="brand" href="/">{logo}</a>}
                    <button type="button" className="menu-movil-boton" aria-expanded={abierto} aria-controls={idNav}
                        onClick={() => setAbierto((v) => !v)}>
                        <IconoMenu abierto={abierto} />
                        <span className="solo-lectores">{abierto ? 'Cerrar menú' : 'Abrir menú'}</span>
                    </button>
                    <nav id={idNav} aria-label="Navegación principal" className={`navegacion-principal${abierto ? ' abierta' : ''}`}>
                        <ul>
                            {enlaces.map((e) => (
                                <li key={e.a}>
                                    {e.externo
                                        ? <a href={e.a}>{e.texto}</a>
                                        : <NavLink to={e.a} end className={({ isActive }) => (isActive ? 'active' : undefined)}>{e.texto}</NavLink>}
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
                {despues}
            </div>
        </header>
    );
}

export function Pie() {
    return <footer><p>&copy; {new Date().getFullYear()} LearnTrack. Todos los derechos reservados.</p></footer>;
}
