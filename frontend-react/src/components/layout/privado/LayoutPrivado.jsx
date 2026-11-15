// Diseño de la ZONA PRIVADA (Mi panel, Mi agenda, Proyectos, Repaso, Bienestar, Papelera, Mi perfil y Configuración).
// Este código solo se descarga con sesión (Express protege /r/privado) y solo se monta dentro de RutaPrivada. Aun así,
// la comprobación que cuenta es la del servidor en cada petición a la API.
//  · Marca la zona visual (clase «zona-privada» en <html> y <body>): los temas y estilos privados solo actúan bajo
//    esa clase, así que al volver a una página pública sin recargar no queda nada «pegado».
//  · Cada página tiene su propio límite de errores y su indicador de carga (las páginas se descargan al pedirlas).
import { Suspense, useLayoutEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Cabecera, Pie } from '../Cabecera.jsx';
import { Cargando } from '../../common/Cargando.jsx';
import { LimiteErrores } from '../../common/LimiteErrores.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { useTema } from '../../../hooks/useTema.js';
import { BarraCuenta } from './BarraCuenta.jsx';
import { NAVEGACION_PRIVADA, PAGINAS_PRIVADAS } from '../../../app/rutas.js';
import '../../../styles/privado/temas.css';
import '../../../styles/privado/privado.css';
import '../../../styles/privado/animaciones-privado.css';

export default function LayoutPrivado() {
    const { pathname } = useLocation();
    const { usuario } = useAuth();
    const { usarZonaPrivada } = useTema();
    const pagina = PAGINAS_PRIVADAS[pathname] ?? PAGINAS_PRIVADAS['/panel'];

    // Antes de pintar (useLayoutEffect): la página privada nunca se ve ni un instante con los colores públicos
    useLayoutEffect(() => usarZonaPrivada(pagina.clase), [usarZonaPrivada, pagina.clase]);

    const nombre = usuario?.nombre ? `Hola, ${usuario.nombre.split(' ')[0]}` : '';
    return (
        <>
            <Cabecera enlaces={NAVEGACION_PRIVADA} antes={<BarraCuenta usuario={usuario} />}
                despues={<span className="saludo-usuario" id="saludo-usuario">{nombre}</span>} />
            <LimiteErrores key={pathname}>
                <Suspense fallback={<Cargando pantalla texto={`Cargando ${pagina.titulo.toLowerCase()}…`} />}>
                    <Outlet />
                </Suspense>
            </LimiteErrores>
            <Pie />
        </>
    );
}
