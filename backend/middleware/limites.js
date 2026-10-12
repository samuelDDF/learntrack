// Límites de peticiones. Los de acceso van por IP y por cuenta; los del asistente y el perfil, por usuario.
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { normalizarEmail } from '../validacion/index.js';

const QUINCE_MIN = 15 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;

/** @param {object} limites sobrescribe los máximos (lo usan las pruebas): { api, chat, archivos, consejo, registro, perfilSensible, externos } */
export function crearLimitadores(limites = {}) {
    const L = { api: 300, chat: 30, archivos: 6, consejo: 20, registro: 8, perfilSensible: 8, externos: 30, ...limites };
    const limite = (windowMs, limit, mensaje, extra = {}) => rateLimit({
        windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: mensaje }, ...extra
    });
    const porIp = { keyGenerator: (req) => ipKeyGenerator(req.ip) };
    const porUsuario = { keyGenerator: (req) => `usuario:${req.usuario.id}` };
    const soloFallos = { skipSuccessfulRequests: true };

    return {
        api: limite(QUINCE_MIN, L.api, 'Demasiadas peticiones desde esta IP. Intenta de nuevo más tarde.'),
        loginIp: limite(QUINCE_MIN, 15, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.', { ...porIp, ...soloFallos }),
        loginCuenta: limite(QUINCE_MIN, 5, 'Demasiados intentos fallidos para esta cuenta. Espera 15 minutos e inténtalo de nuevo.', {
            ...soloFallos, keyGenerator: (req) => `cuenta:${normalizarEmail(req.body?.email) || ipKeyGenerator(req.ip)}`
        }),
        registro: limite(UNA_HORA, L.registro, 'Se crearon demasiadas cuentas desde esta IP. Inténtalo más tarde.', porIp),
        contacto: limite(UNA_HORA, 5, 'Has enviado demasiados mensajes. Inténtalo más tarde.', porIp),
        // Tres límites separados por usuario para el asistente: chat, archivos (más estricto) y consejo
        chat: limite(QUINCE_MIN, L.chat, 'Has escrito muchas veces al asistente. Espera unos minutos.', porUsuario),
        archivos: limite(QUINCE_MIN, L.archivos, 'Has subido demasiados archivos. Espera 15 minutos.', porUsuario),
        consejo: limite(QUINCE_MIN, L.consejo, 'Has pedido demasiados consejos. Espera unos minutos.', porUsuario),
        // Llamadas a APIs externas (Colormind, Nager.Date): por usuario, para no abusar de servicios gratuitos
        externos: limite(QUINCE_MIN, L.externos, 'Demasiadas consultas a servicios externos. Espera unos minutos.', porUsuario),
        // Acciones que piden la contraseña (cambiar correo/clave, borrar cuenta): solo cuentan los intentos fallidos
        perfilSensible: limite(QUINCE_MIN, L.perfilSensible, 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.', { ...porUsuario, ...soloFallos })
    };
}
