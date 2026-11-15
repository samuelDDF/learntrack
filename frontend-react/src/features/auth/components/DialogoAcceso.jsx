// Acceso a LearnTrack: ventana de inicio de sesión / registro / verificación del correo (zona pública).
// SPA (v3.11): cada paso tiene su ruta (/login, /registro, /verificar-correo) y la ventana se abre ENCIMA de la página
// desde la que se pidió, sin recargar. Al entrar, RutaPublica lleva al panel (o a la página privada que se quería
// ver): no se confía en ninguna ruta enviada por la respuesta ni por la URL.
// v3.10: crear cuenta NO entra directamente: el servidor envía un código de 6 dígitos al correo y la ventana pasa al
// paso «Verifica tu correo electrónico» (VerificacionCorreo.jsx). Lo mismo si alguien inicia sesión con una cuenta
// cuyo correo aún no verificó. No se puede saltar: sin el código correcto el servidor no abre la sesión.
// No guarda nada en el navegador: la sesión vive en una cookie HttpOnly que JavaScript no puede leer.
import { useEffect, useRef, useState } from 'react';
import { VerificacionCorreo } from './VerificacionCorreo.jsx';
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
        enviar(() => registrar(f.elements['registro-nombre'].value, f.elements['registro-email'].value, f.elements['registro-password'].value));
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
