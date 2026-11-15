// Paso de verificación del correo (v3.10), dentro de la ventana de acceso.
//  · Seis casillas numéricas: se puede escribir, pegar el código entero (en cualquier casilla) o dejar que el móvil lo
//    rellene desde el SMS/correo (autocomplete="one-time-code"). Solo se aceptan dígitos.
//  · Cuenta atrás de la caducidad del código y de la espera para «Reenviar código», calculadas con los SEGUNDOS que
//    envía el servidor (así no importa si el reloj del dispositivo va adelantado o atrasado).
//  · Sin doble envío: mientras hay una petición en curso los botones se desactivan y una referencia la bloquea.
//  · Nada de esto da acceso por sí mismo: el servidor solo abre la sesión cuando el código es correcto.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth.js';
import { mensajeDeError } from '../../../services/errores.js';

const VACIO = ['', '', '', '', '', ''];
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const plazos = (v, ahora = Date.now()) => ({
    expira: v?.codigoActivo ? ahora + (v.expiraEnSegundos ?? 0) * 1000 : 0,
    reenviar: ahora + (v?.reenviarEnSegundos ?? 0) * 1000
});

/**
 * @param {{ verificacion: object, mensajeInicial?: { tipo: 'error'|'info', texto: string },
 *           alIrALogin: (mensaje?: string) => void, alUsarOtroCorreo: () => void }} props
 */
export function VerificacionCorreo({ verificacion, mensajeInicial, alIrALogin, alUsarOtroCorreo }) {
    const { verificarCorreo, reenviarCodigo } = useAuth();
    const [estado, setEstado] = useState(verificacion);
    const [limites, setLimites] = useState(() => plazos(verificacion));
    const [ahora, setAhora] = useState(() => Date.now());
    const [digitos, setDigitos] = useState(VACIO);
    const [error, setError] = useState(mensajeInicial?.tipo === 'error' ? mensajeInicial.texto : '');
    const [info, setInfo] = useState(mensajeInicial?.tipo === 'info' ? mensajeInicial.texto : '');
    const [ocupado, setOcupado] = useState(null);           // null | 'verificar' | 'reenviar' | 'hecho'
    const enCurso = useRef(false);
    const casillas = useRef([]);

    const actualizar = useCallback((v) => { if (v) { setEstado(v); setLimites(plazos(v)); setAhora(Date.now()); } }, []);

    const restanteCodigo = Math.max(0, Math.ceil((limites.expira - ahora) / 1000));
    const restanteReenvio = Math.max(0, Math.ceil((limites.reenviar - ahora) / 1000));
    const expirado = restanteCodigo === 0;
    const codigo = digitos.join('');
    const completo = /^\d{6}$/.test(codigo);

    // Reloj de 1 s solo mientras haga falta (caducidad o espera en marcha); se limpia al desmontar
    useEffect(() => {
        if (restanteCodigo === 0 && restanteReenvio === 0) return undefined;
        const t = setInterval(() => setAhora(Date.now()), 1000);
        return () => clearInterval(t);
    }, [restanteCodigo === 0, restanteReenvio === 0]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { casillas.current[0]?.focus(); }, []);

    const enfocar = (i) => casillas.current[Math.max(0, Math.min(5, i))]?.focus();
    /** Coloca dígitos desde la casilla `desde` (pegar, autocompletar o escribir) */
    function colocar(desde, texto) {
        const nuevos = String(texto).replace(/\D/g, '').slice(0, 6 - desde).split('');
        if (!nuevos.length) return;
        setDigitos((d) => { const copia = [...d]; nuevos.forEach((n, k) => { copia[desde + k] = n; }); return copia; });
        setError('');
        enfocar(desde + nuevos.length);
    }
    function alCambiar(i, valor) {
        const solo = valor.replace(/\D/g, '');
        if (!solo) { setDigitos((d) => { const c = [...d]; c[i] = ''; return c; }); return; }
        // Al escribir sobre una casilla llena, el navegador da 2 caracteres: vale el último tecleado
        colocar(i, solo.length === 2 && digitos[i] ? solo.slice(-1) : solo);
    }
    function alTecla(i, e) {
        if (e.key === 'Backspace' && !digitos[i] && i > 0) { e.preventDefault(); setDigitos((d) => { const c = [...d]; c[i - 1] = ''; return c; }); enfocar(i - 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); enfocar(i - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); enfocar(i + 1); }
    }
    function alPegar(i, e) {
        e.preventDefault();
        colocar(/^\d{6}$/.test(e.clipboardData.getData('text').replace(/\D/g, '')) ? 0 : i, e.clipboardData.getData('text'));
    }

    async function verificar(e) {
        e.preventDefault();
        if (enCurso.current || !completo || expirado) return;
        enCurso.current = true;
        setOcupado('verificar'); setError(''); setInfo('');
        let hecho = false;
        try {
            const r = await verificarCorreo(codigo);
            if (r.ok) {
                hecho = true;
                setOcupado('hecho');
                setInfo('¡Correo verificado! Entrando en LearnTrack…');
                return;                                   // el servidor ya abrió la sesión: RutaPublica lleva al panel
            }
            if (r.data?.codigo === 'sin_verificacion') { alIrALogin(mensajeDeError(r)); return; }
            actualizar(r.data?.verificacion);
            setError(mensajeDeError(r, 'No se pudo verificar el código.'));
            setDigitos(VACIO);
            enfocar(0);
        } catch (err) {
            setError(mensajeDeError(err));
        } finally {
            if (!hecho) { enCurso.current = false; setOcupado(null); }
        }
    }

    async function reenviar() {
        if (enCurso.current || restanteReenvio > 0) return;
        enCurso.current = true;
        setOcupado('reenviar'); setError(''); setInfo('');
        try {
            const r = await reenviarCodigo();
            if (r.data?.codigo === 'sin_verificacion') { alIrALogin(mensajeDeError(r)); return; }
            if (r.ok) {
                actualizar(r.data.verificacion);
                setDigitos(VACIO);
                setInfo('Te enviamos un código nuevo. El anterior ya no sirve.');
                enfocar(0);
                return;
            }
            if (r.data?.verificacion) actualizar(r.data.verificacion);
            else if (r.data?.reenviarEnSegundos) setLimites((l) => ({ ...l, reenviar: Date.now() + r.data.reenviarEnSegundos * 1000 }));
            setError(mensajeDeError(r, 'No se pudo enviar otro código.'));
        } catch (err) {
            setError(mensajeDeError(err));
        } finally {
            enCurso.current = false;
            setOcupado(null);
        }
    }

    const bloqueado = ocupado !== null;
    return (
        <form className="auth-form verificacion" id="form-verificacion" noValidate onSubmit={verificar} aria-describedby="verif-texto">
            <p className="verif-texto" id="verif-texto">
                Se ha enviado un código de verificación a <strong id="verif-email">{estado?.emailOculto}</strong>.
                Escríbelo aquí para terminar de crear tu cuenta.
            </p>
            <fieldset className={`otp-casillas${error ? ' con-error' : ''}`} disabled={ocupado === 'hecho'}>
                <legend className="solo-lectores">Código de verificación de 6 dígitos</legend>
                {digitos.map((d, i) => (
                    <input key={i} ref={(el) => { casillas.current[i] = el; }} id={`otp-${i}`} className="otp-casilla"
                        type="text" inputMode="numeric" pattern="[0-9]*" autoComplete={i === 0 ? 'one-time-code' : 'off'}
                        aria-label={`Dígito ${i + 1} de 6`} aria-invalid={Boolean(error) || undefined}
                        value={d} onChange={(e) => alCambiar(i, e.target.value)} onKeyDown={(e) => alTecla(i, e)}
                        onPaste={(e) => alPegar(i, e)} onFocus={(e) => e.target.select()} />
                ))}
            </fieldset>
            <p className={`verif-tiempo${expirado ? ' expirado' : ''}`} id="verif-tiempo" aria-live="polite">
                {expirado
                    ? 'El código ha expirado o ya no es válido. Pide uno nuevo.'
                    : `El código caduca en ${mmss(restanteCodigo)}.`}
            </p>
            <button type="submit" className="btn" id="btn-verificar" disabled={!completo || expirado || bloqueado} aria-busy={ocupado === 'verificar' || ocupado === 'hecho'}>
                {ocupado === 'verificar' ? 'Verificando…' : 'Verificar correo'}
            </button>
            <div className="verif-acciones">
                <button type="button" className="btn-enlace" id="btn-reenviar" disabled={restanteReenvio > 0 || bloqueado} aria-busy={ocupado === 'reenviar'} onClick={reenviar}>
                    {restanteReenvio > 0 ? `Reenviar código (${mmss(restanteReenvio)})` : 'Reenviar código'}
                </button>
                <button type="button" className="btn-enlace" disabled={bloqueado} onClick={alUsarOtroCorreo}>Usar otro correo</button>
            </div>
            <p className="verif-ayuda">¿No lo ves? Revisa la carpeta de spam o promociones.</p>
            <p className="auth-error" id="verif-error" role="alert">{error}</p>
            <p className="verif-info" id="verif-info" role="status">{info}</p>
        </form>
    );
}
