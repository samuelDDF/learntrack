// Sustituye a la zona privada cuando la cuenta aún no puede usarse (v3.13). El servidor ya lo impone (428/403 en la API);
// esto solo explica qué pasa y qué hacer:
//  · «documentos»: hay una versión nueva de los Términos o de la Política → leer y aceptar para seguir.
//  · «representante»: menor de 18 años → esperar a que su madre, padre o representante autorice desde el correo.
// Siempre se puede cerrar sesión o ELIMINAR la cuenta (nadie queda obligado a aceptar para poder irse).
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../../hooks/useAuth.js';
import { auth } from '../../auth/services/auth.service.js';
import { apiDelete } from '../../../services/http.js';
import { mensajeDeError } from '../../../services/errores.js';
import '../legal.css';

const NOMBRES = { terminos: 'los Términos y Condiciones', privacidad: 'la Política de Tratamiento de Datos Personales' };

function Salir() {
    const { cerrarSesion } = useAuth();
    const [saliendo, setSaliendo] = useState(false);
    return <button type="button" className="btn btn-secundario" disabled={saliendo} onClick={async () => { setSaliendo(true); await cerrarSesion({ destino: '/' }); }}>Cerrar sesión</button>;
}

function EliminarCuenta() {
    const { olvidarSesion } = useAuth();
    const [abierto, setAbierto] = useState(false);
    const [password, setPassword] = useState('');
    const [confirmacion, setConfirmacion] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    if (!abierto) {
        return <p className="legal-enlaces-secundarios">¿No quieres continuar? <button type="button" className="btn-enlace" onClick={() => setAbierto(true)}>Eliminar mi cuenta</button></p>;
    }
    const eliminar = async (ev) => {
        ev.preventDefault();
        if (!password || confirmacion !== 'ELIMINAR') { setError('Escribe tu contraseña y la palabra ELIMINAR.'); return; }
        setEnviando(true); setError('');
        try {
            const r = await apiDelete('/api/perfil', { password, confirmacion });
            if (r.ok) { olvidarSesion({ destino: '/' }); return; }
            setError(mensajeDeError(r, 'No se pudo eliminar la cuenta.'));
        } catch (e) { setError(mensajeDeError(e)); }
        setEnviando(false);
    };
    return (
        <form className="auth-form legal-eliminar" noValidate onSubmit={eliminar}>
            <p>Se borrarán <strong>todos</strong> tus datos de forma permanente. Escribe tu contraseña y la palabra <strong>ELIMINAR</strong>.</p>
            <label htmlFor="espera-eliminar-password">Contraseña</label>
            <input id="espera-eliminar-password" type="password" maxLength={128} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <label htmlFor="espera-eliminar-confirmacion">Escribe ELIMINAR</label>
            <input id="espera-eliminar-confirmacion" type="text" maxLength={20} autoComplete="off" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
            {error ? <p className="mensaje error" role="alert">{error}</p> : null}
            <div className="legal-acciones">
                <button type="submit" className="btn btn-peligro" disabled={enviando}>Eliminar para siempre</button>
                <button type="button" className="btn btn-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
            </div>
        </form>
    );
}

function AceptarDocumentos({ pendientes }) {
    const { refrescar } = useAuth();
    const [acepto, setAcepto] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const lista = pendientes.documentos.map((d) => NOMBRES[d] ?? d);
    const aceptar = async () => {
        if (!acepto) { setError('Marca la casilla para continuar.'); return; }
        setEnviando(true); setError('');
        try {
            const r = await auth.aceptarDocumentos(pendientes.versiones);
            if (r.ok) {
                const u = await refrescar();
                if (u && !u.documentosPendientes) return;          // listo: RutaPrivada pinta la zona privada
                setError(u ? 'No pudimos registrar tu aceptación. Inténtalo de nuevo o recarga la página.' : 'Tu sesión terminó. Vuelve a iniciar sesión.');
                setEnviando(false);
                return;
            }
            setError(r.data?.codigo === 'version_documentos' ? 'Los documentos acaban de cambiar: recarga la página y revísalos.' : mensajeDeError(r));
        } catch (e) { setError(mensajeDeError(e)); }
        setEnviando(false);
    };
    return (
        <>
            <h1 id="espera-titulo">Actualizamos nuestros documentos</h1>
            <p>Para seguir usando LearnTrack, lee y acepta {lista.join(' y ')}. Tus datos siguen igual mientras lo decides.</p>
            <div className="auth-acepto legal-acepto">
                <input type="checkbox" id="espera-acepto" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
                <label htmlFor="espera-acepto">
                    He leído y acepto los <Link to="/terminos" target="_blank" rel="noopener">Términos y Condiciones</Link> y
                    la <Link to="/privacidad" target="_blank" rel="noopener">Política de Tratamiento de Datos Personales</Link> de LearnTrack.
                </label>
            </div>
            {error ? <p className="mensaje error" role="alert">{error}</p> : null}
            <div className="legal-acciones">
                <button type="button" className="btn" disabled={enviando || !acepto} onClick={aceptar}>{enviando ? 'Guardando…' : 'Aceptar y continuar'}</button>
                <Salir />
            </div>
            <EliminarCuenta />
        </>
    );
}

function EsperaRepresentante({ representante }) {
    const [estado, setEstado] = useState(representante);
    const [msg, setMsg] = useState('');
    const [enviando, setEnviando] = useState(false);
    const reenviar = async () => {
        setEnviando(true); setMsg('');
        try {
            const r = await auth.reenviarRepresentante();
            if (r.ok) { setEstado(r.data.representante); setMsg(r.data.mensaje); } else setMsg(mensajeDeError(r));
        } catch (e) { setMsg(mensajeDeError(e)); }
        setEnviando(false);
    };
    return (
        <>
            <h1 id="espera-titulo">Falta la autorización de tu representante</h1>
            <p>
                Como eres menor de 18 años, enviamos un correo a <strong>{estado.correo}</strong> para que tu {estado.parentesco === 'tutor' ? 'representante legal' : estado.parentesco} autorice
                tu cuenta. Cuando lo haga, podrás usar LearnTrack con normalidad.
            </p>
            <p>Si no lo encuentra, que revise la carpeta de correo no deseado. El enlace dura 7 días.</p>
            {msg ? <p className="mensaje" role="status">{msg}</p> : null}
            <div className="legal-acciones">
                <button type="button" className="btn" disabled={enviando || !estado.reenviable} onClick={reenviar}>Reenviar el correo</button>
                <Salir />
            </div>
            {!estado.reenviable ? <p className="legal-enlaces-secundarios">Podrás reenviarlo de nuevo dentro de unos minutos.</p> : null}
            <EliminarCuenta />
        </>
    );
}

export function PantallaCuentaPendiente({ usuario }) {
    return (
        <main id="contenido" className="cuenta-espera">
            <section className="legal-documento" aria-labelledby="espera-titulo">
                {usuario.representante
                    ? <EsperaRepresentante representante={usuario.representante} />
                    : <AceptarDocumentos pendientes={usuario.documentosPendientes} />}
            </section>
        </main>
    );
}
