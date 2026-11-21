// Guardia del panel de administración (v3.13). Solo decide QUÉ PINTAR: la protección real es el servidor (la página
// /admin y toda /api/admin responden 404 a cualquier cuenta que no sea la de administración, con o sin sesión).
// A quien no es administrador se le muestra la misma página 404 que a una dirección inexistente.
import { Suspense } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { Cargando } from '../common/Cargando.jsx';
import LayoutPublico from '../layout/LayoutPublico.jsx';
import { NoEncontrada } from '../../features/landing/pages/NoEncontrada.jsx';

export function RutaAdmin({ children }) {
    const { usuario, cargando } = useAuth();
    if (cargando) return <Cargando pantalla texto="Comprobando tu sesión…" />;
    if (!usuario?.esAdmin) return <LayoutPublico><NoEncontrada /></LayoutPublico>;
    return <Suspense fallback={<Cargando pantalla texto="Cargando…" />}>{children}</Suspense>;
}
