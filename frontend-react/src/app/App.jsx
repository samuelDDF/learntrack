// Aplicación: proveedores globales + enrutador central. El BrowserRouter (único) está en main.jsx.
import { Suspense } from 'react';
import { Proveedores } from './providers.jsx';
import { Enrutador } from './router.jsx';
import { Cargando } from '../components/common/Cargando.jsx';

export default function App() {
    return (
        <Proveedores>
            <Suspense fallback={<Cargando pantalla texto="Cargando LearnTrack…" />}>
                <Enrutador />
            </Suspense>
        </Proveedores>
    );
}
