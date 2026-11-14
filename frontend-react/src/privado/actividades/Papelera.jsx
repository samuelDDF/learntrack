// Papelera (Mi panel y Mi agenda): lista lo eliminado y permite restaurarlo o eliminarlo para siempre.
// v3.9:
//  · Selección (una, varias o todas) con casillas; el estado vive en React (un Set de ids), nunca en el DOM.
//  · Con algo seleccionado aparecen «Restaurar» y «Eliminar permanentemente» (se aplican a TODO lo seleccionado);
//    sin selección quedan ocultos. Eliminar para siempre pide confirmación indicando cuántas actividades son.
//  · «Vaciar papelera» siempre visible (deshabilitado si está vacía), independiente de la selección; confirma que
//    se borrará TODO y que no se puede deshacer.
//  · Mientras una operación está en curso, todos los botones de acción quedan deshabilitados (sin peticiones dobles).
//  · El botón «♻ Restaurar» de cada fila se conserva (restaurar una sola sin seleccionar).
import { useEffect, useMemo, useState } from 'react';
import { Esqueleto } from '../../comun/ui/Esqueleto.jsx';
import { textoCuando } from '@compartido/fechas.js';
import { Dialogo } from '../../comun/ui/Dialogo.jsx';
import { useAvisos } from '../../comun/ui/Avisos.jsx';
import { mensajeDeError } from '../../api/cliente.js';
import { papelera } from '../api.js';
import './papelera.css';

const fmtDia = (fecha) => new Date(fecha).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const actividadesTxt = (n) => `${n} ${n === 1 ? 'actividad' : 'actividades'}`;

/** Ventana de confirmación para acciones irreversibles (encima de la papelera; Cancelar recibe el foco) */
function Confirmacion({ abierta, titulo, texto, accion, ocupado, alConfirmar, alCancelar }) {
    return (
        <Dialogo abierto={abierta} alCerrar={alCancelar} obligatorio={ocupado} id="dlg-confirmar-papelera" className="dialogo dlg-confirmar" role="alertdialog"
            aria-labelledby="confirmar-papelera-titulo" aria-describedby="confirmar-papelera-texto">
            <div className="confirmar-cuerpo">
                <h4 id="confirmar-papelera-titulo">{titulo}</h4>
                <p id="confirmar-papelera-texto">{texto}</p>
                <div className="confirmar-acciones">
                    {/* autoFocus: el foco empieza en la opción segura */}
                    <button type="button" className="boton" autoFocus disabled={ocupado} onClick={alCancelar}>Cancelar</button>
                    <button type="button" className="boton boton-peligro confirmar" id="btn-confirmar-papelera" disabled={ocupado} aria-busy={ocupado} onClick={alConfirmar}>{accion}</button>
                </div>
            </div>
        </Dialogo>
    );
}

function Contenido({ alRestaurar, alCerrar }) {
    const [datos, setDatos] = useState(null);           // null = cargando
    const [error, setError] = useState('');
    const [estado, setEstado] = useState('');           // resultado de la última operación (visible dentro de la ventana)
    const [seleccion, setSeleccion] = useState(() => new Set());
    const [ocupado, setOcupado] = useState(null);       // null | id (restaurar fila) | 'restaurar' | 'eliminar' | 'vaciar'
    const [confirmar, setConfirmar] = useState(null);   // null | 'eliminar' | 'vaciar'
    const { aviso } = useAvisos();

    useEffect(() => {
        let vivo = true;
        papelera.listar().then((r) => {
            if (!vivo) return;
            if (r.ok) setDatos(r.data); else { setDatos({ dias: null, actividades: [] }); setError('No pude cargar la papelera.'); }
        }).catch(() => { if (vivo) { setDatos({ dias: null, actividades: [] }); setError('No pude cargar la papelera.'); } });
        return () => { vivo = false; };
    }, []);

    const lista = useMemo(() => datos?.actividades ?? [], [datos]);
    const n = seleccion.size;
    const todas = lista.length > 0 && n === lista.length;
    const alguna = n > 0 && !todas;

    const alternar = (actividadId) => setSeleccion((s) => {
        const nueva = new Set(s);
        if (nueva.has(actividadId)) nueva.delete(actividadId); else nueva.add(actividadId);
        return nueva;
    });
    const alternarTodas = () => setSeleccion(todas ? new Set() : new Set(lista.map((a) => a.id)));
    const limpiarSeleccion = () => setSeleccion(new Set());
    /** Quita de la lista (y de la selección) lo que ya no está en la papelera */
    const quitar = (ids) => {
        const fuera = new Set(ids);
        setDatos((d) => ({ ...d, actividades: d.actividades.filter((x) => !fuera.has(x.id)) }));
        setSeleccion((s) => new Set([...s].filter((x) => !fuera.has(x))));
    };
    const empezar = (que) => { setOcupado(que); setError(''); setEstado(''); };

    // ---------- restaurar UNA (botón de la fila; también lo usa «Deshacer»)
    async function restaurarUna(a) {
        if (ocupado) return;
        empezar(a.id);
        try {
            const res = await papelera.restaurar(a.id);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo restaurar.')); return; }
            quitar([a.id]);
            alRestaurar(res.data.actividades);
            const texto = `♻ «${a.titulo}» restaurada.${res.data.avisos?.length ? ` ${res.data.avisos.join(' ')}` : ''}`;
            setEstado(texto); aviso(texto);
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); }
    }

    // ---------- restaurar la SELECCIÓN
    async function restaurarSeleccion() {
        if (ocupado || n === 0) return;
        empezar('restaurar');
        try {
            const res = await papelera.restaurarVarias([...seleccion]);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo restaurar la selección.')); return; }
            quitar(res.data.restauradas.map((a) => a.id));
            limpiarSeleccion();
            alRestaurar(res.data.actividades);
            const texto = `♻ ${actividadesTxt(res.data.restauradas.length)} ${res.data.restauradas.length === 1 ? 'restaurada' : 'restauradas'}.${res.data.avisos?.length ? ` ${res.data.avisos.join(' ')}` : ''}`;
            setEstado(texto); aviso(texto);
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); }
    }

    // ---------- eliminar para siempre la SELECCIÓN (tras confirmar)
    async function eliminarSeleccion() {
        if (ocupado || n === 0) return;
        empezar('eliminar');
        const ids = [...seleccion];
        try {
            const res = await papelera.eliminarDefinitivamente(ids);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo eliminar la selección.')); return; }
            quitar(ids);
            limpiarSeleccion();
            const texto = `🗑 ${actividadesTxt(res.data.eliminadas)} ${res.data.eliminadas === 1 ? 'eliminada' : 'eliminadas'} para siempre.`;
            setEstado(texto); aviso(texto);
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); setConfirmar(null); }
    }

    // ---------- vaciar TODA la papelera (no depende de la selección)
    async function vaciar() {
        if (ocupado) return;
        empezar('vaciar');
        try {
            const res = await papelera.vaciar();
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo vaciar la papelera.')); return; }
            setDatos((d) => ({ ...d, actividades: [] }));
            limpiarSeleccion();
            const texto = res.data.eliminadas
                ? `🗑 Papelera vaciada: se eliminaron ${actividadesTxt(res.data.eliminadas)} para siempre.`
                : 'La papelera ya estaba vacía.';
            setEstado(texto); aviso(texto);
        } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); setConfirmar(null); }
    }

    const cargando = datos === null;
    return (
        <div className="papelera-cuerpo">
            <h3 id="papelera-titulo">🗑 Papelera</h3>
            <p className="papelera-nota">{datos?.dias ? `Lo que eliminas se guarda ${datos.dias} días y luego se borra solo.` : ''}</p>

            <div className="papelera-barra" role="toolbar" aria-label="Acciones de la papelera">
                <label className={`papelera-todas${lista.length ? '' : ' inactiva'}`}>
                    <input type="checkbox" id="papelera-todas" checked={todas} disabled={!lista.length || Boolean(ocupado)} onChange={alternarTodas}
                        ref={(el) => { if (el) el.indeterminate = alguna; }} />
                    <span>Seleccionar todas</span>
                </label>
                <span className="papelera-contador" id="papelera-contador" aria-live="polite">
                    {n ? `${n} ${n === 1 ? 'seleccionada' : 'seleccionadas'}` : ''}
                </span>
                <button type="button" className="boton boton-mini boton-peligro" id="btn-vaciar-papelera"
                    disabled={cargando || !lista.length || Boolean(ocupado)} aria-busy={ocupado === 'vaciar'}
                    onClick={() => setConfirmar('vaciar')}>Vaciar papelera</button>
            </div>

            {n > 0 ? (
                <div className="papelera-seleccion" role="group" aria-label={`Acciones para ${actividadesTxt(n)} seleccionadas`}>
                    <button type="button" className="boton boton-mini boton-primario" id="btn-restaurar-seleccion" disabled={Boolean(ocupado)}
                        aria-busy={ocupado === 'restaurar'} onClick={restaurarSeleccion}>{`♻ Restaurar (${n})`}</button>
                    <button type="button" className="boton boton-mini boton-peligro" id="btn-eliminar-seleccion" disabled={Boolean(ocupado)}
                        aria-busy={ocupado === 'eliminar'} onClick={() => setConfirmar('eliminar')}>{`Eliminar permanentemente (${n})`}</button>
                    <button type="button" className="boton boton-mini" disabled={Boolean(ocupado)} onClick={limpiarSeleccion}>Cancelar selección</button>
                </div>
            ) : null}

            <ul className="papelera-lista" aria-live="polite">
                {cargando ? <li className="vacia"><Esqueleto filas={2} texto="Cargando…" /></li> : null}
                {datos && lista.length === 0 && !error ? <li className="vacia">La papelera está vacía.</li> : null}
                {lista.map((a) => {
                    const marcada = seleccion.has(a.id);
                    const idCasilla = `papelera-sel-${a.id}`;
                    return (
                        <li key={a.id} className={`papelera-item${marcada ? ' seleccionada' : ''}`}>
                            <input type="checkbox" id={idCasilla} className="papelera-casilla" checked={marcada} disabled={Boolean(ocupado)}
                                onChange={() => alternar(a.id)} />
                            <label htmlFor={idCasilla} className="papelera-texto">
                                <strong>{a.titulo}</strong><small>{` · ${textoCuando(a)}`}</small>
                                <span className="papelera-meta">{`Eliminada ${fmtDia(a.eliminadaEn)}`}</span>
                            </label>
                            <button type="button" className="boton boton-mini" aria-label={`Restaurar ${a.titulo}`} disabled={Boolean(ocupado)}
                                aria-busy={ocupado === a.id} onClick={() => restaurarUna(a)}>♻ Restaurar</button>
                        </li>
                    );
                })}
            </ul>
            <p className="papelera-estado" id="papelera-estado" role="status">{estado}</p>
            <p className="error-formulario" role="alert">{error}</p>
            <div className="papelera-pie"><button type="button" className="boton" onClick={alCerrar} disabled={Boolean(ocupado)}>Cerrar</button></div>

            {/* Una sola ventana de confirmación (ids únicos); su texto depende de la acción */}
            <Confirmacion
                abierta={confirmar !== null}
                titulo={confirmar === 'vaciar' ? '¿Vaciar la papelera?' : '¿Eliminar permanentemente?'}
                texto={confirmar === 'vaciar'
                    ? `Se eliminarán para siempre TODAS las actividades de la papelera (${actividadesTxt(lista.length)}${lista.length >= 200 ? ' o más' : ''}), estén seleccionadas o no. Esta acción no se puede deshacer.`
                    : `Se eliminarán para siempre ${actividadesTxt(n)} de la papelera. Esta acción no se puede deshacer.`}
                accion={confirmar === 'vaciar' ? 'Vaciar papelera' : `Eliminar ${actividadesTxt(n)}`}
                ocupado={ocupado === 'eliminar' || ocupado === 'vaciar'}
                alConfirmar={confirmar === 'vaciar' ? vaciar : eliminarSeleccion}
                alCancelar={() => { if (!ocupado) setConfirmar(null); }} />
        </div>
    );
}

export function Papelera({ abierta, alCerrar, alRestaurar }) {
    return (
        <Dialogo abierto={abierta} alCerrar={alCerrar} id="dlg-papelera" className="dlg-papelera" aria-labelledby="papelera-titulo">
            <Contenido alRestaurar={alRestaurar} alCerrar={alCerrar} />
        </Dialogo>
    );
}
