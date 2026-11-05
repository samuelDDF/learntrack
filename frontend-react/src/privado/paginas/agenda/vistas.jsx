// Vistas de Mi agenda (Mes, Semana, Día), mini calendario, próximas entregas y línea de tiempo académica.
// Migradas de frontend/privado/calendario/calendario.js con el mismo marcado y clases (calendario.css → agenda.css).
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { esEntregaOExamen } from '@compartido/carga.js';
import { sumarDias, diasEntre, inicioSemana, primerDiaMes, aMinutos, textoHorario } from '@compartido/fechas.js';
import { NOMBRE_TIPO, NOMBRE_EXIGENCIA, NOMBRE_ESTADO } from '@compartido/catalogos.js';
import { prioridadDe, porUrgencia, textoVencimiento, NOMBRE_PRIORIDAD } from '@compartido/prioridad.js';
import { aFecha, formatear, diaLargo, horasTxt, hoyISO } from '../../../comun/fechas-locales.js';

export const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const HPX = 48;                              // alto en píxeles de una hora en la vista semanal

const mismoMes = (a, b) => a.slice(0, 7) === b.slice(0, 7);
export const cuadriculaMes = (iso) => { const ini = inicioSemana(primerDiaMes(iso)); return Array.from({ length: 42 }, (_, i) => sumarDias(ini, i)); };
export const claseAct = (a) => `t-${a.tipo} est-${a.estado}${a.exigencia === 3 ? ' exig-alta' : ''}`;
const descripcionAct = (a) => `${a.titulo}. ${NOMBRE_TIPO[a.tipo]}. ${textoHorario(a) || 'Sin hora'}. ${NOMBRE_ESTADO[a.estado]}.`;
const urgente = (a) => prioridadDe(a, hoyISO()).nivel === 'urgente';

/** Agrupa bloques que se solapan y reparte el ancho en carriles (vista semanal) */
export function distribuirSolapes(items) {
    const ord = [...items].sort((x, y) => x.ini - y.ini || y.fin - x.fin);
    const grupos = [];
    let grupo = null, finGrupo = -1;
    for (const it of ord) {
        if (!grupo || it.ini >= finGrupo) { grupo = []; grupos.push(grupo); finGrupo = -1; }
        grupo.push(it);
        finGrupo = Math.max(finGrupo, it.fin);
    }
    for (const g of grupos) {
        const finCarril = [];
        for (const it of g) {
            let c = finCarril.findIndex((f) => f <= it.ini);
            if (c === -1) { c = finCarril.length; finCarril.push(0); }
            finCarril[c] = it.fin; it.carril = c;
        }
        g.forEach((it) => { it.carriles = finCarril.length; });
    }
    return ord;
}

// ---------------------------------------------------------------- piezas
export function InsigniaCarga({ c, siempre = false }) {
    if (!siempre && c.cantidad === 0) return null;
    const txt = c.nivel === 'verde' ? 'equilibrado' : c.nivel === 'amarillo' ? 'moderado' : 'saturado';
    return <span className={`carga-dia nivel-${c.nivel}`} title={`Carga del día: ${c.porcentaje} % (${txt})`} aria-label={`Carga ${c.porcentaje} por ciento, ${txt}`}>{`${c.porcentaje} %`}</span>;
}

function Chip({ a, alAbrir }) {
    const desc = `${descripcionAct(a)}${urgente(a) ? ' Urgente.' : ''}`;
    return (
        <button type="button" className={`chip ${claseAct(a)}${urgente(a) ? ' urgente' : ''}`} title={desc} aria-label={desc}
            onClick={(e) => { e.stopPropagation(); alAbrir(a); }}>
            {a.hora_inicio ? <span className="h">{a.hora_inicio}</span> : null}
            <span className="tit">{a.titulo}</span>
        </button>
    );
}

const Insignia = ({ texto, clase = '' }) => <span className={`insignia ${clase}`.trim()}>{texto}</span>;
function InsigniaPrioridad({ a }) {
    const p = prioridadDe(a, hoyISO());
    if (p.nivel === 'ninguna' || (p.nivel === 'media' && !p.vencimiento)) return null;
    const texto = [p.nivel === 'urgente' ? '⚠ Urgente' : `Prioridad ${NOMBRE_PRIORIDAD[p.nivel].toLowerCase()}`, textoVencimiento(p)].filter(Boolean).join(' · ');
    return <Insignia texto={texto} clase={`prioridad-${p.nivel}`} />;
}

function ChipsFestivo({ lista }) {
    return lista.map((f, i) => <span key={i} className="chip-festivo" title={`Festivo: ${f.nombre}${f.region ? ` (${f.region})` : ''}`}>{`🎉 ${f.nombre}`}</span>);
}
const CabeceraMes = () => <div className="mes-cab">{DIAS_CORTOS.map((d) => <div key={d}>{d}</div>)}</div>;

// ---------------------------------------------------------------- Mes
export function VistaMes({ cursor, delDia, cargaDia, festivosDe, alAbrir, alNueva, alIrADia }) {
    const hoy = hoyISO();
    return (
        <div className="mes">
            <CabeceraMes />
            <div className="mes-cuerpo">
                {cuadriculaMes(cursor).map((iso) => {
                    const lista = delDia(iso);
                    const fest = festivosDe(iso);
                    const textoFest = fest.map((f) => f.nombre).join(' · ');
                    return (
                        <div key={iso} className={`dia${iso === hoy ? ' hoy' : ''}${mismoMes(iso, cursor) ? '' : ' otro-mes'}${fest.length ? ' festivo' : ''}`}
                            tabIndex={0} role="button" aria-label={`${diaLargo(iso)}.${fest.length ? ` Festivo: ${textoFest}.` : ''} ${lista.length} actividades. Pulsa para agregar.`}
                            onClick={() => alNueva({ fecha: iso })}
                            onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) alNueva({ fecha: iso }); }}>
                            <div className="dia-cab"><span className="num">{aFecha(iso).getDate()}</span><InsigniaCarga c={cargaDia(iso)} /></div>
                            <ChipsFestivo lista={fest} />
                            {lista.slice(0, 3).map((a) => <Chip key={a.id} a={a} alAbrir={alAbrir} />)}
                            {lista.length > 3 ? <button type="button" className="mas" onClick={(e) => { e.stopPropagation(); alIrADia(iso); }}>{`+${lista.length - 3} más`}</button> : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- Semana
export function VistaSemana({ cursor, delDia, cargaDia, festivosDe, alAbrir, alNueva }) {
    const hoy = hoyISO();
    const scroll = useRef(null);
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(inicioSemana(cursor), i));
    const conHora = dias.map((d) => delDia(d).filter((a) => a.hora_inicio));
    let desde = 6, hasta = 22;
    for (const a of conHora.flat()) {
        desde = Math.min(desde, Math.floor(aMinutos(a.hora_inicio) / 60));
        hasta = Math.max(hasta, Math.ceil(aMinutos(a.hora_fin || a.hora_inicio) / 60) + 1);
    }
    hasta = Math.min(24, hasta);
    // Al montarse, desplaza la cuadrícula hasta las 7 am para ver el inicio de la jornada
    useEffect(() => { if (scroll.current) scroll.current.scrollTop = Math.max(0, (7 - desde) * HPX); }, [desde, cursor]);
    const ahora = new Date();
    const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
    return (
        <div className="sem">
            <div className="sem-cab">
                <div />
                {dias.map((d, i) => (
                    <div key={d} className={`cab-dia${d === hoy ? ' hoy' : ''}${festivosDe(d).length ? ' festivo' : ''}`}>
                        {DIAS_CORTOS[i]}<strong>{aFecha(d).getDate()}</strong><InsigniaCarga c={cargaDia(d)} /><ChipsFestivo lista={festivosDe(d)} />
                    </div>
                ))}
            </div>
            <div className="sem-sinhora">
                <div>Sin hora</div>
                {dias.map((d) => <div key={d}>{delDia(d).filter((a) => !a.hora_inicio).map((a) => <Chip key={a.id} a={a} alAbrir={alAbrir} />)}</div>)}
            </div>
            <div className="sem-scroll" ref={scroll}>
                <div className="sem-cuerpo">
                    <div className="col-horas" style={{ height: `${(hasta - desde) * HPX}px` }}>
                        {Array.from({ length: hasta - desde }, (_, i) => (i === 0 ? null : <span key={i} style={{ top: `${i * HPX}px` }}>{`${String(desde + i).padStart(2, '0')}:00`}</span>))}
                    </div>
                    {dias.map((d, idx) => {
                        const items = distribuirSolapes(conHora[idx].map((a) => {
                            const ini = aMinutos(a.hora_inicio);
                            const fin = a.hora_fin ? aMinutos(a.hora_fin) : ini + Math.round(a.horas * 60);
                            return { a, ini, fin: Math.max(fin, ini + 20) };
                        }));
                        return (
                            <div key={d} className={`col-dia${d === hoy ? ' hoy' : ''}`} style={{ '--hpx': `${HPX}px`, height: `${(hasta - desde) * HPX}px` }}
                                aria-label={`Columna del ${diaLargo(d)}. Pulsa para agregar a esa hora.`}
                                onClick={(e) => {
                                    if (e.target !== e.currentTarget) return;
                                    const hora = desde + Math.floor(e.nativeEvent.offsetY / HPX);
                                    alNueva({ fecha: d, hora_inicio: `${String(Math.min(hora, 23)).padStart(2, '0')}:00` });
                                }}>
                                {items.map(({ a, ini, fin, carril, carriles }) => (
                                    <button key={a.id} type="button" className={`bloque ${claseAct(a)}`} title={descripcionAct(a)} aria-label={descripcionAct(a)}
                                        style={{
                                            top: `${((ini - desde * 60) / 60) * HPX}px`, height: `${Math.max(((fin - ini) / 60) * HPX - 2, 22)}px`,
                                            left: `calc(${(carril / carriles) * 100}% + 2px)`, width: `calc(${100 / carriles}% - 4px)`
                                        }}
                                        onClick={(e) => { e.stopPropagation(); alAbrir(a); }}>
                                        <span className="tit">{a.titulo}</span><span className="h">{textoHorario(a)}</span>
                                    </button>
                                ))}
                                {d === hoy && minAhora >= desde * 60 && minAhora <= hasta * 60
                                    ? <div className="ahora" style={{ top: `${((minAhora - desde * 60) / 60) * HPX}px` }} /> : null}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- Día
function resumenDia(lista) {
    if (lista.length === 0) return 'Sin actividades';
    const horas = lista.reduce((s, a) => s + a.horas, 0);
    const hechas = lista.filter((a) => a.estado === 'completado').length;
    return `${lista.length} ${lista.length === 1 ? 'actividad' : 'actividades'} · ${horasTxt(horas)} · ${hechas} completadas`;
}

export function VistaDia({ cursor, delDia, cargaDia, festivosDe, alAbrir, alNueva, alCambiarEstado }) {
    const lista = delDia(cursor);
    const fest = festivosDe(cursor);
    return (
        <section className="moderno-detalle" aria-label={`Actividades del ${diaLargo(cursor)}`}>
            <h3>{diaLargo(cursor)}</h3>
            <p className="resumen-dia">{resumenDia(lista)} <InsigniaCarga c={cargaDia(cursor)} /></p>
            {fest.length ? <p className="aviso-festivo" role="note">{`🎉 Festivo: ${fest.map((f) => f.nombre).join(' · ')}`}</p> : null}
            {lista.length === 0 ? (
                <div className="vacio">
                    <div>No hay actividades para este día.</div>
                    <button type="button" className="boton boton-primario" onClick={() => alNueva({ fecha: cursor })}>+ Agregar actividad</button>
                </div>
            ) : (
                <div className="det-lista">
                    {lista.map((a) => (
                        <article key={a.id} className={`det-card ${claseAct(a)}${urgente(a) ? ' urgente' : ''}`}>
                            <div className="franja" />
                            <div>
                                <h4 className="tit">{a.titulo}</h4>
                                <div className="horario">{a.hora_inicio ? `🕒 ${textoHorario(a)}` : 'Sin hora definida'}</div>
                                <div className="meta">
                                    <Insignia texto={NOMBRE_TIPO[a.tipo]} clase={`t-${a.tipo}`} />
                                    <Insignia texto={`Exigencia ${NOMBRE_EXIGENCIA[a.exigencia] ?? a.exigencia}`} clase={a.exigencia === 3 ? 'alta' : ''} />
                                    <Insignia texto={horasTxt(a.horas)} />
                                    <Insignia texto={NOMBRE_ESTADO[a.estado]} clase={`estado-${a.estado}`} />
                                    {a.proyecto ? <Insignia texto={`📁 ${a.proyecto}`} /> : null}
                                    {a.repaso ? <Insignia texto="🧠 En repaso" /> : null}
                                    <InsigniaPrioridad a={a} />
                                </div>
                                <div className="barra-estado" aria-hidden="true">
                                    <i style={{ width: a.estado === 'completado' ? '100%' : a.estado === 'en_proceso' ? '50%' : '8%' }} />
                                </div>
                            </div>
                            <div className="acciones">
                                <button type="button" className="boton boton-mini" aria-label={`Editar ${a.titulo}`} onClick={() => alAbrir(a)}>Editar</button>
                                {a.estado !== 'completado'
                                    ? <button type="button" className="boton boton-mini" aria-label={`Marcar ${a.titulo} como completado`} onClick={() => alCambiarEstado(a, 'completado')}>✓ Listo</button>
                                    : null}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

// ---------------------------------------------------------------- Lateral: mini calendario y próximas entregas
export function MiniMes({ cursor, delDia, cargaDia, festivosDe, seleccionado, alElegir }) {
    const hoy = hoyISO();
    return (
        <div className="mini-vista">
            <div className="mes">
                <CabeceraMes />
                <div className="mes-cuerpo">
                    {cuadriculaMes(cursor).map((iso) => {
                        const lista = delDia(iso);
                        const fest = festivosDe(iso);
                        const textoFest = fest.map((f) => f.nombre).join(' · ');
                        const c = lista.length ? cargaDia(iso) : null;
                        return (
                            <button key={iso} type="button"
                                className={`dia${iso === hoy ? ' hoy' : ''}${mismoMes(iso, cursor) ? '' : ' otro-mes'}${iso === seleccionado ? ' sel' : ''}${fest.length ? ' festivo' : ''}`}
                                aria-label={`${diaLargo(iso)}${fest.length ? `, festivo: ${textoFest}` : ''}, ${lista.length} actividades${c ? `, carga ${c.porcentaje} %` : ''}`}
                                title={fest.length ? `🎉 ${textoFest}` : undefined} aria-pressed={iso === seleccionado} onClick={() => alElegir(iso)}>
                                <span className="num">{aFecha(iso).getDate()}</span>
                                {c ? <span className={`barra-carga nivel-${c.nivel}`} title={`Carga ${c.porcentaje} %`} /> : null}
                                <span className="puntos">
                                    {lista.slice(0, 4).map((a) => <span key={a.id} className={`punto t-${a.tipo}`} />)}
                                    {lista.length > 4 ? <span className="mas-p">+</span> : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function ProximasEntregas({ actividades, alAbrir }) {
    const hoy = hoyISO();
    const proximas = actividades
        .filter((a) => a.estado !== 'completado' && prioridadDe(a, hoy).vencimiento && prioridadDe(a, hoy).dias >= -3)
        .sort(porUrgencia(hoy)).slice(0, 5);
    return (
        <section className="proximas" aria-labelledby="proximas-titulo">
            <h3 id="proximas-titulo">⏰ Próximas entregas</h3>
            {proximas.length === 0 ? <p className="proximas-vacio">Nada con fecha de entrega cerca. 🎉</p> : (
                <ul>
                    {proximas.map((a) => {
                        const p = prioridadDe(a, hoy);
                        return (
                            <li key={a.id} className={`prioridad-${p.nivel}`}>
                                <button type="button" className="proxima" aria-label={`${a.titulo}, ${textoVencimiento(p)}`} onClick={() => alAbrir(a)}>
                                    <span className="tit">{a.titulo}</span>
                                    <small>{`${textoVencimiento(p)}${a.proyecto ? ` · ${a.proyecto}` : ''}`}</small>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

// ---------------------------------------------------------------- Línea de tiempo académica
/** Filas de la línea de tiempo: trabajos con vencimiento (o exámenes/entregas) y proyectos académicos resumidos */
export function filasLineaAcademica(actividades, hoy) {
    const academicas = actividades.filter((a) => a.tipo === 'estudio' && (a.fecha_vencimiento || esEntregaOExamen(a)));
    const filas = [];
    const proyectosAcademicos = new Set(academicas.map((a) => a.proyecto).filter(Boolean));
    for (const a of academicas) {
        if (a.proyecto) continue;
        const venc = prioridadDe(a, hoy).vencimiento ?? a.fecha_fin;
        filas.push({ clave: a.id, titulo: a.titulo, inicio: [a.fecha_asignacion, a.fecha_inicio].filter(Boolean).sort()[0], fin: venc, hecho: a.estado === 'completado', act: a, progreso: a.estado === 'completado' ? 100 : a.estado === 'en_proceso' ? 50 : 0 });
    }
    for (const nombre of proyectosAcademicos) {
        const lista = actividades.filter((a) => a.proyecto === nombre && a.tipo === 'estudio');
        const inicios = lista.flatMap((a) => [a.fecha_asignacion, a.fecha_inicio].filter(Boolean)).sort();
        const fines = lista.map((a) => prioridadDe(a, hoy).vencimiento ?? a.fecha_fin).sort();
        const hechas = lista.filter((a) => a.estado === 'completado').length;
        filas.push({ clave: `p:${nombre}`, titulo: `📁 ${nombre}`, inicio: inicios[0], fin: fines.at(-1), hecho: hechas === lista.length, proyecto: nombre, progreso: Math.round((hechas / lista.length) * 100), detalle: `${hechas}/${lista.length} tareas` });
    }
    return filas.filter((f) => f.fin >= sumarDias(hoy, -7)).sort((x, y) => x.fin.localeCompare(y.fin));
}

export function LineaAcademica({ actividades, alAbrir }) {
    const hoy = hoyISO();
    const visibles = filasLineaAcademica(actividades, hoy);
    if (visibles.length === 0) {
        return <div className="linea-cuerpo"><p className="linea-vacia">Cuando tengas trabajos, exámenes o entregas con fecha límite, aparecerán aquí desde el día en que se asignaron hasta que vencen.</p></div>;
    }
    const desde = [...visibles.map((f) => f.inicio), hoy].sort()[0];
    const hasta = [...visibles.map((f) => f.fin), hoy].sort().at(-1);
    const total = Math.max(1, diasEntre(desde, hasta) + 1);
    const pos = (iso) => `${(diasEntre(desde, iso) / total) * 100}%`;
    const relHoy = diasEntre(desde, hoy) / total;
    const etiquetaEje = (iso) => `${formatear(iso, { day: 'numeric', month: 'short' })}${iso === hoy ? ' (hoy)' : ''}`;
    return (
        <div className="linea-cuerpo">
            <div className="linea-eje" aria-hidden="true">
                <span>{etiquetaEje(desde)}</span>
                {relHoy >= 0.1 && relHoy <= 0.9 ? <span className="eje-hoy" style={{ left: pos(hoy) }}>Hoy</span> : null}
                <span>{etiquetaEje(hasta)}</span>
            </div>
            {visibles.map((f) => {
                const p = f.act ? prioridadDe(f.act, hoy) : { nivel: f.hecho ? 'ninguna' : (diasEntre(hoy, f.fin) <= 2 ? 'urgente' : 'media'), dias: diasEntre(hoy, f.fin) };
                const ancho = `${((diasEntre(f.inicio, f.fin) + 1) / total) * 100}%`;
                const etiquetaFechas = `${formatear(f.inicio, { day: 'numeric', month: 'short' })} → ${formatear(f.fin, { day: 'numeric', month: 'short' })}`;
                return (
                    <div key={f.clave} className={`linea-fila${f.hecho ? ' hecha' : ''} prioridad-${p.nivel}`}>
                        <div className="linea-etq">
                            {f.act
                                ? <button type="button" className="linea-tit" onClick={() => alAbrir(f.act)}>{f.titulo}</button>
                                : <Link className="linea-tit" to={`/proyectos#${encodeURIComponent(f.proyecto)}`}>{f.titulo}</Link>}
                            <small>{f.hecho ? '✓ Terminado' : [f.detalle, textoVencimiento(p)].filter(Boolean).join(' · ')}</small>
                        </div>
                        <div className="linea-pista" role="img" aria-label={`${f.titulo}: asignado ${etiquetaFechas}, ${f.progreso} % hecho`}>
                            <span className="linea-hoy" style={{ left: pos(hoy) }} />
                            <span className="linea-barra" style={{ left: pos(f.inicio), width: ancho }} title={etiquetaFechas}>
                                <i style={{ width: `${f.progreso}%` }} />
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
