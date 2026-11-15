// Sesión actual y acciones de acceso (ver contexts/AuthContext.jsx)
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';

/** { usuario, cargando, autenticado, iniciarSesion, registrar, verificarCorreo, cerrarSesion, refrescar, … } */
export function useAuth() {
    const valor = useContext(AuthContext);
    if (!valor) throw new Error('useAuth() debe usarse dentro de <ProveedorAuth>.');
    return valor;
}
