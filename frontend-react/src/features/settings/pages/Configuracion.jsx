// Configuración (/configuracion): Voz de la IA (nombre y voz) · Estética (temas, paleta con Colormind, fondo) ·
// Cuentas vinculadas · Notificaciones. (Información básica y Privacidad y seguridad están en Mi perfil, /perfil.)
// Los colores se aplican con CSSOM (la CSP no permite style="").
import { PaginaConPestanas } from '../../../components/layout/privado/PaginaConPestanas.jsx';
import { seccionesDe } from '../../../components/layout/privado/seccionesCuenta.js';
import { usePerfil } from '../../profile/hooks/usePerfil.js';
import { SeccionVoz, SeccionEstetica, SeccionCuentas, SeccionNotificaciones } from '../components/secciones.jsx';
import { RUTA_CONFIGURACION } from '../../../app/rutas.js';
import '../configuracion.css';

const SECCIONES = seccionesDe(RUTA_CONFIGURACION);

export default function Configuracion() {
    const { perfil, integraciones, error, pintarTodo, fijarPerfil } = usePerfil();
    const props = { perfil, integraciones, pintarTodo, fijarPerfil };
    return (
        <PaginaConPestanas titulo="Configuración" etiqueta="Secciones de configuración" secciones={SECCIONES}
            perfil={perfil} error={error} textoError="No se pudo cargar tu configuración" textoCargando="Cargando tu configuración…"
            paneles={perfil ? {
                voz: <SeccionVoz {...props} />,
                estetica: <SeccionEstetica {...props} />,
                cuentas: <SeccionCuentas {...props} />,
                notificaciones: <SeccionNotificaciones {...props} />
            } : {}} />
    );
}
