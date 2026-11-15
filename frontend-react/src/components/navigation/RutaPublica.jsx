// Guardia de las rutas SOLO para personas sin sesión (/login, /registro, /verificar-correo): con sesión abierta no
// tiene sentido volver a entrar, así que lleva al panel (o a la página privada que se quería ver antes de entrar).
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { destinoTrasEntrar } from '../../app/rutas.js';

export function RutaPublica({ children }) {
    const { autenticado, cargando } = useAuth();
    const { state } = useLocation();
    if (cargando) return null;               // la página de fondo ya se ve; la ventana aparece en cuanto se sabe
    if (autenticado) return <Navigate to={destinoTrasEntrar(state?.desde)} replace />;
    return children ?? <Outlet />;
}
