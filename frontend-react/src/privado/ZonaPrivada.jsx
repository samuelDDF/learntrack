// ZONA PRIVADA (Mi panel, Mi agenda, Proyectos, Repaso y Configuración). Este código solo se descarga con sesión
// (Express protege /r/privado). Aun así, la comprobación que cuenta es la del servidor en cada petición a la API:
// aquí solo se evita pintar la interfaz si la sesión no existe (y se va al acceso).
import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router';
import { Cabecera, Pie } from '../comun/Cabecera.jsx';
import { Cargando } from '../comun/ui/Cargando.jsx';
import { ProveedorAvisos } from '../comun/ui/Avisos.jsx';
import { LimiteErrores } from '../comun/ui/LimiteErrores.jsx';
import { useUsuario } from '../comun/useUsuario.js';
import { RUTA_ACCESO, navegador } from '../api/cliente.js';
import { BarraCuenta } from './barra/BarraCuenta.jsx';
import './estilos/temas.css';
import './estilos/privado.css';

const PAGINAS = {
    '/panel': { Componente: lazy(() => import('./paginas/panel/Panel.jsx')), titulo: 'Mi panel', clase: '' },
    '/calendario': { Componente: lazy(() => import('./paginas/agenda/Agenda.jsx')), titulo: 'Mi agenda', clase: 'pagina-cal' },
    '/proyectos': { Componente: lazy(() => import('./paginas/proyectos/Proyectos.jsx')), titulo: 'Proyectos', clase: 'pagina-proyectos' },
    '/repaso': { Componente: lazy(() => import('./paginas/repaso/Repaso.jsx')), titulo: 'Repaso', clase: 'pagina-repaso' },
    '/configuracion': { Componente: lazy(() => import('./paginas/configuracion/Configuracion.jsx')), titulo: 'Configuración', clase: 'pagina-configuracion' }
};
const ENLACES = [
    { a: '/panel', texto: 'Mi panel' },
    { a: '/calendario', texto: 'Mi agenda' },
    { a: '/proyectos', texto: 'Proyectos' },
    { a: '/repaso', texto: 'Repaso' }
];

export default function ZonaPrivada() {
    const { pathname } = useLocation();
    const { usuario, cargando } = useUsuario();
    const pagina = PAGINAS[pathname] ?? PAGINAS['/panel'];
    const { Componente } = pagina;

    useEffect(() => {
        document.title = `${pagina.titulo} | LearnTrack`;
        document.body.className = ['zona-privada', pagina.clase].filter(Boolean).join(' ');
        window.scrollTo(0, 0);
    }, [pagina]);

    useEffect(() => {
        if (!cargando && !usuario) navegador.irA(RUTA_ACCESO);
    }, [cargando, usuario]);

    if (cargando || !usuario) return <Cargando pantalla texto="Comprobando tu sesión…" />;

    return (
        <ProveedorAvisos>
            <Cabecera enlaces={ENLACES} antes={<BarraCuenta usuario={usuario} />}
                despues={<span className="saludo-usuario" id="saludo-usuario">{usuario.nombre ? `Hola, ${usuario.nombre.split(' ')[0]}` : ''}</span>} />
            <LimiteErrores key={pathname}>
                <Suspense fallback={<Cargando pantalla texto={`Cargando ${pagina.titulo.toLowerCase()}…`} />}>
                    <Componente usuario={usuario} />
                </Suspense>
            </LimiteErrores>
            <Pie />
        </ProveedorAvisos>
    );
}
