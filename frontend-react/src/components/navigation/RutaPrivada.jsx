// Guardia de las rutas privadas. Solo decide QUÉ PINTAR: la protección real está en el servidor (la página privada
// sin sesión responde 302 a /login, el código de /r/privado exige sesión y cada petición a la API se autoriza).
//  · Mientras se comprueba la sesión: indicador de carga (nunca se pinta contenido privado sin usuario).
//  · Sin sesión: a /login, recordando la página pedida (estado del historial, no la URL) para volver tras entrar.
//  · Tras «Cerrar sesión» o «Cambiar de cuenta»: al destino elegido («/» o «/login»).
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { Cargando } from '../common/Cargando.jsx';
import { RUTA_LOGIN } from '../../app/rutas.js';

export function RutaPrivada({ children }) {
    const { autenticado, cargando, salida } = useAuth();
    const { pathname, search, hash } = useLocation();
    if (cargando) return <Cargando pantalla texto="Comprobando tu sesión…" />;
    if (!autenticado) {
        return salida
            ? <Navigate to={salida} replace />
            : <Navigate to={RUTA_LOGIN} replace state={{ desde: { pathname, search, hash } }} />;
    }
    return children ?? <Outlet />;
}
