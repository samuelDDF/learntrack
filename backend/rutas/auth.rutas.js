// /api/auth: registro con verificación del correo (v3.10), inicio y cierre de sesión, y quién soy.
//
// Flujo de una cuenta nueva:
//   POST /registro            valida, crea la cuenta PENDIENTE (sin sesión), envía el código y pone la cookie
//                             temporal lt_verif → 202 { verificacion }
//   POST /verificar-correo    { codigo } + cookie lt_verif → marca el correo como verificado y ENTONCES inicia la
//                             sesión normal → 200 { usuario }
//   POST /reenviar-codigo     cookie lt_verif → código nuevo (el anterior deja de valer) → 200 { verificacion }
//   GET  /verificacion        cookie lt_verif → estado (correo oculto, tiempo restante) para retomar el proceso
//   POST /login               cuenta pendiente con la contraseña correcta → 403 { codigo: 'verificacion_pendiente',
//                             verificacion } (sin sesión; si no tiene un código vigente se le envía uno)
// Ninguna respuesta contiene el código, su hash ni el token.
import express from 'express';
import * as db from '../datos/index.js';
import { hashPassword, verificarPassword, gastarTiempoDeLogin } from '../servicios/cuenta/contrasenas.js';
import {
    iniciarSesion, cerrarSesion, ponerCookieVerificacion, borrarCookieVerificacion, leerTokenVerificacion,
    estaSuspendida, DURACION_ADMIN_MS
} from '../middleware/autenticacion.js';
import { aceptacionesVigentes, VERSIONES_VIGENTES } from '../servicios/cuenta/legal.js';
import { nuevoToken, hashToken as hashTokenRepresentante, esTokenValido, permisoReenvio, estadoRepresentante, VIDA_ENLACE_MS } from '../servicios/cuenta/representante.js';
import { enviarAutorizacionRepresentante } from '../servicios/cuenta/correo.js';
import { ahoraEn } from '../servicios/tiempo.js';
import { validarRegistro, validarLogin } from '../validacion/index.js';
import {
    configVerificacion, generarCodigo, esCodigoValido, hashCodigo, codigoCoincide, nuevoTokenVerificacion, hashToken,
    puedeEntrar, estadoPublico, permisoEnvio, nuevaVerificacion, textoEspera, VIDA_REGISTRO_PENDIENTE_MS, VIDA_TOKEN_MS
} from '../servicios/cuenta/verificacion-correo.js';
import { enviarCodigoVerificacion, correoDisponible, ErrorCorreo } from '../servicios/cuenta/correo.js';

const MENSAJE_DUPLICADO = 'Ese correo ya está registrado. Inicia sesión.';
const MENSAJE_SIN_CORREO = 'El registro de cuentas nuevas no está disponible en este momento. Inténtalo más tarde.';
const MENSAJE_CORREO_FALLO = 'No pudimos enviar el correo con el código. Comprueba tu dirección o pulsa «Reenviar código» en unos minutos.';
const MENSAJE_SIN_VERIFICACION = 'Esta verificación ya terminó o caducó. Inicia sesión con tu correo y tu contraseña para continuar.';
const MENSAJE_SUSPENDIDA = 'Tu cuenta está suspendida. Si crees que es un error, escribe al correo de contacto de LearnTrack.';
const MENSAJE_ENLACE_INVALIDO = 'Este enlace ya no es válido: caducó, ya se usó o la cuenta ya no existe.';

/**
 * Dirección pública de la app para el enlace del representante. En producción (frontend en GitHub Pages y API en
 * Railway) debe configurarse URL_PUBLICA_APP (p. ej. https://usuario.github.io/learntrack); si no, se usa el origen
 * de la petición (válido cuando la app y la API comparten dominio).
 */
function urlPublicaApp(req) {
    const configurada = String(process.env.URL_PUBLICA_APP || '').trim();
    if (/^https?:\/\/[^\s]+$/i.test(configurada)) return configurada.replace(/\/+$/, '');
    return (req.get('origin') || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

/** Mensaje de espera (sin decir cuántos envíos lleva ni nada del correo) */
const mensajeEspera = (permiso) => (permiso.motivo === 'limite'
    ? `Se han enviado demasiados códigos a este correo. Podrás pedir otro en ${textoEspera(permiso.esperaS)}.`
    : `Ya te enviamos un código hace un momento. Podrás pedir otro en ${textoEspera(permiso.esperaS)}.`);

export function crearRutasAuth(limites) {
    const rutas = express.Router();

    /**
     * Genera un código nuevo para `usuario`, lo guarda (hash) de forma atómica, renueva el token del navegador y
     * envía el correo. Devuelve { ok, token, estado } o { ok: false, status, cuerpo }.
     */
    async function emitirCodigo(usuario, { extra = {}, cfg = configVerificacion() } = {}) {
        const ahora = Date.now();
        const v = usuario.verificacionEmail;
        const permiso = permisoEnvio(v, ahora, cfg);
        if (!permiso.permitido) return { ok: false, status: 429, cuerpo: { error: mensajeEspera(permiso), codigo: 'espera', reenviarEnSegundos: permiso.esperaS } };
        const codigo = generarCodigo();
        const { token, tokenHash } = nuevoTokenVerificacion();
        const verificacion = nuevaVerificacion({ codigoHash: await hashCodigo(codigo, usuario.id), tokenHash, permiso, ahora, config: cfg });
        // Solo gana UNA petición simultánea (el filtro exige el último envío leído)
        if (!await db.reemplazarVerificacionBD(usuario.id, v?.ultimoEnvio ?? null, verificacion, extra)) {
            return { ok: false, status: 429, cuerpo: { error: 'Ya se está enviando un código a este correo. Espera un momento.', codigo: 'espera', reenviarEnSegundos: cfg.esperaReenvioS } };
        }
        const estadoTras = (ver) => estadoPublico({ email: usuario.email, verificacionEmail: ver }, Date.now(), cfg);
        try {
            await enviarCodigoVerificacion({ para: usuario.email, nombre: extra.nombre ?? usuario.nombre, codigo, minutos: cfg.minutos });
        } catch (e) {
            if (!(e instanceof ErrorCorreo)) throw e;
            await db.anularEnvioBD(usuario.id, verificacion.ultimoEnvio);
            return { ok: false, token, status: 503, cuerpo: { error: MENSAJE_CORREO_FALLO, codigo: 'correo_no_enviado', verificacion: estadoTras({ ...verificacion, codigoHash: null, ultimoEnvio: null }) } };
        }
        return { ok: true, token, estado: estadoTras(verificacion) };
    }

    /** La verificación en curso de ESTE navegador, o null (y borra una cookie que ya no sirve) */
    async function verificacionDelNavegador(req, res) {
        const token = leerTokenVerificacion(req);
        const usuario = token ? await db.pendientePorTokenBD(hashToken(token)) : null;
        if (!usuario && token) borrarCookieVerificacion(res);
        return usuario;
    }

    // Quién soy + lo que necesitan todas las páginas privadas: apariencia (tema, paleta, fondo), voz y avatar
    rutas.get('/me', (req, res) => {
        const u = req.usuario;
        if (!u) return res.json({ usuario: null });
        const { id, nombre, email, temaSeleccionado, variablesTema, imagenFondoUrl, vozAsistente, nombreIA, avatarUrl } = u;
        const extra = {};
        // v3.13: solo la propia cuenta de administración se entera de que lo es; las demás no reciben ningún campo de rol
        if (u.rol === 'admin') extra.esAdmin = true;
        if (u.documentosPendientes?.length) extra.documentosPendientes = { documentos: u.documentosPendientes, versiones: VERSIONES_VIGENTES };
        if (u.esperaRepresentante) extra.representante = estadoRepresentante(u.representanteLegal);
        res.json({ usuario: { id, nombre, email, temaSeleccionado, variablesTema, imagenFondoUrl, vozAsistente, nombreIA, avatarUrl, ...extra } });
    });

    // Paso 1: datos válidos → cuenta pendiente + código por correo. NO inicia sesión.
    rutas.post('/registro', limites.registro, async (req, res) => {
        const hoy = ahoraEn().fecha;
        const { error, codigo, status, valor } = validarRegistro(req.body, { hoy });
        if (error) return res.status(status ?? 400).json({ error, ...(codigo ? { codigo } : {}) });
        // v3.13: evidencia de la aceptación (versión + huella del texto + fecha) y, si es menor, su representante
        const legales = {
            fechaNacimiento: valor.fechaNacimiento,
            aceptacionesLegales: aceptacionesVigentes('registro'),
            representanteLegal: valor.representante ? { ...valor.representante, declaradoEn: new Date(), estado: 'pendiente' } : null
        };
        if (!correoDisponible()) return res.status(503).json({ error: MENSAJE_SIN_CORREO, codigo: 'correo_no_disponible' });
        const cfg = configVerificacion();
        const existente = await db.buscarUsuarioPorEmail(valor.email);
        // Una cuenta verificada (o antigua) ya es de alguien: no se toca
        if (existente && existente.emailVerificado !== false) return res.status(409).json({ error: MENSAJE_DUPLICADO });

        const passwordHash = await hashPassword(valor.password);
        let usuario = existente;
        if (existente) {
            // Registro repetido de un correo pendiente. Si es ESTE navegador (su cookie), se retoma sin reenviar.
            const token = leerTokenVerificacion(req);
            const v = existente.verificacionEmail;
            if (token && v?.tokenHash === hashToken(token) && v.codigoHash && new Date(v.expira) > new Date()) {
                await db.actualizarPendienteBD(existente.id, { nombre: valor.nombre, passwordHash, pendienteHasta: new Date(Date.now() + VIDA_REGISTRO_PENDIENTE_MS), ...legales });
                return res.status(202).json({ verificacion: estadoPublico(existente, Date.now(), cfg) });
            }
        } else {
            // Primer registro de este correo: cuenta PENDIENTE (se borra sola si no se verifica en 7 días)
            usuario = { id: db.nuevoId(), nombre: valor.nombre, email: valor.email, verificacionEmail: null };
            const creada = await db.crearPendienteBD({
                id: usuario.id, nombre: valor.nombre, email: valor.email, passwordHash,
                creado: new Date(), pendienteHasta: new Date(Date.now() + VIDA_REGISTRO_PENDIENTE_MS),
                fechaNacimiento: legales.fechaNacimiento, aceptacionesLegales: legales.aceptacionesLegales,
                ...(legales.representanteLegal ? { representanteLegal: legales.representanteLegal } : {})
            });
            // Dos registros simultáneos del mismo correo: el otro ganó
            if (!creada) return res.status(429).json({ error: 'Ya se está creando una cuenta con este correo. Espera un momento.', codigo: 'espera' });
        }
        // En un registro repetido se aplican el nombre y la contraseña NUEVOS (nadie los usó: la cuenta no se verificó),
        // y el código y el token anteriores dejan de valer. Solo quien reciba el correo podrá completarla.
        const extra = existente ? { nombre: valor.nombre, passwordHash, pendienteHasta: new Date(Date.now() + VIDA_REGISTRO_PENDIENTE_MS), ...legales } : {};
        const r = await emitirCodigo(usuario, { extra, cfg });
        if (r.token) ponerCookieVerificacion(res, r.token);
        if (!r.ok) return res.status(r.status).json(r.cuerpo);
        res.status(202).json({ verificacion: r.estado });
    });

    // Paso 2: el código. Solo con la cookie del navegador que se registró (o inició sesión) y con el código vigente.
    rutas.post('/verificar-correo', limites.verificacion, async (req, res) => {
        const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo.replace(/\s/g, '') : req.body?.codigo;
        if (!esCodigoValido(codigo)) return res.status(400).json({ error: 'Escribe los 6 dígitos del código.', codigo: 'formato' });
        const cfg = configVerificacion();
        const usuario = await verificacionDelNavegador(req, res);
        if (!usuario) return res.status(401).json({ error: MENSAJE_SIN_VERIFICACION, codigo: 'sin_verificacion' });
        const v = usuario.verificacionEmail;
        if (!v?.codigoHash) return res.status(410).json({ error: 'Este código ya no es válido. Pide uno nuevo con «Reenviar código».', codigo: 'sin_codigo', verificacion: estadoPublico(usuario, Date.now(), cfg) });
        if (new Date(v.expira) <= new Date()) return res.status(410).json({ error: 'El código ha expirado. Pide uno nuevo con «Reenviar código».', codigo: 'expirado', verificacion: estadoPublico(usuario, Date.now(), cfg) });

        // El intento se gasta ANTES de comparar: ni el doble clic ni peticiones en paralelo dan intentos extra
        if (!await db.reservarIntentoBD(usuario.id, v.codigoHash, cfg.maxIntentos)) {
            await db.anularCodigoBD(usuario.id, v.codigoHash);
            return res.status(429).json({ error: 'Demasiados intentos con este código. Pide uno nuevo con «Reenviar código».', codigo: 'intentos', verificacion: estadoPublico({ ...usuario, verificacionEmail: { ...v, codigoHash: null } }, Date.now(), cfg) });
        }
        if (!await codigoCoincide(codigo, v.codigoHash, usuario.id)) {
            const restantes = Math.max(0, cfg.maxIntentos - ((v.intentos ?? 0) + 1));
            if (restantes === 0) {
                await db.anularCodigoBD(usuario.id, v.codigoHash);
                return res.status(429).json({ error: 'Código incorrecto. Has agotado los intentos: pide un código nuevo con «Reenviar código».', codigo: 'intentos', verificacion: estadoPublico({ ...usuario, verificacionEmail: { ...v, codigoHash: null } }, Date.now(), cfg) });
            }
            return res.status(400).json({ error: `Código incorrecto. Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}.`, codigo: 'incorrecto', intentosRestantes: restantes });
        }
        // Correcto: solo UNA petición puede completar (el filtro exige el mismo código, que se borra al completar)
        const verificado = await db.completarVerificacionBD(usuario.id, v.codigoHash);
        if (!verificado) return res.status(410).json({ error: 'Este código ya se utilizó.', codigo: 'usado' });
        borrarCookieVerificacion(res);
        await iniciarSesion(res, verificado.id);          // la sesión normal empieza AHORA, no antes
        // v3.13: si es menor, ahora (con el correo ya comprobado) se pide la autorización a su representante
        const completo = await db.buscarUsuarioPorId(verificado.id);
        if (completo?.representanteLegal?.estado === 'pendiente') await enviarEnlaceRepresentante(req, completo).catch(() => null);
        res.json({ usuario: { nombre: verificado.nombre, email: verificado.email } });
    });

    // Código nuevo (el anterior deja de valer). Con espera entre envíos y máximo por hora y correo.
    rutas.post('/reenviar-codigo', limites.reenvio, async (req, res) => {
        if (!correoDisponible()) return res.status(503).json({ error: MENSAJE_SIN_CORREO, codigo: 'correo_no_disponible' });
        const usuario = await verificacionDelNavegador(req, res);
        if (!usuario) return res.status(401).json({ error: MENSAJE_SIN_VERIFICACION, codigo: 'sin_verificacion' });
        const r = await emitirCodigo(usuario);
        if (r.token) ponerCookieVerificacion(res, r.token);
        if (!r.ok) return res.status(r.status).json(r.cuerpo);
        res.json({ verificacion: r.estado });
    });

    // Estado de la verificación en curso de este navegador (para retomarla tras recargar o volver más tarde)
    rutas.get('/verificacion', async (req, res) => {
        const usuario = await verificacionDelNavegador(req, res);
        if (!usuario) return res.status(404).json({ error: MENSAJE_SIN_VERIFICACION, codigo: 'sin_verificacion' });
        res.json({ verificacion: estadoPublico(usuario) });
    });

    rutas.post('/login', limites.loginIp, limites.loginCuenta, async (req, res) => {
        const { error, valor } = validarLogin(req.body);
        if (error) return res.status(400).json({ error });
        const usuario = await db.buscarUsuarioPorEmail(valor.email);
        const credencialesOk = usuario
            ? await verificarPassword(valor.password, usuario.passwordHash)
            : (await gastarTiempoDeLogin(valor.password), false);
        if (!credencialesOk) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        // v3.13: cuenta suspendida (solo se dice tras comprobar la contraseña: nadie más puede saberlo)
        if (usuario.estado === 'suspendida') {
            if (estaSuspendida(usuario)) return res.status(403).json({ error: MENSAJE_SUSPENDIDA, codigo: 'cuenta_suspendida' });
            await db.reactivarSuspensionesVencidasBD();
        }
        if (!puedeEntrar(usuario)) return continuarVerificacion(res, usuario);
        if (usuario.rol === 'admin') {
            await iniciarSesion(res, usuario.id, { duracionMs: DURACION_ADMIN_MS });
            await db.registrarAuditoriaBD({ accion: 'inicio_sesion_admin', adminId: usuario.id });
        } else await iniciarSesion(res, usuario.id);
        await db.tocarUltimoAccesoBD(usuario.id).catch(() => {});
        res.json({ usuario: { nombre: usuario.nombre, email: usuario.email } });
    });

    /**
     * Inicio de sesión de una cuenta sin verificar (registro abandonado o cuenta antigua con «exigir»): NO hay sesión.
     * Este navegador pasa a ser el de la verificación; si no tiene un código vigente, se envía uno (respetando la espera).
     */
    async function continuarVerificacion(res, usuario) {
        const cfg = configVerificacion();
        const v = usuario.verificacionEmail;
        const vigente = v?.codigoHash && new Date(v.expira) > new Date();
        const cuerpo = { error: 'Antes de entrar tienes que verificar tu correo.', codigo: 'verificacion_pendiente' };
        /** Este navegador pasa a ser el de la verificación SIN enviar otro código */
        const ligarNavegador = async () => {
            const { token, tokenHash } = nuevoTokenVerificacion();
            if (!await db.renovarTokenBD(usuario.id, tokenHash, new Date(Date.now() + VIDA_TOKEN_MS))) return false;
            ponerCookieVerificacion(res, token);
            res.status(403).json({ ...cuerpo, verificacion: estadoPublico(usuario, Date.now(), cfg) });
            return true;
        };
        // Código vigente: se reutiliza (la persona puede tenerlo ya en su bandeja)
        if (vigente && await ligarNavegador()) return;
        if (!correoDisponible()) return res.status(503).json({ error: MENSAJE_SIN_CORREO, codigo: 'correo_no_disponible' });
        const r = await emitirCodigo(usuario, { cfg });
        if (r.token) ponerCookieVerificacion(res, r.token);
        if (r.ok) return res.status(403).json({ ...cuerpo, verificacion: r.estado });
        // Hay que esperar para otro envío: se abre igualmente la verificación (con «Reenviar código» en cuenta atrás)
        if (r.status === 429 && v && await ligarNavegador()) return;
        return res.status(r.status).json(r.cuerpo);
    }

    // ====================================================================== v3.13 · documentos y representante
    /** Envía (o reenvía) el enlace de autorización al representante legal. Devuelve { ok, status?, cuerpo? }. */
    async function enviarEnlaceRepresentante(req, usuario) {
        const r = usuario.representanteLegal;
        const permiso = permisoReenvio(r);
        if (!permiso.permitido) {
            return { ok: false, status: 429, cuerpo: { error: permiso.motivo === 'limite' ? 'Se enviaron demasiados correos a tu representante. Escribe al contacto de LearnTrack.' : `Ya enviamos el correo hace un momento. Podrás reenviarlo en ${textoEspera(permiso.esperaS)}.`, codigo: 'espera' } };
        }
        if (!correoDisponible()) return { ok: false, status: 503, cuerpo: { error: MENSAJE_SIN_CORREO, codigo: 'correo_no_disponible' } };
        const { token, tokenHash } = nuevoToken();
        if (!await db.guardarEnvioRepresentanteBD(usuario.id, { tokenHash, tokenExpira: new Date(Date.now() + VIDA_ENLACE_MS) })) {
            return { ok: false, status: 409, cuerpo: { error: 'La autorización ya no está pendiente.' } };
        }
        try {
            await enviarAutorizacionRepresentante({
                para: r.email, nombreRepresentante: r.nombre, parentesco: r.parentesco, nombreMenor: usuario.nombre,
                enlace: `${urlPublicaApp(req)}/autorizacion-representante#t=${token}`, dias: Math.round(VIDA_ENLACE_MS / 86400000)
            });
        } catch (e) {
            await db.anularEnvioRepresentanteBD(usuario.id, tokenHash);
            if (!(e instanceof ErrorCorreo)) throw e;
            return { ok: false, status: 503, cuerpo: { error: 'No pudimos enviar el correo a tu representante. Inténtalo de nuevo en unos minutos.', codigo: 'correo_no_enviado' } };
        }
        return { ok: true };
    }

    // El menor (con sesión) pide reenviar el correo a su representante
    rutas.post('/representante/reenviar', limites.reenvio, async (req, res) => {
        if (!req.usuario?.esperaRepresentante) return res.status(409).json({ error: 'No hay ninguna autorización pendiente.' });
        const usuario = { id: req.usuario.id, nombre: req.usuario.nombre, representanteLegal: req.usuario.representanteLegal };
        const r = await enviarEnlaceRepresentante(req, usuario);
        if (!r.ok) return res.status(r.status).json(r.cuerpo);
        const actual = await db.buscarUsuarioPorId(req.usuario.id);
        res.json({ mensaje: 'Enviamos de nuevo el correo a tu representante.', representante: estadoRepresentante(actual.representanteLegal) });
    });

    // El representante abre el enlace: qué se le pide autorizar (sin datos de más)
    rutas.post('/representante/consultar', limites.verificacion, async (req, res) => {
        const token = req.body?.token;
        if (!esTokenValido(token)) return res.status(400).json({ error: MENSAJE_ENLACE_INVALIDO, codigo: 'enlace_invalido' });
        const cuenta = await db.cuentaPorTokenRepresentanteBD(hashTokenRepresentante(token));
        if (!cuenta) return res.status(404).json({ error: MENSAJE_ENLACE_INVALIDO, codigo: 'enlace_invalido' });
        res.json({
            menor: { nombre: cuenta.nombre },
            representante: { nombre: cuenta.representanteLegal.nombre, parentesco: cuenta.representanteLegal.parentesco },
            versiones: VERSIONES_VIGENTES, expira: cuenta.representanteLegal.tokenExpira
        });
    });

    // El representante decide: autorizar (aceptando los documentos vigentes) o no autorizar (se elimina la cuenta)
    rutas.post('/representante/decidir', limites.verificacion, async (req, res) => {
        const { token, decision, acepto, versiones } = req.body ?? {};
        if (!esTokenValido(token) || !['autorizar', 'rechazar'].includes(decision)) return res.status(400).json({ error: 'Solicitud no válida.' });
        const tokenHash = hashTokenRepresentante(token);
        const cuenta = await db.cuentaPorTokenRepresentanteBD(tokenHash);
        if (!cuenta) return res.status(404).json({ error: MENSAJE_ENLACE_INVALIDO, codigo: 'enlace_invalido' });
        if (decision === 'rechazar') {
            await db.eliminarCuentaBD(cuenta.id);
            return res.json({ decision, mensaje: 'Entendido: no autorizaste el registro. La cuenta y todos sus datos se eliminaron.' });
        }
        if (acepto !== true) return res.status(400).json({ error: 'Para autorizar debes aceptar los Términos y la Política de Tratamiento de Datos.', codigo: 'aceptacion_requerida' });
        if (versiones?.terminos !== VERSIONES_VIGENTES.terminos || versiones?.privacidad !== VERSIONES_VIGENTES.privacidad) {
            return res.status(409).json({ error: 'Los documentos se actualizaron. Recarga la página y revísalos de nuevo.', codigo: 'version_documentos' });
        }
        if (!await db.autorizarRepresentanteBD(cuenta.id, tokenHash, aceptacionesVigentes('representante'))) {
            return res.status(404).json({ error: MENSAJE_ENLACE_INVALIDO, codigo: 'enlace_invalido' });
        }
        res.json({ decision, mensaje: `Gracias. Autorizaste a ${cuenta.nombre} a usar LearnTrack.` });
    });

    // Una cuenta acepta la versión NUEVA de los documentos legales (las versiones deben ser las vigentes)
    rutas.post('/aceptar-documentos', async (req, res) => {
        if (!req.usuario) return res.status(401).json({ error: 'Debes iniciar sesión.' });
        if (req.usuario.rol === 'admin') return res.status(403).json({ error: 'No aplica a la cuenta de administración.' });
        const { acepto, versiones } = req.body ?? {};
        if (acepto !== true) return res.status(400).json({ error: 'Debes marcar la casilla de aceptación.', codigo: 'aceptacion_requerida' });
        if (versiones?.terminos !== VERSIONES_VIGENTES.terminos || versiones?.privacidad !== VERSIONES_VIGENTES.privacidad) {
            return res.status(409).json({ error: 'Los documentos se actualizaron. Recarga la página y revísalos de nuevo.', codigo: 'version_documentos' });
        }
        const pendientes = req.usuario.documentosPendientes;
        if (pendientes.length) {
            const guardado = await db.registrarAceptacionesBD(req.usuario.id, aceptacionesVigentes('actualizacion').filter((a) => pendientes.includes(a.documento)));
            // Nunca responder «ok» si no se guardó nada (la pantalla de aceptación se quedaría esperando)
            if (!guardado) return res.status(500).json({ error: 'No pudimos registrar tu aceptación. Inténtalo de nuevo.' });
        }
        res.json({ ok: true });
    });

    rutas.post('/logout', async (req, res) => {
        await cerrarSesion(req, res);
        borrarCookieVerificacion(res);
        res.json({ ok: true });
    });

    return rutas;
}
