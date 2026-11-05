// Mi agenda (diseño «Moderno»): mini calendario y próximas entregas a la izquierda, la vista elegida (Mes, Semana o
// Día) a la derecha, la línea de tiempo académica debajo y el asistente al lado. Los festivos importados solo se
// muestran (no suman carga ni se editan aquí). Carga por día con la regla común (compartido/carga.js).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { actividadesDelDia, cargaDelDia, capacidadDe } from '@compartido/carga.js';
import { sumarDias, sumarMeses, inicioSemana, primerDiaMes } from '@compartido/fechas.js';
import { hoyISO, formatear, mesAnio, diaLargo } from '../../../comun/fechas-locales.js';
import { useAvisos } from '../../../comun/ui/Avisos.jsx';
import { actividades as apiActividades, bienestar, festivos as apiFestivos } from '../../api.js';
import { useActividades, proyectosDe } from '../../actividades/useActividades.js';
import { useFormularioActividad } from '../../actividades/FormularioActividad.jsx';
import { Papelera } from '../../actividades/Papelera.jsx';
import { ChatIA } from '../../asistente/ChatIA.jsx';
import { escuchar, FESTIVOS_ACTUALIZADOS } from '../../eventos.js';
import { VistaMes, VistaSemana, VistaDia, MiniMes, ProximasEntregas, LineaAcademica } from './vistas.jsx';
import '../../estilos/actividades.css';
import './agenda.css';

const VISTAS = { mes: { nav: 'mes', etiqueta: 'Mes' }, semana: { nav: 'sem', etiqueta: 'Semana' }, dia: { nav: 'dia', etiqueta: 'Día' } };
const VISTAS_ANTIGUAS = { mensual: 'mes', minimalista: 'mes', timeline: 'mes', kanban: 'mes', eventos: 'mes', semanal: 'semana', diario: 'dia', moderno: 'dia' };
const CLAVE_VISTA = 'learntrack_vista_cal';
const BIENVENIDA = 'Dime algo como «Mañana tengo parcial de redes de 2 a 4 pm», «libera mi viernes» u «organízame la semana». También puedes dictar 🎤 o adjuntar tu cronograma 📎 con un mensaje.';

const ordenar = (a, b) => (a.hora_inicio || '99:99').localeCompare(b.hora_inicio || '99:99') || a.titulo.localeCompare(b.titulo, 'es');
const vistaGuardada = () => {
    try { const v = localStorage.getItem(CLAVE_VISTA); return VISTAS[v] ? v : (VISTAS_ANTIGUAS[v] ?? 'mes'); } catch { return 'mes'; }
};

export default function Agenda() {
    const { actividades, fijar, recargar } = useActividades();
    const [vista, setVistaEstado] = useState(vistaGuardada);
    const [cursor, setCursor] = useState(hoyISO);
    const [checkins, setCheckins] = useState(() => new Map());
    const [mesesCargados] = useState(() => new Set());
    const [festivos, setFestivos] = useState([]);
    const [papeleraAbierta, setPapeleraAbierta] = useState(false);
    const { aviso } = useAvisos();
    const formulario = useFormularioActividad({ alCambiar: fijar, proyectos: proyectosDe(actividades) });

    const setVista = (nombre) => {
        const v = VISTAS[nombre] ? nombre : (VISTAS_ANTIGUAS[nombre] ?? 'mes');
        setVistaEstado(v);
        try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* sin almacenamiento */ }
    };

    // ---- datos ----
    useEffect(() => {
        recargar().catch(() => aviso('No se pudieron cargar tus actividades. Recarga la página.'));
        apiFestivos.listar().then((r) => { if (r.ok) setFestivos(r.data.festivos); }).catch(() => {});
        const quitar = escuchar(FESTIVOS_ACTUALIZADOS, (lista) => setFestivos(lista ?? []));
        // Si la pestaña queda abierta toda la noche, «hoy» y el auto-estado se actualizan solos
        const intervalo = setInterval(() => {
            if (document.visibilityState === 'visible' && !document.querySelector('#modal-actividad[open]')) recargar().catch(() => {});
        }, 5 * 60 * 1000);
        return () => { quitar(); clearInterval(intervalo); };
    }, [recargar, aviso]);

    // Ánimo de cada día (capacidad) del mes visible
    useEffect(() => {
        const mes = cursor.slice(0, 7);
        if (mesesCargados.has(mes)) return;
        mesesCargados.add(mes);
        const desde = sumarDias(primerDiaMes(cursor), -7), hasta = sumarDias(primerDiaMes(sumarMeses(cursor, 1)), 7);
        bienestar.checkins(desde, hasta).then((r) => {
            if (!r.ok) { mesesCargados.delete(mes); return; }
            setCheckins((m) => { const n = new Map(m); for (const c of r.data.checkins) n.set(c.fecha, c.animo); return n; });
        }).catch(() => mesesCargados.delete(mes));
    }, [cursor, mesesCargados]);

    const festivosPorFecha = useMemo(() => {
        const m = new Map();
        for (const f of festivos) { if (!m.has(f.fecha)) m.set(f.fecha, []); m.get(f.fecha).push(f); }
        return m;
    }, [festivos]);
    const festivosDe = useCallback((iso) => festivosPorFecha.get(iso) ?? [], [festivosPorFecha]);
    const delDia = useCallback((iso) => actividadesDelDia(actividades, iso).sort(ordenar), [actividades]);
    const cargaDia = useCallback((iso) => cargaDelDia(actividades, iso, capacidadDe(checkins.get(iso))), [actividades, checkins]);

    // ---- acciones ----
    const abrir = (a, previos = {}) => formulario.abrir(a, { ...previos, fecha: previos.fecha ?? (vista === 'dia' ? cursor : hoyISO()) });
    const alNueva = (previos) => abrir(null, previos);
    async function cambiarEstado(a, estado) {
        if (a.estado === estado) return;
        fijar(actividades.map((x) => (x.id === a.id ? { ...x, estado } : x)));           // actualización optimista
        const res = await apiActividades.editar(a.id, { estado }).catch(() => null);
        if (res?.ok) fijar(res.data);
        else { fijar(actividades); aviso('No pude cambiar el estado. Inténtalo de nuevo.'); }
    }
    /** Lo que llega del chat: si se creó algo, se salta a su fecha */
    const alActualizarDesdeChat = useCallback((lista) => {
        const previos = new Set(actividades.map((a) => a.id));
        fijar(lista);
        const nueva = (lista ?? []).find((a) => !previos.has(a.id));
        if (nueva) setCursor(nueva.fecha_inicio ?? nueva.fecha ?? hoyISO());
    }, [actividades, fijar]);

    const mover = (dir) => {
        const nav = VISTAS[vista].nav;
        setCursor((c) => (nav === 'mes' ? sumarMeses(c, dir) : nav === 'sem' ? sumarDias(c, 7 * dir) : sumarDias(c, dir)));
    };
    const titulo = (() => {
        switch (VISTAS[vista].nav) {
            case 'mes': return mesAnio(cursor);
            case 'sem': { const a = inicioSemana(cursor), b = sumarDias(a, 6); return `${formatear(a, { day: 'numeric', month: 'short' })} – ${formatear(b, { day: 'numeric', month: 'short', year: 'numeric' })}`; }
            default: return diaLargo(cursor);
        }
    })();

    const propsVista = { cursor, delDia, cargaDia, festivosDe, alAbrir: (a) => abrir(a), alNueva };
    return (
        <>
            <main id="contenido" className="cal-app">
                <div className="cal-cabecera">
                    <div>
                        <h1>Mi agenda</h1>
                        <p className="cal-sub">Tu mes, tu semana o tu día, con tus próximas entregas siempre a la vista.</p>
                    </div>
                    <div className="cal-cabecera-acciones">
                        <button type="button" className="boton" id="btn-papelera" onClick={() => setPapeleraAbierta(true)}>🗑 Papelera</button>
                        <button type="button" className="boton boton-primario" id="btn-nueva" onClick={() => abrir(null)}>+ Nueva actividad</button>
                    </div>
                </div>

                <div className="cal-layout">
                    <section className="cal-principal" aria-label="Calendario">
                        <div className="cal-barra">
                            <div className="cal-nav" id="cal-nav" role="group" aria-label="Navegación de fechas">
                                <button type="button" className="boton boton-icono" id="btn-prev" aria-label="Anterior" onClick={() => mover(-1)}>‹</button>
                                <button type="button" className="boton" id="btn-hoy" onClick={() => setCursor(hoyISO())}>Hoy</button>
                                <button type="button" className="boton boton-icono" id="btn-next" aria-label="Siguiente" onClick={() => mover(1)}>›</button>
                            </div>
                            <h2 className="cal-titulo" id="cal-titulo" aria-live="polite">{titulo}</h2>
                            <label className="cal-selector">
                                <span>Vista</span>
                                <select id="selector-vista" value={vista} onChange={(e) => setVista(e.target.value)}>
                                    <option value="mes">Mes</option>
                                    <option value="semana">Semana</option>
                                    <option value="dia">Día</option>
                                </select>
                            </label>
                        </div>

                        <div className="moderno">
                            <aside className="moderno-lateral" id="cal-lateral" aria-label="Mini calendario y próximas entregas">
                                <div className="moderno-lateral-contenido">
                                    <div className="mini-cab">
                                        <button type="button" className="boton boton-icono" aria-label="Mes anterior" onClick={() => setCursor((c) => sumarMeses(c, -1))}>‹</button>
                                        <strong>{mesAnio(cursor)}</strong>
                                        <button type="button" className="boton boton-icono" aria-label="Mes siguiente" onClick={() => setCursor((c) => sumarMeses(c, 1))}>›</button>
                                    </div>
                                    <MiniMes cursor={cursor} delDia={delDia} cargaDia={cargaDia} festivosDe={festivosDe} seleccionado={cursor} alElegir={setCursor} />
                                    <ProximasEntregas actividades={actividades} alAbrir={(a) => abrir(a)} />
                                </div>
                            </aside>
                            <div className="cal-vista" id="cal-vista" tabIndex={-1} aria-label={`Vista ${VISTAS[vista].etiqueta}`}>
                                {vista === 'mes' ? <VistaMes {...propsVista} alIrADia={(iso) => { setCursor(iso); setVista('dia'); }} /> : null}
                                {vista === 'semana' ? <VistaSemana {...propsVista} /> : null}
                                {vista === 'dia' ? <VistaDia {...propsVista} alCambiarEstado={cambiarEstado} /> : null}
                            </div>
                        </div>

                        <ul className="cal-leyenda" aria-label="Leyenda de colores">
                            <li><span className="punto t-estudio" />Estudio</li>
                            <li><span className="punto t-trabajo" />Trabajo</li>
                            <li><span className="punto t-ocio" />Ocio</li>
                            <li><span className="punto t-deporte" />Deporte</li>
                            <li><span className="carga-dia nivel-verde">&lt;50 %</span><span className="carga-dia nivel-amarillo">50–85 %</span><span className="carga-dia nivel-rojo">&gt;85 %</span>Carga del día</li>
                            <li><span className="leyenda-urgente">⚠</span>Vence en ≤ 2 días</li>
                        </ul>

                        <section className="linea-academica" aria-labelledby="linea-titulo">
                            <div className="linea-cabecera">
                                <h2 id="linea-titulo">🎓 Línea de tiempo académica</h2>
                                <p>Cada trabajo, examen o entrega desde el día en que se asignó hasta su vencimiento. Los proyectos, con su progreso (detalle en <Link to="/proyectos">Proyectos</Link>).</p>
                            </div>
                            <div id="linea-academica-cuerpo"><LineaAcademica actividades={actividades} alAbrir={(a) => abrir(a)} /></div>
                        </section>
                    </section>

                    <aside className="cal-chat" aria-label="Asistente de agenda">
                        <h2>🤖 Agenda con IA</h2>
                        <p className="cal-chat-ayuda">Cuéntame qué tienes que hacer: agendo, muevo, libero días, planifico proyectos y recupero lo borrado. Los cambios grandes te los propongo antes de aplicarlos.</p>
                        <div id="chat-ia"><ChatIA alActualizar={alActualizarDesdeChat} bienvenida={BIENVENIDA} /></div>
                    </aside>
                </div>
            </main>
            {formulario.formulario}
            <Papelera abierta={papeleraAbierta} alCerrar={() => setPapeleraAbierta(false)} alRestaurar={fijar} />
        </>
    );
}
