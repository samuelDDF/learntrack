// ZONA PÚBLICA: inicio, páginas informativas y 404, con la ventana de acceso y el contacto flotante.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Cabecera, Pie } from '../comun/Cabecera.jsx';
import { useUsuario } from '../comun/useUsuario.js';
import { cerrarSesion } from '../comun/sesion.js';
import { ContextoAcceso, DialogoAcceso } from './acceso.jsx';
import { ContactoFlotante } from './ContactoFlotante.jsx';
import { Inicio } from './paginas/Inicio.jsx';
import { InfoPlanificador } from './paginas/InfoPlanificador.jsx';
import { InfoAsistente } from './paginas/InfoAsistente.jsx';
import { NoEncontrada } from './paginas/NoEncontrada.jsx';
import { RUTA_PANEL } from '../rutas.js';
import './estilos/acceso.css';
import './estilos/inicio.css';
import './estilos/paginas-info.css';
import { navegador } from '../api/cliente.js';

const PAGINAS = {
    '/': { Componente: Inicio, titulo: 'LearnTrack | Organiza tu vida y aprende mejor' },
    '/planificador': { Componente: InfoPlanificador, titulo: 'Planificador inteligente | LearnTrack' },
    '/asistente': { Componente: InfoAsistente, titulo: 'Asistente con IA Local | LearnTrack' }
};
const ENLACES = [
    { a: '/', texto: 'Inicio' },
    { a: '/planificador', texto: 'Planificador' },
    { a: '/asistente', texto: 'Asistente IA' }
];

function NavAcceso({ usuario, abrir }) {
    const [saliendo, setSaliendo] = useState(false);
    return (
        <div className="nav-acceso" id="nav-acceso">
            {usuario ? (
                <>
                    <a className="btn btn-header btn-header-sec" href={RUTA_PANEL}>Mi panel</a>
                    <button type="button" className="btn btn-header btn-header-sec" disabled={saliendo}
                        onClick={() => { setSaliendo(true); cerrarSesion('/'); }}>Cerrar sesión</button>
                </>
            ) : (
                <button type="button" className="btn btn-header btn-header-sec" data-auth="login" onClick={() => abrir('login')}>Iniciar sesión / Registro</button>
            )}
        </div>
    );
}

export default function ZonaPublica() {
    const { pathname, search, hash } = useLocation();
    const navegar = useNavigate();
    const { usuario, cargando } = useUsuario();
    const [pestana, setPestana] = useState(null);           // null | 'login' | 'registro'
    const pagina = PAGINAS[pathname];
    const Pagina = pagina?.Componente ?? NoEncontrada;

    useEffect(() => {
        document.title = pagina?.titulo ?? 'Página no encontrada | LearnTrack';
        document.body.className = '';
        let robots = null;
        if (!pagina) {
            robots = document.createElement('meta');
            robots.name = 'robots'; robots.content = 'noindex';
            document.head.append(robots);
        }
        return () => robots?.remove();
    }, [pagina]);

    // /?acceso=login lo usa el servidor al redirigir desde una página privada sin sesión
    useEffect(() => {
        if (cargando) return;
        const pedido = new URLSearchParams(search).get('acceso');
        if (pedido !== 'login' && pedido !== 'registro') return;
        navegar({ pathname, hash }, { replace: true });
        if (usuario) navegador.irA(RUTA_PANEL); else setPestana(pedido);
    }, [cargando, search, usuario, navegar, pathname, hash]);

    // Desplazamiento a las anclas (#servicios) tras navegar
    useEffect(() => {
        if (!hash) { window.scrollTo(0, 0); return; }
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    }, [pathname, hash]);

    const abrir = useCallback((cual) => setPestana(cual === 'registro' ? 'registro' : 'login'), []);
    const contexto = useMemo(() => ({ usuario, abrir }), [usuario, abrir]);

    return (
        <ContextoAcceso.Provider value={contexto}>
            <Cabecera enlaces={ENLACES} logoInterno despues={<NavAcceso usuario={usuario} abrir={abrir} />} />
            <Pagina />
            {pagina ? <ContactoFlotante /> : null}
            <Pie />
            <DialogoAcceso pestana={pestana} alCerrar={() => setPestana(null)} alCambiarPestana={setPestana} />
        </ContextoAcceso.Provider>
    );
}
