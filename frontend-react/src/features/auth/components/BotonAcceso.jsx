// Botón de llamada a la acción de las páginas públicas: abre la ventana de acceso (/login o /registro) o, con
// sesión abierta, lleva al panel. Nunca recarga la página.
import { Link } from 'react-router';
import { useAuth } from '../../../hooks/useAuth.js';
import { useAcceso } from '../hooks/useAcceso.js';
import { RUTA_PANEL } from '../../../app/rutas.js';

export function BotonAcceso({ cual = 'login', children, className = 'btn' }) {
    const { autenticado } = useAuth();
    const { abrir } = useAcceso();
    if (autenticado) return <Link className={className} to={RUTA_PANEL}>Ir a mi panel</Link>;
    return <button type="button" className={className} data-auth={cual} onClick={() => abrir(cual)}>{children}</button>;
}
