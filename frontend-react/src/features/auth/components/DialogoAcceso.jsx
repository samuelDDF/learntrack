// Acceso a LearnTrack: ventana de inicio de sesión / registro / verificación del correo (zona pública).
// SPA (v3.11): cada paso tiene su ruta (/login, /registro, /verificar-correo) y la ventana se abre ENCIMA de la página
// desde la que se pidió, sin recargar. Al entrar, RutaPublica lleva al panel (o a la página privada que se quería
// ver): no se confía en ninguna ruta enviada por la respuesta ni por la URL.
// v3.10: crear cuenta NO entra directamente: el servidor envía un código de 6 dígitos al correo y la ventana pasa al
// paso «Verifica tu correo electrónico» (VerificacionCorreo.jsx). Lo mismo si alguien inicia sesión con una cuenta
// cuyo correo aún no verificó. No se puede saltar: sin el código correcto el servidor no abre la sesión.
// No guarda nada en el navegador: la sesión vive en una cookie HttpOnly que JavaScript no puede leer.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { VerificacionCorreo } from './VerificacionCorreo.jsx';
import { VERSIONES_VIGENTES, EDAD_MINIMA, MAYORIA_EDAD, edadEn } from '@compartido/legal.js';
import { hoyISO } from '../../../utils/fechas.js';
import { Dialogo } from '../../../components/common/Dialogo.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { mensajeDeError } from '../../../services/errores.js';
import '../auth.css';

function Campo({ id, etiqueta, ...props }) {
    return (
        <div>
            <label htmlFor={id}>{etiqueta}</label>
            <input id={id} name={id} required {...props} />
        </div>
    );
}

/**
 * @param {{ pestana: 'login'|'registro'|'verificar', alCerrar: () => void,
 *           alCambiarPestana: (cual: 'login'|'registro'|'verificar') => void }} props
 */
export function DialogoAcceso({ pestana, alCerrar, alCambiarPestana }) {
    const { iniciarSesion, registrar, estadoVerificacion } = useAuth();
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    // v3.10: verificación en curso { datos (estado del servidor), mensaje inicial }
    const [verificacion, setVerificacion] = useState(null);
    const formLogin = useRef(null);
    const formRegistro = useRef(null);
    // v3.13: casilla de aceptación (SIEMPRE desmarcada al empezar) y fecha de nacimiento (14+; de 14 a 17, representante)
    const [acepto, setAcepto] = useState(false);
    const [nacimiento, setNacimiento] = useState('');
    const hoy = hoyISO();
    const edad = /^\d{4}-\d{2}-\d{2}$/.test(nacimiento) && nacimiento <= hoy ? edadEn(nacimiento, hoy) : null;
    const esMenor = edad !== null && edad >= EDAD_MINIMA && edad < MAYORIA_EDAD;
    const esLogin = pestana === 'login';
    const verificando = pestana === 'verificar';

    const cambiar = (cual, mensaje = '') => { setError(mensaje); alCambiarPestana(cual); };
    const irAVerificar = (datos, mensaje) => { setVerificacion({ datos, mensaje }); setError(''); alCambiarPestana('verificar'); };

    // /verificar-correo sin datos (p. ej. tras recargar): se retoma la verificación de ESTE navegador si sigue vigente
    useEffect(() => {
        if (!verificando || verificacion) return undefined;
        let vivo = true;
        estadoVerificacion().then((r) => {
            if (!vivo) return;
            if (r.ok) setVerificacion({ datos: r.data.verificacion });
            else cambiar('login', 'Tu verificación terminó o caducó. Inicia sesión con tu correo y contraseña para continuar.');
        }).catch((e) => { if (vivo) cambiar('login', mensajeDeError(e)); });
        return () => { vivo = false; };
    }, [verificando, verificacion]);   // eslint-disable-line react-hooks/exhaustive-deps

    async function enviar(peticion) {
        setEnviando(true);
        setError('');
        let entro = false;
        try {
            const r = await peticion();
            // Registro aceptado o cuenta pendiente: al paso de verificación (con el error del correo si no salió)
            if (r.data?.verificacion && (r.status === 202 || r.status === 403 || r.status === 503 || r.status === 429)) {
                const mensaje = r.status === 202 ? null
                    : r.status === 403 ? { tipo: 'info', texto: 'Tu correo aún no está verificado. Escribe el código que te enviamos para entrar.' }
                        : { tipo: 'error', texto: mensajeDeError(r) };
                irAVerificar(r.data.verificacion, mensaje);
                return;
            }
            if (!r.ok) { setError(mensajeDeError(r, 'No se pudo completar la solicitud.')); return; }
            entro = true;                        // la sesión ya está cargada: RutaPublica lleva al panel
        } catch (e) {
            setError(mensajeDeError(e));
        } finally {
            if (!entro) setEnviando(false);
        }
    }
    const alEntrar = (e) => {
        e.preventDefault();
        const f = formLogin.current;
        if (!f.checkValidity()) { setError('Escribe tu correo y tu contraseña.'); return; }
        enviar(() => iniciarSesion(f.elements['login-email'].value, f.elements['login-password'].value));
    };
    const alRegistrar = (e) => {
        e.preventDefault();
        const f = formRegistro.current;
        if (!f.checkValidity()) { setError('Completa todos los campos con datos válidos.'); return; }
        if (edad === null) { setError('Escribe tu fecha de nacimiento.'); return; }
        if (edad < EDAD_MINIMA) { setError(`Para usar LearnTrack debes tener al menos ${EDAD_MINIMA} años.`); return; }
        if (!acepto) { f.elements['registro-acepto'].focus(); setError('Para crear la cuenta debes aceptar los Términos y Condiciones y la Política de Tratamiento de Datos Personales.'); return; }
        const datos = {
            aceptaDocumentos: true, versiones: VERSIONES_VIGENTES, fechaNacimiento: nacimiento,
            ...(esMenor ? { representante: { nombre: f.elements['registro-rep-nombre'].value, email: f.elements['registro-rep-email'].value, parentesco: f.elements['registro-rep-parentesco'].value } } : {})
        };
        enviar(() => registrar(f.elements['registro-nombre'].value, f.elements['registro-email'].value, f.elements['registro-password'].value, datos));
    };

    return (
        <Dialogo abierto alCerrar={alCerrar} className="auth-dialog" aria-labelledby="auth-titulo">
            <div className="auth-cuerpo">
                <button type="button" className="auth-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
                <h2 id="auth-titulo">{verificando ? 'Verifica tu correo electrónico' : 'Accede a LearnTrack'}</h2>
                {verificando ? (
                    verificacion
                        ? <VerificacionCorreo verificacion={verificacion.datos} mensajeInicial={verificacion.mensaje}
                            alIrALogin={(mensaje) => { setVerificacion(null); cambiar('login', mensaje); }}
                            alUsarOtroCorreo={() => { setVerificacion(null); cambiar('registro'); }} />
                        : <p className="verif-texto" role="status">Cargando tu verificación…</p>
                ) : <>
                    <div className="auth-tabs" role="tablist">
                        <button type="button" className="auth-tab" role="tab" id="tab-login" aria-selected={esLogin} aria-controls="form-login" onClick={() => cambiar('login')}>Iniciar sesión</button>
                        <button type="button" className="auth-tab" role="tab" id="tab-registro" aria-selected={!esLogin} aria-controls="form-registro" onClick={() => cambiar('registro')}>Crear cuenta</button>
                    </div>
                    {esLogin ? (
                        <form ref={formLogin} className="auth-form" id="form-login" role="tabpanel" aria-labelledby="tab-login" noValidate onSubmit={alEntrar}>
                            <Campo id="login-email" etiqueta="Correo electrónico" type="email" autoComplete="email" maxLength={254} autoFocus />
                            <Campo id="login-password" etiqueta="Contraseña" type="password" autoComplete="current-password" maxLength={128} />
                            <button type="submit" className="btn" disabled={enviando} aria-busy={enviando}>{enviando ? 'Entrando…' : 'Iniciar sesión'}</button>
                        </form>
                    ) : (
                        <form ref={formRegistro} className="auth-form" id="form-registro" role="tabpanel" aria-labelledby="tab-registro" noValidate onSubmit={alRegistrar}>
                            <Campo id="registro-nombre" etiqueta="Nombre" type="text" autoComplete="name" maxLength={60} autoFocus />
                            <Campo id="registro-email" etiqueta="Correo electrónico" type="email" autoComplete="email" maxLength={254} />
                            <Campo id="registro-password" etiqueta="Contraseña" type="password" autoComplete="new-password" maxLength={128} minLength={8} aria-describedby="registro-ayuda" />
                            <p className="auth-ayuda" id="registro-ayuda">Mínimo 8 caracteres, con al menos una letra y un número.</p>
                            <Campo id="registro-nacimiento" etiqueta="Fecha de nacimiento" type="date" max={hoy} min="1900-01-01" value={nacimiento}
                                onChange={(e) => setNacimiento(e.target.value)} aria-describedby="registro-edad" />
                            <p className="auth-ayuda" id="registro-edad">
                                {edad !== null && edad < EDAD_MINIMA ? `LearnTrack es para personas de ${EDAD_MINIMA} años o más.`
                                    : `Desde los ${EDAD_MINIMA} años. Si eres menor de ${MAYORIA_EDAD}, tu madre, padre o representante legal debe autorizar tu cuenta.`}
                            </p>
                            {esMenor ? (
                                <fieldset className="auth-representante">
                                    <legend>Tu madre, padre o representante legal</legend>
                                    <p className="auth-ayuda">Le enviaremos un correo para que autorice tu cuenta. Hasta que lo haga, no podrás usarla.</p>
                                    <Campo id="registro-rep-nombre" etiqueta="Nombre completo" type="text" autoComplete="off" maxLength={80} />
                                    <Campo id="registro-rep-email" etiqueta="Correo electrónico" type="email" autoComplete="off" maxLength={254} />
                                    <div>
                                        <label htmlFor="registro-rep-parentesco">Parentesco</label>
                                        <select id="registro-rep-parentesco" name="registro-rep-parentesco" required defaultValue="">
                                            <option value="" disabled>Elige…</option>
                                            <option value="madre">Madre</option>
                                            <option value="padre">Padre</option>
                                            <option value="tutor">Tutor(a) o representante legal</option>
                                        </select>
                                    </div>
                                </fieldset>
                            ) : null}
                            <div className="auth-acepto">
                                <input type="checkbox" id="registro-acepto" name="registro-acepto" checked={acepto} aria-required="true"
                                    onChange={(e) => { setAcepto(e.target.checked); if (e.target.checked) setError(''); }} />
                                <label htmlFor="registro-acepto">
                                    He leído y acepto los <Link to="/terminos" target="_blank" rel="noopener">Términos y Condiciones</Link> y
                                    la <Link to="/privacidad" target="_blank" rel="noopener">Política de Tratamiento de Datos Personales</Link> de LearnTrack.
                                </label>
                            </div>
                            <p className="auth-ayuda">Te enviaremos un código de 6 dígitos para verificar tu correo.</p>
                            <button type="submit" className="btn" disabled={enviando} aria-busy={enviando}>{enviando ? 'Creando cuenta…' : 'Crear cuenta'}</button>
                        </form>
                    )}
                    <p className="auth-error" id="auth-error" role="alert">{error}</p>
                </>}
            </div>
        </Dialogo>
    );
}
