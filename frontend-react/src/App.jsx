// Enrutado de primer nivel. Dos ZONAS que se descargan por separado:
//  · pública  (/, /planificador, /asistente y la página 404): código en r/publico, sin sesión.
//  · privada  (/panel, /calendario, /proyectos, /repaso, /configuracion): código en r/privado, que Express SOLO
//    entrega con sesión. Ojo: cargar la zona privada de forma diferida NO la protege por sí solo; la protección real
//    es el servidor (páginas privadas con requiereSesionPagina, archivos de r/privado con requiereSesionRecurso y
//    toda la API con requiereAuthApi).
// Entre zonas se navega con recarga completa (<a href>): cada zona trae sus propios estilos y así no se mezclan.
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Cargando } from './comun/ui/Cargando.jsx';
import { LimiteErrores } from './comun/ui/LimiteErrores.jsx';
import { RUTAS_PRIVADAS } from './rutas.js';

const ZonaPublica = lazy(() => import('./publico/ZonaPublica.jsx'));
const ZonaPrivada = lazy(() => import('./privado/ZonaPrivada.jsx'));

export default function App() {
    return (
        <LimiteErrores>
            <Suspense fallback={<Cargando pantalla texto="Cargando LearnTrack…" />}>
                <Routes>
                    {RUTAS_PRIVADAS.map((r) => <Route key={r} path={r} element={<ZonaPrivada />} />)}
                    <Route path="*" element={<ZonaPublica />} />
                </Routes>
            </Suspense>
        </LimiteErrores>
    );
}
