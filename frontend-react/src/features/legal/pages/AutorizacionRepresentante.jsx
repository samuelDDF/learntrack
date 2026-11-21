// /autorizacion-representante#t=… — la madre, el padre o el representante legal de un menor (14 a 17 años) autoriza
// o no su cuenta. El enlace llega por correo; el token va en el FRAGMENTO (#t=…), que el navegador nunca envía al
// servidor en la petición de la página ni queda en sus registros. Se quita de la barra de direcciones al leerlo.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { auth } from '../../auth/services/auth.service.js';
import { mensajeDeError } from '../../../services/errores.js';
import { Cargando } from '../../../components/common/Cargando.jsx';
import '../legal.css';

const PARENTESCO = { madre: 'madre', padre: 'padre', tutor: 'representante legal' };

const leerToken = (hash) => /^#t=([A-Za-z0-9_-]{40,60})$/.exec(hash ?? '')?.[1] ?? null;

export default function AutorizacionRepresentante() {
    const { hash, pathname } = useLocation();
    const navegar = useNavigate();
    const [token] = useState(() => leerToken(hash));
    const [estado, setEstado] = useState({ fase: token ? 'cargando' : 'invalido' });
    const [acepto, setAcepto] = useState(false);
    const [confirmarRechazo, setConfirmarRechazo] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    // El token se quita de la barra de direcciones (y del historial) en cuanto se lee
    useEffect(() => { if (hash) navegar(pathname, { replace: true }); }, [hash, pathname, navegar]);

    useEffect(() => {
        if (!token) return undefined;
        let vivo = true;
        auth.consultarRepresentante(token)
            .then((r) => { if (vivo) setEstado(r.ok ? { fase: 'decidir', ...r.data } : { fase: 'invalido', mensaje: mensajeDeError(r) }); })
            .catch((e) => { if (vivo) setEstado({ fase: 'invalido', mensaje: mensajeDeError(e) }); });
        return () => { vivo = false; };
    }, [token]);

    const decidir = async (decision) => {
        setError('');
        if (decision === 'autorizar' && !acepto) { setError('Para autorizar, marca la casilla de aceptación.'); return; }
        setEnviando(true);
        try {
            const r = await auth.decidirRepresentante(decision === 'autorizar'
                ? { token, decision, acepto: true, versiones: estado.versiones }
                : { token, decision });
            if (r.ok) setEstado({ fase: 'hecho', decision, mensaje: r.data.mensaje });
            else setError(mensajeDeError(r));
        } catch (e) { setError(mensajeDeError(e)); }
        setEnviando(false);
    };

    return (
        <main id="contenido" className="pagina-legal">
            <section className="legal-documento legal-autorizacion" aria-labelledby="aut-titulo">
                <h1 id="aut-titulo">Autorización del representante legal</h1>
                {estado.fase === 'cargando' ? <Cargando texto="Comprobando el enlace…" /> : null}
                {estado.fase === 'invalido' ? (
                    <>
                        <p>{estado.mensaje || 'El enlace no es válido o ya caducó.'}</p>
                        <p>Si el menor aún quiere usar LearnTrack, puede pedir un correo nuevo desde su cuenta.</p>
                        <Link className="btn" to="/">Ir a LearnTrack</Link>
                    </>
                ) : null}
                {estado.fase === 'decidir' ? (
                    <>
                        <p>
                            Hola, {estado.representante.nombre}. <strong>{estado.menor.nombre}</strong> creó una cuenta en LearnTrack e indicó que
                            eres su {PARENTESCO[estado.representante.parentesco] ?? 'representante legal'}. Por ser menor de 18 años, necesita tu
                            autorización para usarla.
                        </p>
                        <p>
                            Antes de decidir, lee los <Link to="/terminos" target="_blank" rel="noopener">Términos y Condiciones</Link> y
                            la <Link to="/privacidad" target="_blank" rel="noopener">Política de Tratamiento de Datos Personales</Link>: explican
                            qué datos se tratan, para qué y cómo ejercer sus derechos.
                        </p>
                        <div className="auth-acepto legal-acepto">
                            <input type="checkbox" id="aut-acepto" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
                            <label htmlFor="aut-acepto">
                                Declaro que soy su madre, padre o representante legal, que he leído y acepto los Términos y Condiciones y la
                                Política de Tratamiento de Datos Personales de LearnTrack, y autorizo el tratamiento de sus datos personales.
                            </label>
                        </div>
                        {error ? <p className="mensaje error" role="alert">{error}</p> : null}
                        <div className="legal-acciones">
                            <button type="button" className="btn" disabled={enviando || !acepto} onClick={() => decidir('autorizar')}>Autorizar la cuenta</button>
                            {confirmarRechazo ? (
                                <span className="legal-confirmar">
                                    <span>Se eliminarán la cuenta y todos sus datos. ¿Seguro?</span>
                                    <button type="button" className="btn btn-peligro" disabled={enviando} onClick={() => decidir('rechazar')}>Sí, no autorizo</button>
                                    <button type="button" className="btn btn-secundario" disabled={enviando} onClick={() => setConfirmarRechazo(false)}>Cancelar</button>
                                </span>
                            ) : (
                                <button type="button" className="btn btn-secundario" disabled={enviando} onClick={() => setConfirmarRechazo(true)}>No autorizo</button>
                            )}
                        </div>
                    </>
                ) : null}
                {estado.fase === 'hecho' ? (
                    <>
                        <p role="status">{estado.mensaje}</p>
                        <Link className="btn" to="/">Ir a LearnTrack</Link>
                    </>
                ) : null}
            </section>
        </main>
    );
}
