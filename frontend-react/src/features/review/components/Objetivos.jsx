// Objetivos de aprendizaje (v3.12): formulario (nuevo / editar) y tarjeta con progreso, situación y próxima sesión.
import { useState } from 'react';
import { CATEGORIAS_OBJETIVO, NOMBRE_CATEGORIA, NIVELES, NOMBRE_NIVEL, NOMBRE_PRIORIDAD_OBJETIVO } from '@compartido/estudio.js';
import { diaLargo, diaCorto, hoyISO } from '../../../utils/fechas.js';
import { BotonConfirmar } from '../../../components/common/BotonConfirmar.jsx';
import { mensajeDeError } from '../../../services/errores.js';
import { estudio as api } from '../services/estudio.service.js';
import { PlanBajoDemanda } from './EstudioIA.jsx';

export const NOMBRE_SITUACION = {
    atrasado: 'Atrasado', proximo: 'Próximo a vencer', en_plazo: 'En plazo', sin_fecha: 'Sin fecha límite', completado: 'Completado'
};
const VACIO = { tema: '', categoria: 'tema', nivelActual: '', nivelObjetivo: '', fechaLimite: '', prioridad: 2, horasEstimadas: 4, descripcion: '' };

export function FormularioObjetivo({ inicial = null, alGuardado, alCancelar }) {
    const [v, setV] = useState(() => ({ ...VACIO, ...(inicial ?? {}), fechaLimite: inicial?.fechaLimite ?? '' }));
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const campo = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
    const idBase = inicial ? `obj-${inicial.id}` : 'obj-nuevo';

    async function enviar(e) {
        e.preventDefault();
        if (v.tema.trim().length < 2) { setError('Escribe el tema que quieres aprender.'); return; }
        setGuardando(true); setError('');
        const datos = {
            tema: v.tema.trim(), categoria: v.categoria, nivelActual: v.nivelActual, nivelObjetivo: v.nivelObjetivo,
            fechaLimite: v.fechaLimite || null, prioridad: Number(v.prioridad), horasEstimadas: Number(v.horasEstimadas), descripcion: v.descripcion
        };
        try {
            const r = inicial ? await api.editar(inicial.id, datos) : await api.crear(datos);
            if (!r.ok) { setError(mensajeDeError(r, 'No se pudo guardar el tema.')); return; }
            alGuardado(r.data.objetivo, { reactivado: r.data.reactivado });
            if (!inicial) setV(VACIO);
        } catch (err) { setError(mensajeDeError(err)); } finally { setGuardando(false); }
    }

    return (
        <form className="estudio-formulario" noValidate onSubmit={enviar}>
            <div className="campo campo-ancho">
                <label htmlFor={`${idBase}-tema`}>¿Qué quieres aprender?</label>
                <input id={`${idBase}-tema`} value={v.tema} onChange={campo('tema')} maxLength={100} placeholder="Ej.: JavaScript, bases de datos, oratoria…" required />
            </div>
            <div className="campo">
                <label htmlFor={`${idBase}-cat`}>Tipo</label>
                <select id={`${idBase}-cat`} value={v.categoria} onChange={campo('categoria')}>
                    {CATEGORIAS_OBJETIVO.map((c) => <option key={c} value={c}>{NOMBRE_CATEGORIA[c]}</option>)}
                </select>
            </div>
            <div className="campo">
                <label htmlFor={`${idBase}-limite`}>Fecha límite</label>
                <input id={`${idBase}-limite`} type="date" value={v.fechaLimite} min={inicial ? undefined : hoyISO()} onChange={campo('fechaLimite')} />
            </div>
            <div className="campo">
                <label htmlFor={`${idBase}-actual`}>Nivel actual</label>
                <select id={`${idBase}-actual`} value={v.nivelActual} onChange={campo('nivelActual')}>
                    {NIVELES.map((n) => <option key={n} value={n}>{NOMBRE_NIVEL[n]}</option>)}
                </select>
            </div>
            <div className="campo">
                <label htmlFor={`${idBase}-meta`}>Nivel que quieres alcanzar</label>
                <select id={`${idBase}-meta`} value={v.nivelObjetivo} onChange={campo('nivelObjetivo')}>
                    {NIVELES.map((n) => <option key={n} value={n}>{NOMBRE_NIVEL[n]}</option>)}
                </select>
            </div>
            <div className="campo">
                <label htmlFor={`${idBase}-prio`}>Prioridad</label>
                <select id={`${idBase}-prio`} value={v.prioridad} onChange={campo('prioridad')}>
                    {[3, 2, 1].map((p) => <option key={p} value={p}>{NOMBRE_PRIORIDAD_OBJETIVO[p]}</option>)}
                </select>
            </div>
            <div className="campo">
                <label htmlFor={`${idBase}-horas`}>Horas estimadas</label>
                <input id={`${idBase}-horas`} type="number" min="0.5" max="200" step="0.5" value={v.horasEstimadas} onChange={campo('horasEstimadas')} />
            </div>
            <div className="campo campo-ancho">
                <label htmlFor={`${idBase}-desc`}>Objetivo o notas (opcional)</label>
                <input id={`${idBase}-desc`} value={v.descripcion} onChange={campo('descripcion')} maxLength={500} placeholder="Ej.: poder hacer el taller 3 sin ayuda" />
            </div>
            {error ? <p className="error-formulario campo-ancho" role="alert">{error}</p> : null}
            <div className="estudio-acciones campo-ancho">
                <button type="submit" className="boton boton-primario" disabled={guardando} aria-busy={guardando}>{guardando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Añadir tema'}</button>
                {alCancelar ? <button type="button" className="boton" onClick={alCancelar} disabled={guardando}>Cancelar</button> : null}
            </div>
        </form>
    );
}

export function TarjetaObjetivo({ objetivo: o, alCambiar, alConsultar }) {
    const [modo, setModo] = useState('ver');          // ver | editar | planificar
    const [error, setError] = useState('');
    const r = o.resumen;
    const completado = o.estado === 'completado';

    async function cambiarEstado(estado) {
        setError('');
        const res = await api.editar(o.id, { estado }).catch((e) => ({ ok: false, data: { error: mensajeDeError(e) } }));
        if (!res.ok) { setError(mensajeDeError(res, 'No se pudo actualizar.')); return; }
        alCambiar();
    }
    async function eliminar() {
        const res = await api.eliminar(o.id).catch(() => null);
        if (!res?.ok) { setError(mensajeDeError(res, 'No se pudo eliminar.')); return; }
        alCambiar(res.data.mensaje);
    }

    if (modo === 'editar') {
        return (
            <article className="estudio-objetivo card editando">
                <FormularioObjetivo inicial={o} alGuardado={() => { setModo('ver'); alCambiar(); }} alCancelar={() => setModo('ver')} />
            </article>
        );
    }
    return (
        <article className={`estudio-objetivo card situacion-${r.situacion}`} aria-labelledby={`obj-${o.id}-titulo`}>
            <header className="estudio-objetivo-cabecera">
                <div>
                    <h3 id={`obj-${o.id}-titulo`}>{o.tema}</h3>
                    <p className="estudio-meta">
                        {[NOMBRE_CATEGORIA[o.categoria], o.nivelActual || o.nivelObjetivo ? `${NOMBRE_NIVEL[o.nivelActual || '']} → ${NOMBRE_NIVEL[o.nivelObjetivo || '']}` : null,
                            `prioridad ${NOMBRE_PRIORIDAD_OBJETIVO[o.prioridad].toLowerCase()}`, o.proyecto ? `📁 ${o.proyecto}` : null].filter(Boolean).join(' · ')}
                    </p>
                </div>
                <span className={`estudio-insignia situacion-${r.situacion}`}>
                    {NOMBRE_SITUACION[r.situacion]}
                    {r.diasRestantes !== null && !completado ? ` · ${r.diasRestantes < 0 ? `hace ${-r.diasRestantes} d` : r.diasRestantes === 0 ? 'hoy' : `${r.diasRestantes} d`}` : ''}
                </span>
            </header>
            {o.descripcion ? <p className="estudio-objetivo-desc">{o.descripcion}</p> : null}
            <div className="estudio-progreso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.progreso} aria-label={`Progreso de ${o.tema}`}>
                <span style={{ width: `${r.progreso}%` }} />
            </div>
            <p className="estudio-meta">
                {`${r.progreso} % · ${r.horasCompletadas} de ${r.horasEstimadas} h estudiadas`}
                {r.horasProgramadas ? ` · ${r.horasProgramadas} h programadas` : ''}
                {o.fechaLimite ? ` · límite ${diaLargo(o.fechaLimite)}` : ''}
            </p>
            <p className="estudio-meta">
                {r.proximaSesion ? `Próxima sesión: ${diaCorto(r.proximaSesion.fecha_inicio)}${r.proximaSesion.hora_inicio ? ` a las ${r.proximaSesion.hora_inicio}` : ''}`
                    : completado ? '¡Lo completaste! 🎉' : r.horasPendientes ? `Sin sesiones próximas · faltan ${r.horasPendientes} h por programar` : 'Sin sesiones próximas'}
            </p>
            {modo === 'planificar' ? <PlanBajoDemanda ids={[o.id]} alGuardado={() => alCambiar()} alCerrar={() => setModo('ver')} /> : (
                <div className="estudio-acciones">
                    {!completado ? <button type="button" className="boton boton-primario boton-mini" onClick={() => setModo('planificar')}>Planificar sesiones</button> : null}
                    <button type="button" className="boton boton-mini" onClick={() => alConsultar(o)}>Preguntar a Nexo</button>
                    <button type="button" className="boton boton-mini" onClick={() => setModo('editar')}>Editar</button>
                    {completado
                        ? <button type="button" className="boton boton-mini" onClick={() => cambiarEstado('en_curso')}>Reabrir</button>
                        : <button type="button" className="boton boton-mini" onClick={() => cambiarEstado('completado')}>Marcar como aprendido</button>}
                    <BotonConfirmar className="boton boton-mini boton-texto" textoConfirmar="¿Eliminar?" aria-label={`Eliminar el tema ${o.tema}`} alConfirmar={eliminar}>Eliminar</BotonConfirmar>
                </div>
            )}
            {error ? <p className="error-formulario" role="alert">{error}</p> : null}
        </article>
    );
}
