// Estudio (v3.12): objetivos de aprendizaje, sugerencias de la IA, próximas sesiones, análisis de talleres y el
// repaso espaciado SM-2 de siempre.
//  · «Sugerencias de Nexo»: temas que la IA detectó (chat, proyectos); se aceptan, posponen o descartan.
//  · «Tus temas de estudio»: objetivos con fecha límite, prioridad, nivel, progreso y su plan de sesiones
//    (el servidor propone huecos libres; nada se guarda en el calendario sin confirmarlo).
//  · «Analizar un taller o trabajo»: temas, requisitos y fechas del documento para revisarlos ANTES de guardar.
//  · «Repasos pendientes»: temas con repaso pendiente (vencidos o de hoy). Calificas cómo lo recordaste (0–5) y el
//    servidor calcula con SM-2 la próxima fecha (el cálculo NO se hace en el navegador).
//  · «Añadir un tema para repasar»: activa el repaso en una de tus actividades (por defecto, primer repaso hoy).
//  · «Temas con repaso activo»: próxima fecha, repeticiones y facilidad; puedes quitar un tema del repaso.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NOMBRE_TIPO } from '@compartido/catalogos.js';
import { diasEntre, sumarDias } from '@compartido/fechas.js';
import { diaLargo, diaCorto, hoyISO, horaLocal, tzOffset } from '../../../utils/fechas.js';
import { BotonConfirmar } from '../../../components/common/BotonConfirmar.jsx';
import { Esqueleto } from '../../../components/common/Esqueleto.jsx';
import { useRevelar } from '../../../hooks/useAnimaciones.js';
import { Mensaje, estadoMsg } from '../../../components/common/Mensaje.jsx';
import { useAvisos } from '../../../hooks/useAvisos.js';
import { mensajeDeError } from '../../../services/errores.js';
import { repaso as apiRepaso } from '../services/repaso.service.js';
import { actividades as apiActividades } from '../../activities/services/actividades.service.js';
import { ChatFlotante } from '../../ai-assistant/components/ChatFlotante.jsx';
import { estudio as apiEstudio } from '../services/estudio.service.js';
import { TarjetaObjetivo, FormularioObjetivo } from '../components/Objetivos.jsx';
import { SugerenciaEstudio, AnalisisDocumento } from '../components/EstudioIA.jsx';
import '../repaso.css';
import '../estudio.css';

export const CALIFICACIONES = [
    { valor: 0, texto: 'No lo recordé', ayuda: 'En blanco: empiezo de nuevo' },
    { valor: 1, texto: 'Muy difícil', ayuda: 'Lo vi y me sonó, pero no lo recordé' },
    { valor: 2, texto: 'Difícil', ayuda: 'Fallé, aunque casi lo tenía' },
    { valor: 3, texto: 'Con esfuerzo', ayuda: 'Lo recordé, pero me costó' },
    { valor: 4, texto: 'Bien', ayuda: 'Lo recordé tras pensarlo un poco' },
    { valor: 5, texto: 'Perfecto', ayuda: 'Lo recordé al instante' }
];

/** «hoy», «mañana», «en 6 días», «hace 2 días» */
export function cuandoRepaso(fecha, hoy = hoyISO()) {
    if (!fecha) return 'sin fecha';
    const d = diasEntre(hoy, fecha);
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    if (d === -1) return 'ayer (atrasado)';
    return d > 0 ? `en ${d} días` : `hace ${-d} días (atrasado)`;
}

function TarjetaPendiente({ a, alCalificada }) {
    const [enviando, setEnviando] = useState(null);
    const [error, setError] = useState('');
    const r = a.repaso ?? {};
    async function calificar(valor) {
        setEnviando(valor); setError('');
        try {
            const res = await apiRepaso.calificar(a.id, valor);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo registrar el repaso.')); return; }
            alCalificada(a, res.data);
        } catch (e) { setError(mensajeDeError(e)); } finally { setEnviando(null); }
    }
    return (
        <li className="repaso-tarjeta card lt-tarjeta-sutil">
            <div className="repaso-tema">
                <h3>{a.titulo}</h3>
                <p className="repaso-meta">
                    {`${NOMBRE_TIPO[a.tipo] ?? a.tipo}${a.proyecto ? ` · 📁 ${a.proyecto}` : ''} · ${r.repeticiones ?? 0} ${r.repeticiones === 1 ? 'repaso seguido' : 'repasos seguidos'}`}
                    {r.ultimoRepaso ? ` · último: ${diaCorto(r.ultimoRepaso)}` : ' · primer repaso'}
                    {r.proximaFecha && r.proximaFecha < hoyISO() ? ` · tocaba ${cuandoRepaso(r.proximaFecha)}` : ''}
                </p>
            </div>
            <fieldset className="repaso-calificar" disabled={enviando !== null}>
                <legend>¿Qué tan bien lo recordaste?</legend>
                <div className="repaso-botones">
                    {CALIFICACIONES.map((c) => (
                        <button key={c.valor} type="button" className={`boton repaso-nota nota-${c.valor}`} title={c.ayuda} aria-busy={enviando === c.valor}
                            aria-label={`${c.valor}: ${c.texto}. ${c.ayuda}. Repaso de ${a.titulo}`} onClick={() => calificar(c.valor)}>
                            <strong>{c.valor}</strong><span>{enviando === c.valor ? 'Guardando…' : c.texto}</span>
                        </button>
                    ))}
                </div>
            </fieldset>
            <p className="error-formulario" role="alert">{error}</p>
        </li>
    );
}


export default function Repaso() {
    const hoy = hoyISO();
    const revelar = useRevelar();
    const [pendientes, setPendientes] = useState(null);
    const [todos, setTodos] = useState(null);
    const [actividades, setActividades] = useState(null);
    const [hechos, setHechos] = useState([]);                // repasos calificados en esta visita
    const [elegida, setElegida] = useState('');
    const [primera, setPrimera] = useState(hoy);
    const [estadoAlta, setEstadoAlta] = useState(estadoMsg());
    const [error, setError] = useState('');
    const [temaChat, setTemaChat] = useState(null);       // { tema, objetivoId } abierto en el asistente
    const [datos, setDatos] = useState(null);             // GET /api/estudio
    const [filtro, setFiltro] = useState('activos');
    const [nuevo, setNuevo] = useState(false);
    const [analisis, setAnalisis] = useState(null);       // { estado: 'leyendo'|'listo'|'error', datos?, error?, nombre }
    const { aviso } = useAvisos();

    const cargar = useCallback(async () => {
        try {
            const [rp, rt, ra] = await Promise.all([apiRepaso.pendientes(), apiRepaso.todos(), apiActividades.listar()]);
            if (!rp.ok || !rt.ok) throw new Error(mensajeDeError(rp.ok ? rt : rp));
            const re = await apiEstudio.listar().catch(() => null);
            if (re?.ok) setDatos(re.data); else setDatos((d) => d ?? { objetivos: [], sugerencias: [], proximasSesiones: [], pospuestas: 0, error: true });
            setPendientes(rp.data.actividades);
            setTodos(rt.data.actividades);
            if (ra.ok) setActividades(ra.data);
            setError('');
        } catch (e) {
            setPendientes((p) => p ?? []); setTodos((t) => t ?? []); setActividades((a) => a ?? []);
            setError(e?.message && !/fetch/i.test(e.message) ? e.message : 'No se pudieron cargar tus repasos.');
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const disponibles = useMemo(() => {
        const activos = new Set((todos ?? []).map((a) => a.id));
        return (actividades ?? []).filter((a) => !activos.has(a.id) && !a.repaso)
            .sort((x, y) => Number(y.tipo === 'estudio') - Number(x.tipo === 'estudio') || x.titulo.localeCompare(y.titulo, 'es'));
    }, [actividades, todos]);

    function alCalificada(a, datos) {
        setPendientes((l) => l.filter((x) => x.id !== a.id));
        setTodos((l) => l.map((x) => (x.id === a.id ? datos.actividad : x)));
        setHechos((h) => [{ id: a.id, titulo: a.titulo, calificacion: datos.calificacion, ...datos.resultado }, ...h]);
        aviso(`🧠 «${a.titulo}»: próximo repaso ${cuandoRepaso(datos.resultado.proximaFecha)} (${diaCorto(datos.resultado.proximaFecha)}).`);
    }

    async function activar(e) {
        e.preventDefault();
        if (!elegida) { setEstadoAlta(estadoMsg('Elige una actividad para empezar a repasarla.', 'error')); return; }
        try {
            const r = await apiRepaso.activar(elegida, primera);
            if (!r.ok) { setEstadoAlta(estadoMsg(mensajeDeError(r, 'No se pudo activar el repaso.'), 'error')); return; }
            setEstadoAlta(estadoMsg(`Listo: «${r.data.actividad.titulo}» entra en repaso (primer repaso ${cuandoRepaso(r.data.actividad.repaso.proximaFecha)}).`, 'ok'));
            setElegida('');
            await cargar();
        } catch (err) { setEstadoAlta(estadoMsg(mensajeDeError(err), 'error')); }
    }
    async function analizarArchivo(e) {
        const archivo = e.target.files?.[0];
        e.target.value = '';
        if (!archivo) return;
        if (archivo.size > 5 * 1048576) { setAnalisis({ estado: 'error', error: `«${archivo.name}» pesa más de 5 MB.` }); return; }
        const fd = new FormData();
        fd.append('fechaHoy', hoyISO()); fd.append('tzOffset', String(tzOffset())); fd.append('horaLocal', horaLocal());
        fd.append('archivo', archivo, archivo.name);
        setAnalisis({ estado: 'leyendo', nombre: archivo.name });
        try {
            const r = await apiEstudio.analizar(fd);
            if (!r.ok) { setAnalisis({ estado: 'error', error: mensajeDeError(r, 'No se pudo analizar el archivo.') }); return; }
            setAnalisis({ estado: 'listo', datos: r.data, nombre: archivo.name });
        } catch (err) { setAnalisis({ estado: 'error', error: mensajeDeError(err) }); }
    }
    const objetivos = datos?.objetivos ?? [];
    const activos = objetivos.filter((o) => o.estado !== 'completado');
    const visibles = filtro === 'activos' ? activos : objetivos.filter((o) => o.estado === 'completado');
    const cuenta = (s) => activos.filter((o) => o.resumen.situacion === s).length;

    async function desactivar(a) {
        const r = await apiRepaso.desactivar(a.id).catch(() => null);
        if (!r?.ok) { aviso(mensajeDeError(r, 'No se pudo quitar del repaso.')); return; }
        aviso(`«${a.titulo}» ya no está en repaso (la actividad sigue en tu agenda).`);
        await cargar();
    }

    return (
        <>
        <main id="contenido" className="repaso-app">
            <div className="repaso-cabecera" ref={revelar} data-revelar="arriba">
                <h1>Estudio</h1>
                <p className="repaso-sub">Organiza lo que necesitas aprender, sigue tus temas y refuerza lo aprendido con repasos espaciados (SM-2).</p>
            </div>
            {error ? <p className="error-formulario" role="alert">{error}</p> : null}

            {datos?.sugerencias?.length ? (
                <section className="repaso-seccion estudio-sugerencias" aria-labelledby="estudio-sug-titulo">
                    <h2 id="estudio-sug-titulo">{`Sugerencias de Nexo (${datos.sugerencias.length})`}</h2>
                    <p className="repaso-sub">Temas que detecté en tus conversaciones, proyectos o documentos. Tú decides: añadirlos, posponerlos o descartarlos.</p>
                    <div className="estudio-rejilla">
                        {datos.sugerencias.map((o) => <SugerenciaEstudio key={o.id} sugerencia={{ objetivo: o, motivo: o.motivo }} alResuelta={() => cargar()} />)}
                    </div>
                </section>
            ) : null}

            <section className="repaso-seccion estudio-objetivos" aria-labelledby="estudio-objetivos-titulo">
                <div className="estudio-seccion-cabecera">
                    <div>
                        <h2 id="estudio-objetivos-titulo">Tus temas de estudio</h2>
                        <p className="repaso-sub">Temas, habilidades y competencias que quieres dominar, con su fecha límite, prioridad y progreso.</p>
                    </div>
                    <button type="button" className="boton boton-primario" onClick={() => setNuevo((v) => !v)} aria-expanded={nuevo}>{nuevo ? 'Cerrar' : '+ Nuevo tema'}</button>
                </div>
                {nuevo ? <div className="card estudio-nuevo"><FormularioObjetivo alGuardado={(o, { reactivado }) => { setNuevo(false); aviso(reactivado ? `«${o.tema}» vuelve a estar en Estudio.` : `«${o.tema}» añadido a Estudio.`); cargar(); }} alCancelar={() => setNuevo(false)} /></div> : null}
                {datos === null ? <Esqueleto variante="tarjetas" filas={2} texto="Cargando tus temas…" /> : (
                    <>
                        {datos.error ? <p className="error-formulario" role="alert">No se pudieron cargar tus temas de estudio.</p> : null}
                        <div className="estudio-resumen" role="group" aria-label="Filtrar temas">
                            <button type="button" className={`estudio-filtro${filtro === 'activos' ? ' activo' : ''}`} aria-pressed={filtro === 'activos'} onClick={() => setFiltro('activos')}>{`Activos (${activos.length})`}</button>
                            <button type="button" className={`estudio-filtro${filtro === 'completados' ? ' activo' : ''}`} aria-pressed={filtro === 'completados'} onClick={() => setFiltro('completados')}>{`Completados (${objetivos.length - activos.length})`}</button>
                            {cuenta('atrasado') ? <span className="estudio-insignia situacion-atrasado">{`${cuenta('atrasado')} atrasado${cuenta('atrasado') === 1 ? '' : 's'}`}</span> : null}
                            {cuenta('proximo') ? <span className="estudio-insignia situacion-proximo">{`${cuenta('proximo')} por vencer`}</span> : null}
                            {datos.pospuestas ? <span className="estudio-meta">{`${datos.pospuestas} sugerencia${datos.pospuestas === 1 ? '' : 's'} pospuesta${datos.pospuestas === 1 ? '' : 's'}`}</span> : null}
                        </div>
                        {visibles.length ? (
                            <div className="estudio-rejilla" ref={revelar} data-revelar-grupo="">
                                {visibles.map((o) => <TarjetaObjetivo key={o.id} objetivo={o} alCambiar={(m) => { if (m) aviso(m); cargar(); }} alConsultar={(x) => setTemaChat({ tema: x.tema, objetivoId: x.id })} />)}
                            </div>
                        ) : <p className="vacio">{filtro === 'activos' ? 'Aún no tienes temas activos. Añade uno, cuéntale a Nexo qué te cuesta o analiza un taller.' : 'Todavía no has completado ningún tema.'}</p>}
                    </>
                )}
            </section>

            <section className="repaso-seccion" aria-labelledby="estudio-proximas-titulo">
                <h2 id="estudio-proximas-titulo">Próximas sesiones de estudio</h2>
                {datos === null ? <Esqueleto variante="texto" filas={2} texto="Cargando tus sesiones…" />
                    : datos.proximasSesiones?.length ? (
                        <ul className="estudio-proximas">
                            {datos.proximasSesiones.map((s) => (
                                <li key={s.id} className="card">
                                    <span className="estudio-proximas-fecha">{diaCorto(s.fecha_inicio)}{s.hora_inicio ? ` · ${s.hora_inicio}–${s.hora_fin ?? ''}` : ''}</span>
                                    <strong>{s.tema}</strong>
                                    <span className="estudio-meta">{`${String(s.horas).replace('.', ',')} h${s.fecha_inicio === hoy ? ' · hoy' : ''}`}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="vacio">No tienes sesiones programadas. Usa «Planificar sesiones» en un tema y elige las que quieras guardar.</p>}
            </section>

            <section className="repaso-seccion card estudio-analizar" aria-labelledby="estudio-analizar-titulo">
                <h2 id="estudio-analizar-titulo">Analizar un taller o trabajo</h2>
                <p className="repaso-sub">Sube el enunciado (PDF, DOCX, TXT o MD). Nexo identifica los temas que necesitas, los requisitos y las fechas (entrega, publicación, evaluación…). Revisas todo antes de guardar: no se inventa ninguna fecha.</p>
                <label className="boton estudio-subir">
                    <input type="file" accept=".pdf,.docx,.txt,.md" onChange={analizarArchivo} disabled={analisis?.estado === 'leyendo'} />
                    {analisis?.estado === 'leyendo' ? `Leyendo «${analisis.nombre}»…` : '📎 Elegir archivo'}
                </label>
                {analisis?.estado === 'leyendo' ? <p className="estudio-meta" role="status">Esto puede tardar un poco: el modelo de IA lee el documento por partes.</p> : null}
                {analisis?.estado === 'error' ? <p className="error-formulario" role="alert">{analisis.error}</p> : null}
                {analisis?.estado === 'listo' ? (
                    analisis.datos.tipo === 'analisis_estudio'
                        ? <><p role="status">{analisis.datos.mensaje}</p><AnalisisDocumento key={analisis.nombre + analisis.datos.analisis.titulo} analisis={analisis.datos.analisis} alGuardado={() => cargar()} /></>
                        : <p role="status">{analisis.datos.mensaje}</p>
                ) : null}
            </section>

            <section className="repaso-seccion" aria-labelledby="repaso-hoy-titulo">
                <h2 id="repaso-hoy-titulo">{`Repaso espaciado: pendientes${pendientes ? ` (${pendientes.length})` : ''}`}</h2>
                {pendientes === null ? <Esqueleto variante="tarjetas" filas={2} texto="Buscando tus sesiones de repaso…" /> : pendientes.length === 0 ? (
                    <div className="vacio">
                        <p>{hechos.length ? '¡Repasos de hoy completados! 🎉' : 'No tienes repasos pendientes para hoy.'}</p>
                        {todos?.length ? <p>{`Tu próximo repaso: «${todos[0].titulo}», ${cuandoRepaso(todos[0].repaso?.proximaFecha)}.`}</p> : <p>Añade un tema abajo para empezar.</p>}
                    </div>
                ) : (
                    <ul className="repaso-lista" ref={revelar} data-revelar-grupo="">{pendientes.map((a) => <TarjetaPendiente key={a.id} a={a} alCalificada={alCalificada} />)}</ul>
                )}
                {hechos.length ? (
                    <div className="repaso-hechos" aria-live="polite">
                        <h3>Repasado hoy</h3>
                        <ul>{hechos.map((h) => <li key={`${h.id}-${h.proximaFecha}`}>{`${h.titulo}: ${h.calificacion}/5 → próximo ${diaLargo(h.proximaFecha)} (cada ${h.intervalo} ${h.intervalo === 1 ? 'día' : 'días'})`}</li>)}</ul>
                    </div>
                ) : null}
            </section>

            <section className="repaso-seccion card" aria-labelledby="repaso-alta-titulo" ref={revelar} data-revelar="arriba">
                <h2 id="repaso-alta-titulo">Añadir un tema para repasar</h2>
                <form className="repaso-alta" noValidate onSubmit={activar}>
                    <div className="campo">
                        <label htmlFor="repaso-actividad">Actividad</label>
                        <select id="repaso-actividad" value={elegida} onChange={(e) => setElegida(e.target.value)}>
                            <option value="">{disponibles.length ? 'Elige una actividad…' : 'No hay actividades disponibles'}</option>
                            {disponibles.map((a) => <option key={a.id} value={a.id}>{`${a.titulo} · ${NOMBRE_TIPO[a.tipo] ?? a.tipo}${a.proyecto ? ` · ${a.proyecto}` : ''}`}</option>)}
                        </select>
                    </div>
                    <div className="campo">
                        <label htmlFor="repaso-primera">Primer repaso</label>
                        <input id="repaso-primera" type="date" value={primera} min={sumarDias(hoy, -365)} max={sumarDias(hoy, 365)} onChange={(e) => setPrimera(e.target.value)} />
                    </div>
                    <button type="submit" className="boton boton-primario">Activar repaso espaciado</button>
                </form>
                <Mensaje estado={estadoAlta} id="repaso-alta-estado" />
            </section>

            <section className="repaso-seccion card" aria-labelledby="repaso-todos-titulo" ref={revelar} data-revelar="arriba">
                <h2 id="repaso-todos-titulo">{`Temas con repaso activo${todos ? ` (${todos.length})` : ''}`}</h2>
                {todos === null ? <Esqueleto variante="texto" filas={3} texto="Cargando tus temas…" /> : todos.length === 0 ? <p className="vacio">Aún no tienes temas con repaso activo.</p> : (
                    <div className="repaso-tabla-marco">
                        <table className="repaso-tabla">
                            <caption className="solo-lectores">Temas en repaso espaciado</caption>
                            <thead>
                                <tr><th scope="col">Tema</th><th scope="col">Próximo repaso</th><th scope="col">Repeticiones</th><th scope="col">Intervalo</th><th scope="col">Facilidad</th><th scope="col"><span className="solo-lectores">Acciones</span></th></tr>
                            </thead>
                            <tbody>
                                {todos.map((a) => (
                                    <tr key={a.id} className={a.repaso?.proximaFecha <= hoy ? 'toca' : ''}>
                                        <th scope="row">{a.titulo}</th>
                                        <td>{a.repaso?.proximaFecha ? `${diaCorto(a.repaso.proximaFecha)} (${cuandoRepaso(a.repaso.proximaFecha)})` : '—'}</td>
                                        <td>{a.repaso?.repeticiones ?? 0}</td>
                                        <td>{`${a.repaso?.intervalo ?? 0} d`}</td>
                                        <td>{(a.repaso?.facilidad ?? 2.5).toFixed(2)}</td>
                                        <td><BotonConfirmar className="boton boton-mini" textoConfirmar="¿Quitar?" aria-label={`Quitar ${a.titulo} del repaso`} alConfirmar={() => desactivar(a)}>Quitar</BotonConfirmar></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <details className="repaso-explicacion">
                    <summary>¿Cómo se calcula la próxima fecha?</summary>
                    <ul>
                        <li>Con 3 o más («Con esfuerzo», «Bien», «Perfecto») el tema avanza: 1 día, luego 6 días y después el intervalo anterior × su facilidad.</li>
                        <li>Con menos de 3 el tema vuelve a empezar: lo repasas mañana.</li>
                        <li>La facilidad (mínimo 1,3) sube cuando lo recuerdas bien y baja cuando te cuesta.</li>
                    </ul>
                </details>
            </section>
        </main>
        <ChatFlotante contexto={{ seccion: 'estudio', tema: temaChat?.tema || '', objetivoId: temaChat?.objetivoId || '' }} alActualizar={cargar} />
        </>
    );
}
