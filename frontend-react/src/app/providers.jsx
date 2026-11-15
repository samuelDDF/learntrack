// Proveedores GLOBALES, en este orden (cada uno puede usar los de fuera):
//   LimiteErrores   → si algo falla, aviso útil en lugar de una página en blanco
//   ProveedorAuth   → sesión (usuario, entrar, salir, verificar el correo)
//   ProveedorTema   → apariencia de la cuenta y zona visual (pública / privada)
//   ProveedorAvisos → avisos flotantes accesibles («Actividad guardada», «Deshacer»…)
import { LimiteErrores } from '../components/common/LimiteErrores.jsx';
import { ProveedorAuth } from '../contexts/AuthContext.jsx';
import { ProveedorTema } from '../contexts/TemaContext.jsx';
import { ProveedorAvisos } from '../contexts/NotificacionesContext.jsx';

export function Proveedores({ children }) {
    return (
        <LimiteErrores>
            <ProveedorAuth>
                <ProveedorTema>
                    <ProveedorAvisos>{children}</ProveedorAvisos>
                </ProveedorTema>
            </ProveedorAuth>
        </LimiteErrores>
    );
}
