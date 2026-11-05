// Acceso a LearnTrack: ventana de inicio de sesión / registro (zona pública) y botones que la abren.
// No guarda nada en el navegador: la sesión vive en una cookie HttpOnly que JavaScript no puede leer. Tras entrar
// se va SIEMPRE al panel propio (no se confía en una ruta enviada por la respuesta ni por la URL).
import { createContext, useContext, useRef, useState } from 'react';
import { Dialogo } from '../comun/ui/Dialogo.jsx';
import { auth } from '../api/publico.js';
import { mensajeDeError, navegador } from '../api/cliente.js';
import { RUTA_PANEL } from '../rutas.js';

export const ContextoAcceso = createContext({ usuario: null, abrir: () => {} });
export const useAcceso = () => useContext(ContextoAcceso);

/** Botón de llamada a la acción: abre el acceso o, con sesión, lleva al panel (como data-auth del original) */
export function BotonAcceso({ cual = 'login', children, className = 'btn' }) {
    const { usuario, abrir } = useAcceso();
    return (
        <button type="button" className={className} data-auth={cual}
            onClick={() => (usuario ? navegador.irA(RUTA_PANEL) : abrir(cual))}>
            {usuario ? 'Ir a mi panel' : children}
        </button>
    );
}

function Campo({ id, etiqueta, ...props }) {
    return (
        <div>
            <label htmlFor={id}>{etiqueta}</label>
            <input id={id} name={id} required {...props} />
        </div>
    );
}

export function DialogoAcceso({ pestana, alCerrar, alCambiarPestana }) {
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    const formLogin = useRef(null);
    const formRegistro = useRef(null);
    const esLogin = pestana === 'login';

    const cambiar = (cual) => { setError(''); alCambiarPestana(cual); };

    async function enviar(peticion) {
        setEnviando(true);
        setError('');
        try {
            const r = await peticion();
            if (!r.ok) { setError(mensajeDeError(r, 'No se pudo completar la solicitud.')); return; }
            navegador.irA(RUTA_PANEL);          // recarga completa: entra a la zona privada
        } catch (e) {
            setError(mensajeDeError(e));
        } finally {
            setEnviando(false);
        }
    }
    const alEntrar = (e) => {
        e.preventDefault();
        const f = formLogin.current;
        if (!f.checkValidity()) { setError('Escribe tu correo y tu contraseña.'); return; }
        enviar(() => auth.login(f.elements['login-email'].value, f.elements['login-password'].value));
    };
    const alRegistrar = (e) => {
        e.preventDefault();
        const f = formRegistro.current;
        if (!f.checkValidity()) { setError('Completa todos los campos con datos válidos.'); return; }
        enviar(() => auth.registro(f.elements['registro-nombre'].value, f.elements['registro-email'].value, f.elements['registro-password'].value));
    };

    return (
        <Dialogo abierto={Boolean(pestana)} alCerrar={() => { setError(''); alCerrar(); }} className="auth-dialog" aria-labelledby="auth-titulo">
            <div className="auth-cuerpo">
                <button type="button" className="auth-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
                <h2 id="auth-titulo">Accede a LearnTrack</h2>
                <div className="auth-tabs" role="tablist">
                    <button type="button" className="auth-tab" role="tab" id="tab-login" aria-selected={esLogin} aria-controls="form-login" onClick={() => cambiar('login')}>Iniciar sesión</button>
                    <button type="button" className="auth-tab" role="tab" id="tab-registro" aria-selected={!esLogin} aria-controls="form-registro" onClick={() => cambiar('registro')}>Crear cuenta</button>
                </div>
                {esLogin ? (
                    <form ref={formLogin} className="auth-form" id="form-login" role="tabpanel" aria-labelledby="tab-login" noValidate onSubmit={alEntrar}>
                        <Campo id="login-email" etiqueta="Correo electrónico" type="email" autoComplete="email" maxLength={254} autoFocus />
                        <Campo id="login-password" etiqueta="Contraseña" type="password" autoComplete="current-password" maxLength={128} />
                        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Entrando…' : 'Iniciar sesión'}</button>
                    </form>
                ) : (
                    <form ref={formRegistro} className="auth-form" id="form-registro" role="tabpanel" aria-labelledby="tab-registro" noValidate onSubmit={alRegistrar}>
                        <Campo id="registro-nombre" etiqueta="Nombre" type="text" autoComplete="name" maxLength={60} autoFocus />
                        <Campo id="registro-email" etiqueta="Correo electrónico" type="email" autoComplete="email" maxLength={254} />
                        <Campo id="registro-password" etiqueta="Contraseña" type="password" autoComplete="new-password" maxLength={128} minLength={8} aria-describedby="registro-ayuda" />
                        <p className="auth-ayuda" id="registro-ayuda">Mínimo 8 caracteres, con al menos una letra y un número.</p>
                        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Creando cuenta…' : 'Crear cuenta'}</button>
                    </form>
                )}
                <p className="auth-error" id="auth-error" role="alert">{error}</p>
            </div>
        </Dialogo>
    );
}
