// Proyectos: eliges un proyecto y ves sus subtareas como Kanban (Pendiente / En proceso / Completado, con arrastrar
// y soltar o con los botones ◀ ▶ accesibles por teclado) o como Línea de tiempo (Gantt con la fecha de
// vencimiento). Incluye las tareas archivadas por la limpieza automática (cuentan para el progreso y se pueden
// devolver a la agenda). Migrado de frontend/privado/proyectos.
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { sumarDias, diasEntre, textoHorario } from '@compartido/fechas.js';
import { ESTADOS, NOMBRE_TIPO, NOMBRE_ESTADO } from '@compartido/catalogos.js';
import { prioridadDe, porUrgencia, textoVencimiento, NOMBRE_PRIORIDAD } from '@compartido/prioridad.js';
import { normalizarActividad } from '@compartido/carga.js';
import { aFecha, formatear, diaCorto, horasTxt, hoyISO } from '../../../comun/fechas-locales.js';
import { useAvisos } from '../../../comun/ui/Avisos.jsx';
import { Cargando } from '../../../comun/ui/Cargando.jsx';
import { actividades as apiActividades, proyectos as apiProyectos } from '../../api.js';
import { useFormularioActividad } from '../../actividades/FormularioActividad.jsx';
import '../../estilos/actividades.css';
import './proyectos.css';

const CLAVE_MODO = 'learntrack_vista_proyecto';
const claseAct = (a) => `t-${a.tipo} est-${a.estado}${a.exigencia === 3 ? ' exig-alta' : ''}${a.archivada ? ' archivada' : ''}`;
const Insignia = ({ texto, clase = '' }) => <span className={`insignia ${clase}`.trim()}>{texto}</span>;
function InsigniaPrioridad({ a }) {
    const p = prioridadDe(a, hoyISO());
    if (p.nivel === 'ninguna' || (p.nivel === 'media' && !p.vencimiento)) return null;
    return <Insignia texto={[p.nivel === 'urgente' ? '⚠ Urgente' : NOMBRE_PRIORIDAD[p.nivel], textoVencimiento(p)].filter(Boolean).join(' · ')} clase={`prioridad-${p.nivel}`} />;
}
const modoGuardado = () => { try { const m = localStorage.getItem(CLAVE_MODO); return m === 'kanban' || m === 'timeline' ? m : 'kanban'; } catch { return 'kanban'; } };

// ---------------------------------------------------------------- Kanban
function Kanban({ tareas, alAbrir, alCambiarEstado, alDesarchivar, todas }) {
    const [sobre, setSobre] = useState(null);
    return (
        <div className="kanban">
            {ESTADOS.map((estado, idx) => {
                const lista = tareas.filter((a) => a.estado === estado).sort(porUrgencia(hoyISO()));
                return (
                    <div key={estado} className={`kb-col${sobre === estado ? ' sobre' : ''}`} data-estado={estado} role="list" aria-label={NOMBRE_ESTADO[estado]}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setSobre(estado); }}
                        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSobre(null); }}
                        onDrop={(e) => {
                            e.preventDefault(); setSobre(null);
                            const act = todas.find((x) => x.id === e.dataTransfer.getData('text/plain'));
                            if (act) alCambiarEstado(act, estado);
                        }}>
                        <header><h3>{NOMBRE_ESTADO[estado]}</h3><span className="kb-cuenta">{lista.length}</span></header>
                        {lista.length === 0 ? <div className="kb-vacio">Arrastra tarjetas aquí</div> : null}
                        {lista.map((a) => (
                            <article key={a.id} className={`kb-tarjeta ${claseAct(a)}`} draggable={!a.archivada} role="listitem"
                                onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('arrastrando'); }}
                                onDragEnd={(e) => e.currentTarget.classList.remove('arrastrando')}>
                                <button type="button" className="tit-k tit" disabled={a.archivada} onClick={() => alAbrir(a)}>{a.titulo}</button>
                                <div className="meta">
                                    <Insignia texto={NOMBRE_TIPO[a.tipo]} clase={`t-${a.tipo}`} />
                                    {a.exigencia === 3 ? <Insignia texto="Alta" clase="alta" /> : null}
                                    <InsigniaPrioridad a={a} />
                                    {a.archivada ? <Insignia texto="🗄 Archivada" /> : null}
                                </div>
                                <div className="cuando">{`${diaCorto(a.fecha_inicio)}${a.fecha_fin !== a.fecha_inicio ? ` → ${diaCorto(a.fecha_fin)}` : ''}${a.hora_inicio ? ` · ${textoHorario(a)}` : ''} · ${horasTxt(a.horas)}${a.fecha_vencimiento ? ` · vence ${diaCorto(a.fecha_vencimiento)}` : ''}`}</div>
                                <div className="kb-mover">
                                    {a.archivada
                                        ? <button type="button" className="boton boton-mini" onClick={() => alDesarchivar(a)}>↩ Devolver a la agenda</button>
                                        : (
                                            <>
                                                <button type="button" className="boton boton-mini" disabled={idx === 0} aria-label={`Mover ${a.titulo} a ${NOMBRE_ESTADO[ESTADOS[idx - 1]] ?? ''}`} onClick={() => alCambiarEstado(a, ESTADOS[idx - 1])}>◀</button>
                                                <button type="button" className="boton boton-mini" disabled={idx === ESTADOS.length - 1} aria-label={`Mover ${a.titulo} a ${NOMBRE_ESTADO[ESTADOS[idx + 1]] ?? ''}`} onClick={() => alCambiarEstado(a, ESTADOS[idx + 1])}>▶</button>
                                            </>
                                        )}
                                </div>
                            </article>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------- Línea de tiempo (Gantt)
function Gantt({ tareas, alAbrir }) {
    const hoy = hoyISO();
    const ordenadas = [...tareas].sort((x, y) => x.fecha_inicio.localeCompare(y.fecha_inicio) || x.titulo.localeCompare(y.titulo, 'es'));
    if (ordenadas.length === 0) return <div className="vacio">Este proyecto no tiene tareas.</div>;
    const fechas = ordenadas.flatMap((a) => [a.fecha_inicio, a.fecha_fin, a.fecha_vencimiento].filter(Boolean)).concat(hoy).sort();
    const ini = sumarDias(fechas[0], -1), fin = sumarDias(fechas.at(-1), 1);
    const n = Math.min(diasEntre(ini, fin) + 1, 120);
    const ETQ = 220, DW = 30;
    const plantilla = `${ETQ}px repeat(${n}, ${DW}px)`;
    const dias = Array.from({ length: n }, (_, i) => sumarDias(ini, i));
    const ultimo = dias.at(-1);
    const columna = (desde, hasta) => {
        const c1 = Math.max(0, diasEntre(ini, desde)), c2 = Math.min(n - 1, diasEntre(ini, hasta));
        return `${c1 + 2} / ${c2 + 3}`;
    };
    const celdas = dias.map((d, i) => (
        <div key={d} className={`g-celda${aFecha(d).getDay() % 6 === 0 ? ' fin-sem' : ''}${d === hoy ? ' hoy' : ''}`} style={{ gridColumn: String(i + 2), gridRow: '1' }} />
    ));
    return (
        <div>
            <div className="gantt-marco">
                <div style={{ minWidth: `${ETQ + n * DW}px` }}>
                    <div className="g-fila g-cab" style={{ gridTemplateColumns: plantilla }}>
                        <div className="g-etq">Tarea</div>
                        {dias.map((d) => <div key={d} className={`g-dia${d === hoy ? ' hoy' : ''}`}><strong>{aFecha(d).getDate()}</strong>{formatear(d, { month: 'short' }).replace('.', '')}</div>)}
                    </div>
                    {ordenadas.map((a) => {
                        const desc = `${a.titulo}. ${NOMBRE_ESTADO[a.estado]}. Del ${diaCorto(a.fecha_inicio)} al ${diaCorto(a.fecha_fin)}${a.fecha_vencimiento ? `, vence el ${diaCorto(a.fecha_vencimiento)}` : ''}.`;
                        return (
                            <div key={a.id} className="g-fila" style={{ gridTemplateColumns: plantilla }}>
                                <div className="g-etq" style={{ gridColumn: '1', gridRow: '1' }}>
                                    <span className={`punto t-${a.tipo}`} /><span className="t" title={a.titulo}>{a.titulo}</span>
                                    {prioridadDe(a, hoy).nivel === 'urgente' ? <span className="g-urgente" title="Urgente: vence en 2 días o menos">⚠</span> : null}
                                </div>
                                {celdas}
                                {a.fecha_vencimiento && a.fecha_vencimiento <= ultimo
                                    ? <span className="g-vence" title={`Vence el ${diaCorto(a.fecha_vencimiento)}`} aria-hidden="true" style={{ gridColumn: columna(a.fecha_vencimiento, a.fecha_vencimiento), gridRow: '1' }}>◆</span>
                                    : null}
                                <button type="button" className={`g-barra ${claseAct(a)}`} title={desc} aria-label={desc} disabled={a.archivada}
                                    style={{ gridColumn: columna(a.fecha_inicio, a.fecha_fin), gridRow: '1' }} onClick={() => alAbrir(a)}>{a.titulo}</button>
                            </div>
                        );
                    })}
                </div>
            </div>
            <p className="gantt-leyenda">◆ = fecha de vencimiento · franja sombreada = hoy · las barras rayadas están en proceso</p>
        </div>
    );
}

// ---------------------------------------------------------------- pantalla
export default function Proyectos() {
    const [proyectos, setProyectos] = useState(null);           // resumen del servidor (null = cargando)
    const [actividades, setActividades] = useState([]);         // activas + archivadas
    const [modo, setModoEstado] = useState(modoGuardado);
    const { hash } = useLocation();
    const navegar = useNavigate();
    const seleccionadoHash = hash.length > 1 ? decodeURIComponent(hash.slice(1)) : null;
    const [seleccionado, setSeleccionado] = useState(seleccionadoHash);
    const { aviso } = useAvisos();

    const cargar = useCallback(async () => {
        try {
            const [rp, ra] = await Promise.all([apiProyectos.listar(), apiActividades.listar({ archivadas: true })]);
            const lista = rp.ok ? rp.data.proyectos : [];
            setProyectos(lista);
            if (ra.ok) setActividades(ra.data.map(normalizarActividad));
            setSeleccionado((s) => (lista.some((p) => p.nombre === s) ? s : (lista.find((p) => p.progreso < 100)?.nombre ?? lista[0]?.nombre ?? null)));
        } catch {
            setProyectos((p) => p ?? []);
            aviso('No se pudieron cargar tus proyectos. Recarga la página.');
        }
    }, [aviso]);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { if (seleccionadoHash && proyectos?.some((p) => p.nombre === seleccionadoHash)) setSeleccionado(seleccionadoHash); }, [seleccionadoHash, proyectos]);

    const formulario = useFormularioActividad({ alCambiar: () => cargar(), proyectos: (proyectos ?? []).map((p) => p.nombre) });
    const setModo = (m) => { setModoEstado(m); try { localStorage.setItem(CLAVE_MODO, m); } catch { /* sin almacenamiento */ } };
    const elegir = (nombre) => { setSeleccionado(nombre); navegar({ hash: `#${encodeURIComponent(nombre)}` }, { replace: true }); };

    async function cambiarEstado(a, estado) {
        if (a.estado === estado || a.archivada) return;
        setActividades((l) => l.map((x) => (x.id === a.id ? { ...x, estado } : x)));         // optimista
        const r = await apiActividades.editar(a.id, { estado }).catch(() => null);
        if (!r?.ok) { setActividades((l) => l.map((x) => (x.id === a.id ? { ...x, estado: a.estado } : x))); aviso('No pude cambiar el estado. Inténtalo de nuevo.'); return; }
        await cargar();
    }
    async function desarchivar(a) {
        const r = await apiActividades.desarchivar(a.id).catch(() => null);
        if (r?.ok) { aviso(`«${a.titulo}» vuelve a tu agenda.`); await cargar(); } else aviso('No se pudo devolver a la agenda.');
    }
    const abrir = (a) => { if (!a.archivada) formulario.abrir(a); };

    const p = proyectos?.find((x) => x.nombre === seleccionado) ?? null;
    const tareas = actividades.filter((a) => a.proyecto === seleccionado);
    const hechas = tareas.filter((a) => a.estado === 'completado').length;
    const progreso = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;

    return (
        <>
            <main id="contenido" className="proyectos-app">
                <div className="proyectos-cabecera">
                    <div>
                        <h1>Proyectos</h1>
                        <p className="proyectos-sub">Elige un proyecto y sigue el avance de sus subtareas en Kanban o en línea de tiempo.</p>
                    </div>
                </div>
                <div className="proyectos-layout">
                    <aside className="proyectos-lista card" aria-labelledby="lista-titulo">
                        <h2 id="lista-titulo">Tus proyectos</h2>
                        {proyectos === null ? <Cargando texto="Cargando proyectos…" /> : (
                            <ul id="lista-proyectos" className="lista-proyectos">
                                {proyectos.length === 0 ? (
                                    <li className="proyectos-vacio">
                                        <p>Todavía no tienes proyectos.</p>
                                        <p>Pídeselo al asistente («Tengo que hacer un proyecto de bases de datos para el 20 de noviembre») o ponle un nombre de proyecto a tus actividades.</p>
                                        <Link className="boton boton-primario" to="/panel">Ir al asistente</Link>
                                    </li>
                                ) : proyectos.map((x) => {
                                    const activo = x.nombre === seleccionado;
                                    return (
                                        <li key={x.nombre}>
                                            <button type="button" className={`proyecto-tarjeta prioridad-${x.prioridad}${activo ? ' activo' : ''}`} aria-pressed={activo}
                                                aria-label={`${x.nombre}: ${x.progreso} % (${x.completadas} de ${x.total} tareas)`} onClick={() => elegir(x.nombre)}>
                                                <span className="proyecto-nombre">{`📁 ${x.nombre}`}</span>
                                                <span className="proyecto-barra" aria-hidden="true"><i style={{ width: `${x.progreso}%` }} /></span>
                                                <span className="proyecto-datos">{`${x.progreso} % · ${x.completadas}/${x.total} tareas${x.fin ? ` · hasta ${diaCorto(x.fin)}` : ''}`}</span>
                                                <small className="proyecto-siguiente">{x.siguiente ? `Siguiente: ${x.siguiente.titulo}` : '✓ Todo terminado'}</small>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </aside>

                    <section className="proyectos-detalle card" aria-live="polite">
                        {!p ? <p id="detalle-vacio" className="vacio">Selecciona un proyecto para ver sus tareas.</p> : (
                            <div id="detalle-proyecto">
                                <div className="detalle-cabecera">
                                    <div>
                                        <h2 id="proyecto-titulo">{p.nombre}</h2>
                                        <p id="proyecto-resumen" className="proyecto-resumen">{`${hechas} de ${tareas.length} tareas completadas${p.inicio && p.fin ? ` · ${diaCorto(p.inicio)} → ${diaCorto(p.fin)}` : ''}`}</p>
                                    </div>
                                    <div className="detalle-acciones">
                                        <div className="selector-modo" role="group" aria-label="Forma de ver el proyecto">
                                            <button type="button" className="boton" data-modo="kanban" aria-pressed={modo === 'kanban'} onClick={() => setModo('kanban')}>▦ Kanban</button>
                                            <button type="button" className="boton" data-modo="timeline" aria-pressed={modo === 'timeline'} onClick={() => setModo('timeline')}>▤ Línea de tiempo</button>
                                        </div>
                                        <button type="button" className="boton boton-primario" id="btn-nueva-tarea" onClick={() => formulario.abrir(null, { proyecto: seleccionado ?? '' })}>+ Tarea</button>
                                    </div>
                                </div>
                                <div className="proyecto-progreso">
                                    <div className="barra-progreso" id="proyecto-progreso-rol" role="progressbar" aria-labelledby="proyecto-titulo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progreso}>
                                        <i id="proyecto-progreso" style={{ width: `${progreso}%` }} />
                                    </div>
                                    <strong id="proyecto-progreso-texto">{`${progreso} %`}</strong>
                                </div>
                                <div id="vista-proyecto" className="vista-proyecto">
                                    {modo === 'kanban'
                                        ? <Kanban tareas={tareas} todas={actividades} alAbrir={abrir} alCambiarEstado={cambiarEstado} alDesarchivar={desarchivar} />
                                        : <Gantt tareas={tareas} alAbrir={abrir} />}
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </main>
            {formulario.formulario}
        </>
    );
}
