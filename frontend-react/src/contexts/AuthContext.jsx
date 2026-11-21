// Estado GLOBAL de la sesión: quién es la persona y las acciones de acceso (entrar, crear cuenta, verificar el
// correo, salir). Todo pasa por el servicio de autenticación (features/auth/services/auth.service.js); aquí no hay
// ningún secreto: la sesión es una cookie HttpOnly que JavaScript no ve.
//  · Una sola petición /api/auth/me por carga (la reutiliza del script tema-inicial.js si ya la hizo).
//  · Si el servidor responde 401 en una petición privada (sesión caducada), el usuario pasa a null y RutaPrivada
//    lleva a /login sin recargar la página.
//  · Entrar o salir NO recarga la página: la SPA cambia de rutas y el servidor sigue protegiendo cada petición.
//  · salida: a dónde ir tras cerrar sesión A PROPÓSITO («/» o «/login» al cambiar de cuenta). RutaPrivada lo usa en
//    lugar de /login; se olvida en cuanto la persona ya está fuera de la zona privada.
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { auth } from '../features/auth/services/auth.service.js';
import { EVENTO_SESION_CADUCADA, EVENTO_CUENTA_PENDIENTE } from '../services/http.js';
import { actualizarUsuario, alActualizarUsuario, fijarUsuario, obtenerUsuario } from '../services/sesion.js';
import { RUTAS_PRIVADAS } from '../app/rutas.js';

export const AuthContext = createContext(null);

export function ProveedorAuth({ children }) {
    const [estado, setEstado] = useState({ usuario: null, cargando: true });
    const [salida, setSalida] = useState(null);
    const { pathname } = useLocation();

    useEffect(() => {
        let vivo = true;
        obtenerUsuario().then((u) => { if (vivo) setEstado({ usuario: u, cargando: false }); });
        const quitar = alActualizarUsuario((u) => { if (vivo) setEstado({ usuario: u, cargando: false }); });
        const alCaducar = () => fijarUsuario(null);
        // v3.13: el servidor exige algo pendiente (documentos, representante): se recarga quién soy
        const alPendiente = () => obtenerUsuario({ refrescar: true });
        window.addEventListener(EVENTO_SESION_CADUCADA, alCaducar);
        window.addEventListener(EVENTO_CUENTA_PENDIENTE, alPendiente);
        return () => {
            vivo = false; quitar();
            window.removeEventListener(EVENTO_SESION_CADUCADA, alCaducar);
            window.removeEventListener(EVENTO_CUENTA_PENDIENTE, alPendiente);
        };
    }, []);

    useEffect(() => { if (salida && !RUTAS_PRIVADAS.includes(pathname)) setSalida(null); }, [salida, pathname]);

    const refrescar = useCallback(() => obtenerUsuario({ refrescar: true }), []);

    /** Respuesta { ok, status, data } del servidor; si fue bien, el usuario ya está cargado al volver */
    const iniciarSesion = useCallback(async (email, password) => {
        const r = await auth.login(email, password);
        if (r.ok) await refrescar();
        return r;
    }, [refrescar]);

    /** v3.13: datos = { aceptaDocumentos, versiones, fechaNacimiento, representante? } (el servidor los vuelve a validar) */
    const registrar = useCallback((nombre, email, password, datos = {}) => auth.registro(nombre, email, password, datos), []);

    const verificarCorreo = useCallback(async (codigo) => {
        const r = await auth.verificarCorreo(codigo);
        if (r.ok) await refrescar();
        return r;
    }, [refrescar]);

    /** Cierra la sesión EN EL SERVIDOR (borra el token de la base de datos) y olvida el usuario en la app */
    const cerrarSesion = useCallback(async ({ destino = '/' } = {}) => {
        try { await auth.logout(); } catch { /* sin red: igualmente se olvida aquí; la cookie caduca sola */ }
        setSalida(destino);
        fijarUsuario(null);
    }, []);

    /** La sesión ya terminó en el servidor (p. ej. tras eliminar la cuenta): solo se olvida en la app */
    const olvidarSesion = useCallback(({ destino = '/' } = {}) => {
        setSalida(destino);
        fijarUsuario(null);
    }, []);

    const valor = useMemo(() => ({
        usuario: estado.usuario,
        cargando: estado.cargando,
        autenticado: Boolean(estado.usuario),
        salida,
        iniciarSesion, registrar, verificarCorreo, cerrarSesion, olvidarSesion, refrescar,
        actualizarUsuario,
        reenviarCodigo: auth.reenviarCodigo,
        estadoVerificacion: auth.estadoVerificacion
    }), [estado, salida, iniciarSesion, registrar, verificarCorreo, cerrarSesion, olvidarSesion, refrescar]);

    return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}
