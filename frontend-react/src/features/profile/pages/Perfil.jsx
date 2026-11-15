// Mi perfil (/perfil): Información básica (foto, nombre, correo) y Privacidad y seguridad (contraseña y baja).
// Antes eran dos pestañas de Configuración; las direcciones antiguas (/configuracion#informacion…) llevan aquí.
import { PaginaConPestanas } from '../../../components/layout/privado/PaginaConPestanas.jsx';
import { seccionesDe } from '../../../components/layout/privado/seccionesCuenta.js';
import { usePerfil } from '../hooks/usePerfil.js';
import { SeccionInformacion } from '../components/SeccionInformacion.jsx';
import { SeccionPrivacidad } from '../components/SeccionPrivacidad.jsx';
import { RUTA_PERFIL } from '../../../app/rutas.js';
import '../../settings/configuracion.css';

const SECCIONES = seccionesDe(RUTA_PERFIL);

export default function Perfil() {
    const { perfil, error, pintarTodo, fijarPerfil } = usePerfil();
    const props = { perfil, pintarTodo, fijarPerfil };
    return (
        <PaginaConPestanas titulo="Mi perfil" etiqueta="Secciones de mi perfil" secciones={SECCIONES}
            perfil={perfil} error={error} textoError="No se pudo cargar tu perfil" textoCargando="Cargando tu perfil…"
            paneles={perfil ? {
                informacion: <SeccionInformacion {...props} />,
                privacidad: <SeccionPrivacidad {...props} />
            } : {}} />
    );
}
