// Piezas de Estudio que salen de la IA (v3.12) y se usan igual en la página Estudio y en el chat:
//  · SugerenciaEstudio  → «parece que necesitas aprender X»: Añadir · Añadir y planificar · Posponer · Descartar
//  · PlanSesiones       → plan PROPUESTO por el servidor; la persona ajusta día, hora y duración y lo guarda (o no)
//  · AnalisisDocumento  → lo identificado en un taller: se corrige o descarta ANTES de guardar nada
// Todo pasa por /api/estudio (el servidor valida y vuelve a comprobar la agenda): aquí no se decide ninguna fecha.
import { useMemo, useState } from 'react';
import { NOMBRE_CATEGORIA } from '@compartido/estudio.js';
import { diaLargo, diaCorto, hoyISO } from '../../../utils/fechas.js';
import { mensajeDeError } from '../../../services/errores.js';
import { estudio as api } from '../services/estudio.service.js';
import { asistente } from '../../ai-assistant/services/asistente.service.js';

const DURACIONES = [0.5, 1, 1.5, 2, 2.5, 3];
const textoHoras = (h) => (h === 0.5 ? '30 min' : `${String(h).replace('.', ',')} h`);
export const NOMBRE_TIPO_FECHA = {
    entrega: 'Entrega', examen: 'Evaluación', publicacion: 'Publicación', inicio: 'Inicio', realizacion: 'Realización', otro: 'Otra fecha'
};

// ====================================================================== plan de sesiones (editable)
export function PlanSesiones({ plan, alGuardado = () => {}, alCancelar = null }) {
    const hoy = hoyISO();
    const temaDe = useMemo(() => new Map((plan.temas ?? []).map((t) => [t.id, t])), [plan.temas]);
    const [filas, setFilas] = useState(() => plan.sesiones.map((s, i) => ({ clave: i, incluir: true, objetivoId: s.objetivoId, tema: s.tema, fecha: s.fecha, hora_inicio: s.hora_inicio, horas: s.horas, motivo: s.motivo })));
    const [estado, setEstado] = useState('editando');      // editando | guardando | guardado | descartado
    const [conflictos, setConflictos] = useState({});
    const [error, setError] = useState('');
    const [resultado, setResultado] = useState(null);
    const cambiar = (clave, campo, valor) => {
        setFilas((l) => l.map((f) => (f.clave === clave ? { ...f, [campo]: valor } : f)));
        setConflictos((c) => { const n = { ...c }; delete n[clave]; return n; });
    };
    const elegidas = filas.filter((f) => f.incluir);

    async function guardar() {
        setEstado('guardando'); setError(''); setConflictos({});
        const r = await api.guardarSesiones(elegidas.map(({ objetivoId, fecha, hora_inicio, horas }) => ({ objetivoId, fecha, hora_inicio, horas: Number(horas) }))).catch((e) => ({ ok: false, data: { error: mensajeDeError(e) } }));
        if (!r.ok) {
            setEstado('editando');
            setError(r.data?.error || 'No se pudieron guardar las sesiones.');
            if (Array.isArray(r.data?.conflictos)) setConflictos(Object.fromEntries(r.data.conflictos.map((c) => [elegidas[c.indice]?.clave, c.motivo])));
            return;
        }
        setResultado(r.data); setEstado('guardado');
        alGuardado(r.data);
    }
    async function deshacer() {
        const r = await asistente.deshacer(resultado.loteId).catch(() => null);
        if (!r?.ok) { setError(mensajeDeError(r, 'No se pudo deshacer.')); return; }
        setResultado(null); setEstado('descartado');
        alGuardado(r.data);
    }

    if (estado === 'descartado') return <p className="estudio-plan-fin">Plan descartado: no se guardó nada en tu calendario.</p>;
    if (estado === 'guardado') {
        return (
            <div className="estudio-plan estudio-plan-fin" role="status">
                <p>{`✅ ${resultado.mensaje}`}</p>
                {resultado.avisos?.map((a) => <p key={a} className="estudio-aviso">{a}</p>)}
                <button type="button" className="boton boton-mini" onClick={deshacer}>↩️ Deshacer</button>
            </div>
        );
    }
    return (
        <div className="estudio-plan">
            {plan.explicaciones?.length ? <ul className="estudio-plan-explicaciones">{plan.explicaciones.map((x) => <li key={x}>{x}</li>)}</ul> : null}
            {plan.avisos?.map((a) => <p key={a} className="estudio-aviso">{`Ojo: ${a}`}</p>)}
            <ul className="estudio-plan-filas">
                {filas.map((f) => {
                    const limite = temaDe.get(f.objetivoId)?.fechaLimite;
                    return (
                        <li key={f.clave} className={`estudio-plan-fila${f.incluir ? '' : ' fuera'}${conflictos[f.clave] ? ' conflicto' : ''}`}>
                            <label className="estudio-plan-incluir">
                                <input type="checkbox" checked={f.incluir} onChange={(e) => cambiar(f.clave, 'incluir', e.target.checked)} disabled={estado !== 'editando'} />
                                <span><strong>{f.tema}</strong>{limite ? <small>{` · límite ${diaCorto(limite)}`}</small> : null}</span>
                            </label>
                            <div className="estudio-plan-campos">
                                <label><span>Día</span>
                                    <input type="date" value={f.fecha} min={hoy} onChange={(e) => cambiar(f.clave, 'fecha', e.target.value)} disabled={!f.incluir || estado !== 'editando'} /></label>
                                <label><span>Hora</span>
                                    <input type="time" value={f.hora_inicio} step="900" onChange={(e) => cambiar(f.clave, 'hora_inicio', e.target.value)} disabled={!f.incluir || estado !== 'editando'} /></label>
                                <label><span>Duración</span>
                                    <select value={f.horas} onChange={(e) => cambiar(f.clave, 'horas', Number(e.target.value))} disabled={!f.incluir || estado !== 'editando'}>
                                        {DURACIONES.map((h) => <option key={h} value={h}>{textoHoras(h)}</option>)}
                                    </select></label>
                            </div>
                            {conflictos[f.clave] ? <p className="error-formulario" role="alert">{conflictos[f.clave]}</p> : <p className="estudio-plan-motivo">{f.motivo}</p>}
                        </li>
                    );
                })}
            </ul>
            {error ? <p className="error-formulario" role="alert">{error}</p> : null}
            <div className="estudio-acciones">
                <button type="button" className="boton boton-primario" onClick={guardar} disabled={estado !== 'editando' || elegidas.length === 0} aria-busy={estado === 'guardando'}>
                    {estado === 'guardando' ? 'Guardando…' : `Guardar ${elegidas.length} ${elegidas.length === 1 ? 'sesión' : 'sesiones'} en el calendario`}
                </button>
                <button type="button" className="boton" onClick={() => { setEstado('descartado'); alCancelar?.(); }} disabled={estado !== 'editando'}>Descartar plan</button>
            </div>
        </div>
    );
}

/** Pide el plan al servidor y lo muestra (para «Planificar sesiones» en una tarjeta o tras aceptar algo) */
export function PlanBajoDemanda({ ids, alGuardado, alCerrar }) {
    const [horasPorSesion, setHorasPorSesion] = useState(1);
    const [plan, setPlan] = useState(null);
    const [estado, setEstado] = useState('opciones');      // opciones | cargando | listo
    const [error, setError] = useState('');
    async function pedir() {
        setEstado('cargando'); setError('');
        const r = await api.plan(ids, { horasPorSesion }).catch((e) => ({ ok: false, data: { error: mensajeDeError(e) } }));
        if (!r.ok) { setError(r.data?.error || 'No se pudo preparar el plan.'); setEstado('opciones'); return; }
        setPlan(r.data.plan); setEstado('listo');
    }
    if (estado === 'listo') {
        if (!plan.sesiones.length) {
            return (
                <div className="estudio-plan">
                    {plan.avisos.map((a) => <p key={a} className="estudio-aviso">{a}</p>)}
                    <button type="button" className="boton boton-mini" onClick={alCerrar}>Cerrar</button>
                </div>
            );
        }
        return <PlanSesiones plan={plan} alGuardado={alGuardado} alCancelar={alCerrar} />;
    }
    return (
        <div className="estudio-plan estudio-plan-opciones">
            <label><span>Duración de cada sesión</span>
                <select value={horasPorSesion} onChange={(e) => setHorasPorSesion(Number(e.target.value))} disabled={estado === 'cargando'}>
                    {DURACIONES.map((h) => <option key={h} value={h}>{textoHoras(h)}</option>)}
                </select></label>
            <button type="button" className="boton boton-primario boton-mini" onClick={pedir} aria-busy={estado === 'cargando'} disabled={estado === 'cargando'}>
                {estado === 'cargando' ? 'Buscando huecos…' : 'Proponer sesiones'}
            </button>
            <button type="button" className="boton boton-mini" onClick={alCerrar} disabled={estado === 'cargando'}>Cancelar</button>
            {error ? <p className="error-formulario" role="alert">{error}</p> : null}
        </div>
    );
}

// ====================================================================== sugerencia de la IA
export function SugerenciaEstudio({ sugerencia, alResuelta = () => {} }) {
    const o = sugerencia.objetivo;
    const [estado, setEstado] = useState(o?.estado === 'sugerido' ? 'pendiente' : 'existente');
    const [trabajando, setTrabajando] = useState('');
    const [mensaje, setMensaje] = useState('');
    const [error, setError] = useState('');
    const [plan, setPlan] = useState(null);
    const [planificar, setPlanificar] = useState(false);
    if (!o) return null;

    async function responder(accion, extra = {}) {
        setTrabajando(accion + (extra.planificar ? '+plan' : '')); setError('');
        const r = await api.responderSugerencia(o.id, { accion, ...extra }).catch((e) => ({ ok: false, data: { error: mensajeDeError(e) } }));
        setTrabajando('');
        if (!r.ok) { setError(r.data?.error || 'No se pudo guardar tu respuesta.'); return; }
        setMensaje([r.data.mensaje, ...(r.data.avisos ?? [])].join(' '));
        setEstado(accion === 'aceptar' ? 'aceptada' : accion);
        if (r.data.plan) setPlan(r.data.plan);
        alResuelta(accion, r.data);
    }
    const r = o.resumen;
    return (
        <article className={`estudio-sugerencia card estado-${estado}`} aria-label={`Sugerencia de estudio: ${o.tema}`}>
            <header>
                <span className="estudio-insignia ia" aria-hidden="true">✦</span>
                <div>
                    <strong>{o.tema}</strong>
                    <small>{[NOMBRE_CATEGORIA[o.categoria] ?? 'Tema', o.fechaLimite ? `límite ${diaLargo(o.fechaLimite)}` : null, o.proyecto ? `📁 ${o.proyecto}` : null, o.menciones > 1 ? `mencionado ${o.menciones} veces` : null].filter(Boolean).join(' · ')}</small>
                </div>
            </header>
            <p className="estudio-sugerencia-motivo"><span>Por qué te lo sugiero: </span>{sugerencia.motivo || o.motivo}</p>
            {estado === 'pendiente' ? (
                <div className="estudio-acciones">
                    <button type="button" className="boton boton-primario boton-mini" onClick={() => responder('aceptar')} disabled={Boolean(trabajando)} aria-busy={trabajando === 'aceptar'}>Añadir a Estudio</button>
                    <button type="button" className="boton boton-mini" onClick={() => responder('aceptar', { planificar: true })} disabled={Boolean(trabajando)} aria-busy={trabajando === 'aceptar+plan'}>Añadir y planificar</button>
                    <button type="button" className="boton boton-mini" onClick={() => responder('posponer', { dias: 7 })} disabled={Boolean(trabajando)}>Posponer 7 días</button>
                    <button type="button" className="boton boton-mini boton-texto" onClick={() => responder('descartar')} disabled={Boolean(trabajando)}>Descartar</button>
                </div>
            ) : null}
            {estado === 'existente' ? (
                <div className="estudio-acciones">
                    <span className="estudio-meta">{`Ya está en Estudio · ${r?.progreso ?? 0} % de progreso`}</span>
                    {!planificar ? <button type="button" className="boton boton-mini" onClick={() => setPlanificar(true)}>Planificar sesiones</button> : null}
                </div>
            ) : null}
            {mensaje ? <p className="estudio-sugerencia-resultado" role="status">{mensaje}</p> : null}
            {error ? <p className="error-formulario" role="alert">{error}</p> : null}
            {plan?.sesiones?.length ? <PlanSesiones plan={plan} alGuardado={(d) => alResuelta('sesiones', d)} /> : null}
            {planificar ? <PlanBajoDemanda ids={[o.id]} alGuardado={(d) => alResuelta('sesiones', d)} alCerrar={() => setPlanificar(false)} /> : null}
        </article>
    );
}

// ====================================================================== análisis de un documento académico
export function AnalisisDocumento({ analisis, alGuardado = () => {} }) {
    const hoy = hoyISO();
    const [temas, setTemas] = useState(() => analisis.temas.map((t, i) => ({ clave: i, incluir: t.enDocumento, tema: t.tema, horas: t.horas, motivo: t.motivo, enDocumento: t.enDocumento, cita: t.cita })));
    const futuras = analisis.fechas.filter((f) => f.fecha && !f.pasada);
    const [limite, setLimite] = useState(analisis.fechaLimiteSugerida ?? '');      // '' = sin fecha límite
    const [otraFecha, setOtraFecha] = useState('');
    const [conEntrega, setConEntrega] = useState(Boolean(analisis.entregaSugerida));
    const [tituloEntrega, setTituloEntrega] = useState(analisis.entregaSugerida?.titulo ?? `Entrega: ${analisis.titulo}`.slice(0, 100));
    const [estado, setEstado] = useState('revisando');      // revisando | guardando | guardado | descartado
    const [error, setError] = useState('');
    const [resultado, setResultado] = useState(null);
    const [planificar, setPlanificar] = useState(false);
    const fechaElegida = limite === 'otra' ? otraFecha : limite;
    const elegidos = temas.filter((t) => t.incluir && t.tema.trim().length >= 2);
    const cambiar = (clave, campo, valor) => setTemas((l) => l.map((t) => (t.clave === clave ? { ...t, [campo]: valor } : t)));

    async function guardar() {
        setEstado('guardando'); setError('');
        const cuerpo = {
            objetivos: elegidos.map((t) => ({ tema: t.tema.trim(), motivo: `${analisis.titulo}: ${t.motivo}`.slice(0, 300), horasEstimadas: Number(t.horas) || 2 })),
            fechaLimite: fechaElegida || null,
            entrega: conEntrega && fechaElegida ? { titulo: tituloEntrega.trim(), fecha: fechaElegida } : null
        };
        const r = await api.guardarLote(cuerpo).catch((e) => ({ ok: false, data: { error: mensajeDeError(e) } }));
        if (!r.ok) { setError(r.data?.error || 'No se pudo guardar.'); setEstado('revisando'); return; }
        setResultado(r.data); setEstado('guardado');
        alGuardado(r.data);
    }

    if (estado === 'descartado') return <p className="estudio-plan-fin">Análisis descartado: no se guardó nada.</p>;
    if (estado === 'guardado') {
        return (
            <div className="estudio-analisis estudio-plan-fin" role="status">
                <p>{`✅ ${resultado.mensaje}`}</p>
                {resultado.existentes?.length ? <p className="estudio-meta">{`Ya tenías: ${resultado.existentes.map((o) => o.tema).join(', ')}.`}</p> : null}
                {resultado.avisos?.map((a) => <p key={a} className="estudio-aviso">{a}</p>)}
                {resultado.creados?.length && !planificar ? <button type="button" className="boton boton-primario boton-mini" onClick={() => setPlanificar(true)}>Planificar sesiones de estudio</button> : null}
                {planificar ? <PlanBajoDemanda ids={resultado.creados.map((o) => o.id).slice(0, 10)} alGuardado={alGuardado} alCerrar={() => setPlanificar(false)} /> : null}
            </div>
        );
    }
    return (
        <div className="estudio-analisis">
            <header>
                <strong>{analisis.titulo}</strong>
                {analisis.resumen ? <p>{analisis.resumen}</p> : null}
            </header>
            {analisis.avisos?.map((a) => <p key={a} className="estudio-aviso">{`Ojo: ${a}`}</p>)}

            <fieldset className="estudio-bloque">
                <legend>Temas que necesitas aprender</legend>
                {temas.length === 0 ? <p className="vacio">No identifiqué temas concretos.</p> : (
                    <ul className="estudio-analisis-temas">
                        {temas.map((t) => (
                            <li key={t.clave} className={t.incluir ? '' : 'fuera'}>
                                <input type="checkbox" checked={t.incluir} onChange={(e) => cambiar(t.clave, 'incluir', e.target.checked)} aria-label={`Incluir ${t.tema}`} />
                                <div>
                                    <input type="text" className="estudio-tema-editable" value={t.tema} maxLength={100} onChange={(e) => cambiar(t.clave, 'tema', e.target.value)} aria-label="Nombre del tema" />
                                    <small>{t.enDocumento ? `En el documento${t.cita ? `: «${t.cita}»` : ''}` : `Conocimiento previo que deduzco: ${t.motivo}`}</small>
                                </div>
                                <select value={t.horas} onChange={(e) => cambiar(t.clave, 'horas', Number(e.target.value))} aria-label={`Horas estimadas para ${t.tema}`}>
                                    {[0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((h) => <option key={h} value={h}>{textoHoras(h)}</option>)}
                                </select>
                            </li>
                        ))}
                    </ul>
                )}
            </fieldset>

            <fieldset className="estudio-bloque">
                <legend>Fechas encontradas</legend>
                {analisis.fechas.length === 0 ? <p className="vacio">El documento no tiene fechas (no invento ninguna).</p> : (
                    <ul className="estudio-analisis-fechas">
                        {analisis.fechas.map((f, i) => (
                            <li key={`${f.tipo}-${i}`}>
                                <span className={`estudio-insignia fecha-${f.tipo}`}>{NOMBRE_TIPO_FECHA[f.tipo]}</span>
                                <span>{f.fecha ? diaLargo(f.fecha) : f.texto}{f.descripcion ? ` · ${f.descripcion}` : ''}</span>
                                {f.cita ? <small>{`«${f.cita}»`}</small> : null}
                                {f.requiereConfirmacion ? <small className="estudio-aviso">{f.motivo || 'Confírmala antes de usarla.'}</small> : null}
                                {f.anioSupuesto && !f.requiereConfirmacion ? <small>El documento no dice el año: revisa que sea el correcto.</small> : null}
                                {f.pasada ? <small>Ya pasó.</small> : null}
                            </li>
                        ))}
                    </ul>
                )}
                <div className="estudio-fecha-limite" role="radiogroup" aria-label="Fecha límite para estos temas">
                    <span>Fecha límite para estudiar:</span>
                    {futuras.map((f) => (
                        <label key={`${f.tipo}-${f.fecha}`}><input type="radio" name="limite" checked={limite === f.fecha} onChange={() => setLimite(f.fecha)} />
                            {`${NOMBRE_TIPO_FECHA[f.tipo]} · ${diaCorto(f.fecha)}${f.requiereConfirmacion ? ' (por confirmar)' : ''}`}</label>
                    ))}
                    <label><input type="radio" name="limite" checked={limite === 'otra'} onChange={() => setLimite('otra')} />Otra:
                        <input type="date" min={hoy} value={otraFecha} onChange={(e) => { setOtraFecha(e.target.value); setLimite('otra'); }} aria-label="Otra fecha límite" /></label>
                    <label><input type="radio" name="limite" checked={limite === ''} onChange={() => setLimite('')} />Sin fecha límite</label>
                </div>
                <label className="estudio-entrega">
                    <input type="checkbox" checked={conEntrega && Boolean(fechaElegida)} disabled={!fechaElegida} onChange={(e) => setConEntrega(e.target.checked)} />
                    <span>Añadir la entrega a mi calendario como</span>
                    <input type="text" value={tituloEntrega} maxLength={100} onChange={(e) => setTituloEntrega(e.target.value)} disabled={!conEntrega || !fechaElegida} aria-label="Título de la entrega" />
                </label>
            </fieldset>

            {analisis.requisitos?.length || analisis.entregables?.length ? (
                <div className="estudio-analisis-listas">
                    {analisis.requisitos?.length ? <div><h4>Requisitos</h4><ul>{analisis.requisitos.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
                    {analisis.entregables?.length ? <div><h4>Entregables</h4><ul>{analisis.entregables.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
                </div>
            ) : null}

            {error ? <p className="error-formulario" role="alert">{error}</p> : null}
            <div className="estudio-acciones">
                <button type="button" className="boton boton-primario" onClick={guardar} disabled={estado !== 'revisando' || elegidos.length === 0 || (limite === 'otra' && !otraFecha)} aria-busy={estado === 'guardando'}>
                    {estado === 'guardando' ? 'Guardando…' : `Guardar ${elegidos.length} ${elegidos.length === 1 ? 'tema' : 'temas'} en Estudio`}
                </button>
                <button type="button" className="boton" onClick={() => setEstado('descartado')} disabled={estado !== 'revisando'}>Descartar</button>
            </div>
        </div>
    );
}
