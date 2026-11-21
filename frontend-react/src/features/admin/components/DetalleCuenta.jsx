// Ficha de una cuenta en el panel: datos de registro, último acceso, estado, documentos aceptados y CONTEOS de uso
// (nunca el contenido de sus actividades, proyectos o check-ins) y las acciones: suspender, reactivar, cerrar
// sesiones y eliminar. Cada acción pide confirmación y el servidor la registra en la auditoría.
import { useEffect, useState } from 'react';
import { Dialogo } from '../../../components/common/Dialogo.jsx';
import { Cargando } from '../../../components/common/Cargando.jsx';
import { mensajeDeError } from '../../../services/errores.js';
import { hoyISO } from '../../../utils/fechas.js';
import { admin } from '../services/admin.service.js';
import { ACCIONES_AUDITORIA, estadoCuenta, fecha, fechaHora } from './formato.js';

const DOCUMENTOS = { terminos: 'Términos y Condiciones', privacidad: 'Política de datos' };

function Suspender({ cuenta, alHecho, alCancelar }) {
    const [motivo, setMotivo] = useState('');
    const [hasta, setHasta] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    const manana = hoyISO(new Date(Date.now() + 86400000));
    const enviar = async (ev) => {
        ev.preventDefault();
        if (motivo.trim().length < 5) { setError('Escribe el motivo (al menos 5 caracteres).'); return; }
        setEnviando(true); setError('');
        try {
            const r = await admin.suspender(cuenta.id, { motivo: motivo.trim(), hasta });
            if (r.ok) { alHecho(r.data.mensaje, r.data.cuenta); return; }
            setError(mensajeDeError(r));
        } catch (e) { setError(mensajeDeError(e)); }
        setEnviando(false);
    };
    return (
        <form className="adm-form" noValidate onSubmit={enviar}>
            <h3>Suspender la cuenta</h3>
            <p>La persona no podrá iniciar sesión y se cerrarán sus sesiones abiertas. Sus datos no se borran.</p>
            <label htmlFor="adm-motivo">Motivo (queda en la auditoría)</label>
            <textarea id="adm-motivo" maxLength={300} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <label htmlFor="adm-hasta">Hasta (opcional; vacío = indefinida)</label>
            <input id="adm-hasta" type="date" min={manana} value={hasta} onChange={(e) => setHasta(e.target.value)} />
            {error ? <p className="adm-error" role="alert">{error}</p> : null}
            <div className="adm-botones">
                <button type="submit" className="adm-btn adm-btn-peligro" disabled={enviando}>Suspender</button>
                <button type="button" className="adm-btn adm-btn-sec" onClick={alCancelar}>Cancelar</button>
            </div>
        </form>
    );
}

function Eliminar({ cuenta, alHecho, alCancelar }) {
    const [confirmacion, setConfirmacion] = useState('');
    const [motivo, setMotivo] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    const coincide = confirmacion.trim().toLowerCase() === cuenta.email.toLowerCase();
    const enviar = async (ev) => {
        ev.preventDefault();
        if (!coincide) { setError('El correo escrito no coincide con el de la cuenta.'); return; }
        if (motivo.trim().length < 5) { setError('Escribe el motivo (al menos 5 caracteres).'); return; }
        setEnviando(true); setError('');
        try {
            const r = await admin.eliminar(cuenta.id, { confirmacion: confirmacion.trim(), motivo: motivo.trim() });
            if (r.ok) { alHecho(r.data.mensaje, null); return; }
            setError(mensajeDeError(r));
        } catch (e) { setError(mensajeDeError(e)); }
        setEnviando(false);
    };
    return (
        <form className="adm-form adm-form-peligro" noValidate onSubmit={enviar}>
            <h3>Eliminar la cuenta</h3>
            <p><strong>No se puede deshacer.</strong> Se borran la cuenta y todos sus datos (actividades, proyectos, estudio, check-ins, foto y sesiones).</p>
            <label htmlFor="adm-confirmacion">Escribe el correo de la cuenta: <span className="adm-mono">{cuenta.email}</span></label>
            <input id="adm-confirmacion" type="email" autoComplete="off" maxLength={254} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
            <label htmlFor="adm-motivo-eliminar">Motivo (queda en la auditoría)</label>
            <textarea id="adm-motivo-eliminar" maxLength={300} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            {error ? <p className="adm-error" role="alert">{error}</p> : null}
            <div className="adm-botones">
                <button type="submit" className="adm-btn adm-btn-peligro" disabled={enviando || !coincide}>Eliminar para siempre</button>
                <button type="button" className="adm-btn adm-btn-sec" onClick={alCancelar}>Cancelar</button>
            </div>
        </form>
    );
}

export function DetalleCuenta({ idCuenta, alCerrar, alCambiar }) {
    const [cuenta, setCuenta] = useState(null);
    const [error, setError] = useState('');
    const [aviso, setAviso] = useState('');
    const [modo, setModo] = useState('');            // '' | 'suspender' | 'eliminar'
    const [ocupado, setOcupado] = useState(false);

    useEffect(() => {
        let vivo = true;
        setCuenta(null); setError(''); setAviso(''); setModo('');
        admin.cuenta(idCuenta)
            .then((r) => { if (vivo) (r.ok ? setCuenta(r.data.cuenta) : setError(mensajeDeError(r))); })
            .catch((e) => { if (vivo) setError(mensajeDeError(e)); });
        return () => { vivo = false; };
    }, [idCuenta]);

    const hecho = (mensaje, nueva) => {
        setModo(''); setAviso(mensaje);
        if (nueva) setCuenta(nueva);
        alCambiar?.(nueva ? 'actualizada' : 'eliminada', mensaje);
        if (!nueva) alCerrar();
    };
    const accion = async (fn) => {
        setOcupado(true); setAviso(''); setError('');
        try {
            const r = await fn();
            if (r.ok) {
                setAviso(r.data.mensaje);
                const nueva = r.data.cuenta ?? (await admin.cuenta(idCuenta).then((d) => (d.ok ? d.data.cuenta : null)));
                if (nueva) setCuenta(nueva);
                alCambiar?.('actualizada');
            } else setError(mensajeDeError(r));
        } catch (e) { setError(mensajeDeError(e)); }
        setOcupado(false);
    };

    const estado = cuenta ? estadoCuenta(cuenta) : null;
    return (
        <Dialogo abierto alCerrar={alCerrar} className="dialogo adm-dialogo" aria-labelledby="adm-detalle-titulo">
            <div className="adm-detalle">
                <div className="adm-detalle-cabecera">
                    <h2 id="adm-detalle-titulo">{cuenta?.nombre ?? 'Cuenta'}</h2>
                    <button type="button" className="adm-btn adm-btn-sec adm-cerrar" onClick={alCerrar} aria-label="Cerrar">✕</button>
                </div>
                {!cuenta && !error ? <Cargando texto="Cargando la cuenta…" /> : null}
                {error ? <p className="adm-error" role="alert">{error}</p> : null}
                {aviso ? <p className="adm-ok" role="status">{aviso}</p> : null}
                {cuenta ? (
                    <>
                        <dl className="adm-datos">
                            <dt>Correo</dt><dd className="adm-mono">{cuenta.email}</dd>
                            <dt>Estado</dt><dd><span className={`adm-estado ${estado.clase}`}>{estado.texto}</span></dd>
                            {cuenta.suspension ? (<><dt>Suspensión</dt><dd>{cuenta.suspension.motivo} · desde {fecha(cuenta.suspension.desde)} · {cuenta.suspension.hasta ? `hasta ${fecha(cuenta.suspension.hasta)}` : 'indefinida'}</dd></>) : null}
                            <dt>Registro</dt><dd>{fechaHora(cuenta.creado)}</dd>
                            <dt>Última actividad</dt><dd>{cuenta.ultimoAcceso ? fechaHora(cuenta.ultimoAcceso) : 'Nunca'}</dd>
                            <dt>Menor de edad</dt><dd>{cuenta.menorDeEdad ? `Sí · representante: ${cuenta.representante?.estado === 'autorizado' ? 'autorizó' : 'pendiente'}` : 'No'}</dd>
                            <dt>Documentos</dt>
                            <dd>{Object.keys(DOCUMENTOS).map((d) => (
                                <span key={d} className="adm-doc">{DOCUMENTOS[d]}: {cuenta.documentos?.[d] ? `v${cuenta.documentos[d].version} (${fecha(cuenta.documentos[d].aceptadoEn)})` : 'sin aceptar'}</span>
                            ))}</dd>
                            <dt>Id</dt><dd className="adm-mono">{cuenta.id}</dd>
                        </dl>
                        <h3 className="adm-subtitulo">Uso (solo cantidades)</h3>
                        <ul className="adm-uso">
                            <li><strong>{cuenta.uso.actividades}</strong> actividades</li>
                            <li><strong>{cuenta.uso.proyectos}</strong> proyectos</li>
                            <li><strong>{cuenta.uso.temasEstudio}</strong> temas de estudio</li>
                            <li><strong>{cuenta.uso.checkins}</strong> check-ins</li>
                            <li><strong>{cuenta.uso.sesionesAbiertas}</strong> sesiones abiertas</li>
                        </ul>
                        {modo === 'suspender' ? <Suspender cuenta={cuenta} alHecho={hecho} alCancelar={() => setModo('')} /> : null}
                        {modo === 'eliminar' ? <Eliminar cuenta={cuenta} alHecho={hecho} alCancelar={() => setModo('')} /> : null}
                        {!modo ? (
                            <div className="adm-botones">
                                {cuenta.estado === 'suspendida'
                                    ? <button type="button" className="adm-btn" disabled={ocupado} onClick={() => accion(() => admin.reactivar(cuenta.id))}>Reactivar</button>
                                    : <button type="button" className="adm-btn adm-btn-aviso" disabled={ocupado} onClick={() => setModo('suspender')}>Suspender…</button>}
                                <button type="button" className="adm-btn adm-btn-sec" disabled={ocupado || !cuenta.uso.sesionesAbiertas} onClick={() => accion(() => admin.cerrarSesiones(cuenta.id))}>Cerrar sesiones</button>
                                <button type="button" className="adm-btn adm-btn-peligro" disabled={ocupado} onClick={() => setModo('eliminar')}>Eliminar…</button>
                            </div>
                        ) : null}
                        {cuenta.acciones?.length ? (
                            <>
                                <h3 className="adm-subtitulo">Historial administrativo</h3>
                                <ul className="adm-historial">
                                    {cuenta.acciones.map((a) => <li key={a.id}>{fechaHora(a.fecha)} · {ACCIONES_AUDITORIA[a.accion] ?? a.accion}{a.detalle?.motivo ? ` — ${a.detalle.motivo}` : ''}</li>)}
                                </ul>
                            </>
                        ) : null}
                    </>
                ) : null}
            </div>
        </Dialogo>
    );
}
