// Menú del engranaje: secciones de Configuración (desplegable accesible con teclado: ↓ abre, ↑/↓ recorren, Esc cierra)
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

export const SECCIONES_CONFIGURACION = [
    { id: 'informacion', icono: '👤', texto: 'Información básica' },
    { id: 'voz', icono: '🗣️', texto: 'Voz de la IA' },
    { id: 'estetica', icono: '🎨', texto: 'Estética de la página' },
    { id: 'cuentas', icono: '🔗', texto: 'Cuentas vinculadas' },
    { id: 'notificaciones', icono: '🔔', texto: 'Notificaciones' },
    { id: 'privacidad', icono: '🔒', texto: 'Privacidad y seguridad' }
];

export function IconoEngranaje() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

export function MenuConfiguracion() {
    const [abierto, setAbierto] = useState(false);
    const envoltorio = useRef(null);
    const boton = useRef(null);
    const menu = useRef(null);
    const { pathname } = useLocation();
    const enlaces = () => [...(menu.current?.querySelectorAll('a') ?? [])];

    useEffect(() => {
        if (!abierto) return undefined;
        const alClic = (e) => { if (!envoltorio.current?.contains(e.target)) setAbierto(false); };
        const alTeclear = (e) => { if (e.key === 'Escape') { setAbierto(false); boton.current?.focus(); } };
        document.addEventListener('click', alClic);
        document.addEventListener('keydown', alTeclear);
        return () => { document.removeEventListener('click', alClic); document.removeEventListener('keydown', alTeclear); };
    }, [abierto]);

    return (
        <div className="barra-config" ref={envoltorio}
            onBlur={(e) => { if (abierto && e.relatedTarget && !envoltorio.current.contains(e.relatedTarget)) setAbierto(false); }}>
            <button ref={boton} type="button" id="btn-configuracion" className={`barra-icono barra-engranaje${pathname === '/configuracion' ? ' activo' : ''}`}
                aria-haspopup="true" aria-expanded={abierto} aria-controls="menu-configuracion" title="Configuración"
                onClick={() => setAbierto((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); requestAnimationFrame(() => enlaces()[0]?.focus()); } }}>
                <IconoEngranaje /><span className="solo-lectores">Configuración</span>
            </button>
            <div ref={menu} className="barra-desplegable" id="menu-configuracion" hidden={!abierto}
                onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    e.preventDefault();
                    const lista = enlaces();
                    const i = lista.indexOf(document.activeElement);
                    lista[(i + (e.key === 'ArrowDown' ? 1 : -1) + lista.length) % lista.length]?.focus();
                }}>
                <p className="barra-desplegable-titulo">Configuración</p>
                <ul>
                    {SECCIONES_CONFIGURACION.map((s) => (
                        <li key={s.id}>
                            <Link to={`/configuracion#${s.id}`} data-seccion={s.id} onClick={() => setAbierto(false)}>
                                <span aria-hidden="true">{s.icono}</span><span>{s.texto}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
