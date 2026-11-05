// Repaso espaciado (NUEVA pantalla, v3.6): interfaz para la API /api/repaso que existía sin pantalla en la 3.4.2.
//  · «Para repasar hoy»: temas con repaso pendiente (vencidos o de hoy). Calificas cómo lo recordaste (0–5) y el
//    servidor calcula con SM-2 la próxima fecha (el cálculo NO se hace en el navegador).
//  · «Añadir un tema»: activa el repaso en una de tus actividades (por defecto, primer repaso hoy).
//  · «Todos tus temas»: próxima fecha, repeticiones y facilidad; puedes quitar un tema del repaso.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NOMBRE_TIPO } from '@compartido/catalogos.js';
import { diasEntre, sumarDias } from '@compartido/fechas.js';
import { diaLargo, diaCorto, hoyISO } from '../../../comun/fechas-locales.js';
import { BotonConfirmar } from '../../../comun/ui/BotonConfirmar.jsx';
import { Cargando } from '../../../comun/ui/Cargando.jsx';
import { Mensaje, estadoMsg } from '../../../comun/ui/Mensaje.jsx';
import { useAvisos } from '../../../comun/ui/Avisos.jsx';
import { mensajeDeError } from '../../../api/cliente.js';
import { repaso as apiRepaso, actividades as apiActividades } from '../../api.js';
import './repaso.css';

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
        <li className="repaso-tarjeta card">
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
                        <button key={c.valor} type="button" className={`boton repaso-nota nota-${c.valor}`} title={c.ayuda}
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
    const [pendientes, setPendientes] = useState(null);
    const [todos, setTodos] = useState(null);
    const [actividades, setActividades] = useState([]);
    const [hechos, setHechos] = useState([]);                // repasos calificados en esta visita
    const [elegida, setElegida] = useState('');
    const [primera, setPrimera] = useState(hoy);
    const [estadoAlta, setEstadoAlta] = useState(estadoMsg());
    const [error, setError] = useState('');
    const { aviso } = useAvisos();

    const cargar = useCallback(async () => {
        try {
            const [rp, rt, ra] = await Promise.all([apiRepaso.pendientes(), apiRepaso.todos(), apiActividades.listar()]);
            if (!rp.ok || !rt.ok) throw new Error(mensajeDeError(rp.ok ? rt : rp));
            setPendientes(rp.data.actividades);
            setTodos(rt.data.actividades);
            if (ra.ok) setActividades(ra.data);
            setError('');
        } catch (e) {
            setPendientes((p) => p ?? []); setTodos((t) => t ?? []);
            setError(e?.message && !/fetch/i.test(e.message) ? e.message : 'No se pudieron cargar tus repasos.');
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const disponibles = useMemo(() => {
        const activos = new Set((todos ?? []).map((a) => a.id));
        return actividades.filter((a) => !activos.has(a.id) && !a.repaso)
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
    async function desactivar(a) {
        const r = await apiRepaso.desactivar(a.id).catch(() => null);
        if (!r?.ok) { aviso(mensajeDeError(r, 'No se pudo quitar del repaso.')); return; }
        aviso(`«${a.titulo}» ya no está en repaso (la actividad sigue en tu agenda).`);
        await cargar();
    }

    return (
        <main id="contenido" className="repaso-app">
            <div className="repaso-cabecera">
                <h1>🧠 Repaso espaciado</h1>
                <p className="repaso-sub">Repasa cada tema justo antes de olvidarlo. Tras cada repaso dices qué tan bien lo recordaste y LearnTrack calcula cuándo volver a verlo (algoritmo SM-2).</p>
            </div>
            {error ? <p className="error-formulario" role="alert">{error}</p> : null}

            <section className="repaso-seccion" aria-labelledby="repaso-hoy-titulo">
                <h2 id="repaso-hoy-titulo">{`Para repasar hoy${pendientes ? ` (${pendientes.length})` : ''}`}</h2>
                {pendientes === null ? <Cargando texto="Buscando tus repasos…" /> : pendientes.length === 0 ? (
                    <div className="vacio">
                        <p>{hechos.length ? '¡Repasos de hoy completados! 🎉' : 'No tienes repasos pendientes para hoy.'}</p>
                        {todos?.length ? <p>{`Tu próximo repaso: «${todos[0].titulo}», ${cuandoRepaso(todos[0].repaso?.proximaFecha)}.`}</p> : <p>Añade un tema abajo para empezar.</p>}
                    </div>
                ) : (
                    <ul className="repaso-lista">{pendientes.map((a) => <TarjetaPendiente key={a.id} a={a} alCalificada={alCalificada} />)}</ul>
                )}
                {hechos.length ? (
                    <div className="repaso-hechos" aria-live="polite">
                        <h3>Repasado hoy</h3>
                        <ul>{hechos.map((h) => <li key={`${h.id}-${h.proximaFecha}`}>{`${h.titulo}: ${h.calificacion}/5 → próximo ${diaLargo(h.proximaFecha)} (cada ${h.intervalo} ${h.intervalo === 1 ? 'día' : 'días'})`}</li>)}</ul>
                    </div>
                ) : null}
            </section>

            <section className="repaso-seccion card" aria-labelledby="repaso-alta-titulo">
                <h2 id="repaso-alta-titulo">Añadir un tema</h2>
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
                    <button type="submit" className="boton boton-primario">Empezar a repasar</button>
                </form>
                <Mensaje estado={estadoAlta} id="repaso-alta-estado" />
            </section>

            <section className="repaso-seccion card" aria-labelledby="repaso-todos-titulo">
                <h2 id="repaso-todos-titulo">{`Todos tus temas${todos ? ` (${todos.length})` : ''}`}</h2>
                {todos === null ? <Cargando /> : todos.length === 0 ? <p className="vacio">Aún no repasas ningún tema.</p> : (
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
    );
}
