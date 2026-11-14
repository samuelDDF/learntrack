// Mi panel: chat con el asistente, «Tu día de hoy», consejo de la IA, medidor de carga mental, historial y el
// check-in diario. La carga usa la MISMA regla que la Agenda y el servidor (compartido/carga.js).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAnimarCambio, useRevelar } from '../../../comun/animaciones/hooks.js';
import { esperarSalida } from '../../../comun/animaciones/revelar.js';
import { Contador } from '../../../comun/ui/Contador.jsx';
import { Esqueleto } from '../../../comun/ui/Esqueleto.jsx';
import { cargaDelDia, actividadesDelDia, capacidadDe, nivelCarga } from '@compartido/carga.js';
import { NOMBRE_TIPO, NOMBRE_EXIGENCIA, TIPOS_RECARGA } from '@compartido/catalogos.js';
import { textoHorario } from '@compartido/fechas.js';
import { hoyISO } from '../../../comun/fechas-locales.js';
import { BotonConfirmar } from '../../../comun/ui/BotonConfirmar.jsx';
import { useAvisos } from '../../../comun/ui/Avisos.jsx';
import { Dialogo } from '../../../comun/ui/Dialogo.jsx';
import { mensajeDeError } from '../../../api/cliente.js';
import { bienestar, asistente, festivos as apiFestivos } from '../../api.js';
import { useActividades, proyectosDe } from '../../actividades/useActividades.js';
import { useFormularioActividad } from '../../actividades/FormularioActividad.jsx';
import { useEliminarActividad } from '../../actividades/eliminar.js';
import { Papelera } from '../../actividades/Papelera.jsx';
import { ChatIA } from '../../asistente/ChatIA.jsx';
import { escuchar, FESTIVOS_ACTUALIZADOS } from '../../eventos.js';
import './panel.css';

const MENSAJE_IA_POR_DEFECTO = 'Pensando en ti...';
const ESTADO_TXT = { verde: '🟢 Estado Equilibrado', amarillo: '🟡 Carga Moderada', rojo: '🔴 Advertencia de Saturación' };
const BIENVENIDA = 'Escribe algo como «Mañana tengo parcial de redes de 2 a 4 pm con exigencia alta» o «Hoy jugué fútbol 1 hora». También puedo liberar un día, reorganizar tu semana, planificar un proyecto o leer un archivo (📎 + tu mensaje).';

// ---------------------------------------------------------------- caché local del check-in (por usuario y día)
const claveCache = (usuarioId, fecha) => `learntrack_checkin_${usuarioId ?? 'anon'}_${fecha}`;
function leerCache(usuarioId, fecha) {
    try { return JSON.parse(localStorage.getItem(claveCache(usuarioId, fecha)) || 'null'); } catch { return null; }
}
function escribirCache(usuarioId, fecha, datos) {
    try {
        localStorage.setItem(claveCache(usuarioId, fecha), JSON.stringify(datos));
        localStorage.removeItem(`learntrack_encuesta_${fecha}`);       // clave antigua compartida entre cuentas
    } catch { /* sin almacenamiento */ }
}

// ---------------------------------------------------------------- check-in
function FormularioCheckin({ inicial, fecha, alGuardado }) {
    const [v, setV] = useState({ animo: inicial?.animo ?? '', sueno: inicial?.sueno ?? '', enfoque: inicial?.enfoque ?? '' });
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const cambiar = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
    async function guardar(e) {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) { setError('Responde las tres preguntas.'); return; }
        setGuardando(true); setError('');
        try {
            const r = await bienestar.guardarCheckin({ fecha, ...v });
            if (!r.ok) { setError(mensajeDeError(r, 'No se pudo guardar el check-in.')); return; }
            alGuardado(r.data.checkin);
        } catch (err) { setError(mensajeDeError(err, 'Error de conexión con el servidor.')); } finally { setGuardando(false); }
    }
    return (
        <form id="form-encuesta" className="modal-content" onSubmit={guardar}>
            <div className="encuesta-cab">
                <h3 id="titulo-checkin">Check-in Diario</h3>
                <p>Antes de planificar, cuéntanos cómo empiezas tu día.</p>
            </div>
            <div className="form-group">
                <label htmlFor="encuesta-animo">1. ¿Cómo te sientes emocionalmente hoy?</label>
                <select id="encuesta-animo" required value={v.animo} onChange={cambiar('animo')}>
                    <option value="" disabled>Selecciona tu estado...</option>
                    <option value="alto">Con mucha motivación y energía</option>
                    <option value="medio">Normal / Tranquilo</option>
                    <option value="bajo">Cansado / Saturado / Estresado</option>
                </select>
            </div>
            <div className="form-group">
                <label htmlFor="encuesta-sueno">2. ¿Cómo dormiste anoche?</label>
                <select id="encuesta-sueno" required value={v.sueno} onChange={cambiar('sueno')}>
                    <option value="" disabled>Selecciona una opción...</option>
                    <option value="bien">Bien, descansé lo suficiente</option>
                    <option value="regular">Regular, me costó dormir o me desperté</option>
                    <option value="mal">Mal, dormí muy pocas horas</option>
                </select>
            </div>
            <div className="form-group">
                <label htmlFor="encuesta-enfoque">3. ¿Cuál es tu objetivo mental para hoy?</label>
                <select id="encuesta-enfoque" required value={v.enfoque} onChange={cambiar('enfoque')}>
                    <option value="" disabled>Selecciona tu enfoque...</option>
                    <option value="avanzar">Avanzar fuerte en tareas pesadas</option>
                    <option value="mantener">Cumplir la rutina sin forzarme de más</option>
                    <option value="descansar">Tomarlo con calma y priorizar el descanso</option>
                </select>
            </div>
            <p id="encuesta-error" className="error-formulario" role="alert">{error}</p>
            <div className="modal-acciones">
                <button type="submit" className="btn btn-ancho" disabled={guardando} aria-busy={guardando}>Guardar y Continuar</button>
            </div>
        </form>
    );
}

// ---------------------------------------------------------------- piezas del lateral
function FilaActividad({ a, alEditar, alEliminar }) {
    const clase = a.exigencia === 3 ? 'exig-alta' : TIPOS_RECARGA.includes(a.tipo) ? 'recarga' : '';
    const rango = a.fecha_fin !== a.fecha_inicio ? ` · ${a.fecha_inicio.slice(5)} → ${a.fecha_fin.slice(5)}` : '';
    const hora = a.hora_inicio ? ` · ${textoHorario(a)}` : '';
    const detalle = `${NOMBRE_TIPO[a.tipo].toUpperCase()} • ${a.horas} h${hora}${rango} (Exigencia: ${NOMBRE_EXIGENCIA[a.exigencia]})${a.estado === 'completado' ? ' • completada' : ''}${a.repaso ? ' • 🧠 repaso' : ''}`;
    const fila = useRef(null);
    // Al eliminar: la fila sale deslizándose y LUEGO se borra; si el borrado falla, vuelve a su sitio
    const eliminarConSalida = async (x) => {
        const salida = await esperarSalida(fila.current);
        const ok = await alEliminar(x);
        if (ok === false) salida?.cancel();
    };
    return (
        <div ref={fila} className={`act-dia ${clase}`}>
            <div className="act-info">
                <strong className={a.estado === 'completado' ? 'tachado' : ''}>{a.titulo}</strong>
                <small>{detalle}</small>
            </div>
            <div className="act-acciones">
                <button type="button" className="btn-icono" aria-label={`Editar ${a.titulo}`} onClick={() => alEditar(a)}>✏️</button>
                <BotonConfirmar className="btn-icono" aria-label={`Eliminar ${a.titulo}`} alConfirmar={() => eliminarConSalida(a)}>🗑️</BotonConfirmar>
            </div>
        </div>
    );
}

function Historial({ historial, fechaHoy }) {
    const revelar = useRevelar();
    if (historial === null) return <div id="resumen-semanal"><Esqueleto variante="mini" filas={5} texto="Cargando historial..." /></div>;
    const fechas = Object.keys(historial).filter((f) => f <= fechaHoy).slice(-5);
    if (fechas.length === 0) return <div id="resumen-semanal">Sin registros previos.</div>;
    return (
        <div id="resumen-semanal">
            <div className="historial-grid" ref={revelar} data-revelar-grupo="">
                {fechas.map((f) => (
                    <div key={f} className="historial-item lt-tarjeta-sutil"><span>{f.slice(5)}</span><strong className={`nivel-${nivelCarga(historial[f])}`}><Contador valor={historial[f]} sufijo="%" /></strong></div>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- pantalla
export default function Panel({ usuario }) {
    const fechaHoy = hoyISO();
    const { actividades, fijar, recargar, cargada } = useActividades();
    const revelar = useRevelar();
    const [checkin, setCheckin] = useState(() => leerCache(usuario?.id, fechaHoy));
    const [checkinListo, setCheckinListo] = useState(false);
    const [checkinAbierto, setCheckinAbierto] = useState(false);
    const [historial, setHistorial] = useState(null);
    const [consejo, setConsejo] = useState({ texto: MENSAJE_IA_POR_DEFECTO, pensando: true });
    const [festivosHoy, setFestivosHoy] = useState([]);
    const [papeleraAbierta, setPapeleraAbierta] = useState(false);
    const turnoIA = useRef(0);
    const { aviso } = useAvisos();
    const formulario = useFormularioActividad({ alCambiar: fijar, proyectos: proyectosDe(actividades) });
    const eliminar = useEliminarActividad(fijar);

    const hoy = actividadesDelDia(actividades, fechaHoy);
    const carga = cargaDelDia(actividades, fechaHoy, capacidadDe(checkin));

    // ---- arranque: actividades, historial y check-in (manda el servidor; la caché solo pinta rápido) ----
    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const [, resHist, resChk] = await Promise.all([recargar(), bienestar.historial(), bienestar.checkin(fechaHoy)]);
                if (!vivo) return;
                setHistorial(resHist.ok ? resHist.data : {});
                let chk = leerCache(usuario?.id, fechaHoy);
                if (resChk.ok) {
                    if (resChk.data.checkin) { chk = resChk.data.checkin; escribirCache(usuario?.id, fechaHoy, chk); }
                    else if (chk?.animo && chk?.sueno && chk?.enfoque) {
                        // Caché de esta cuenta que no llegó al servidor: se sube
                        const r = await bienestar.guardarCheckin({ fecha: fechaHoy, animo: chk.animo, sueno: chk.sueno, enfoque: chk.enfoque }).catch(() => null);
                        chk = r?.ok ? r.data.checkin : null;
                    } else chk = null;
                }
                if (!vivo) return;
                setCheckin(chk);
                setCheckinListo(true);
                if (!chk) setCheckinAbierto(true);
            } catch (e) {
                if (vivo) { setHistorial({}); setCheckinListo(true); aviso(mensajeDeError(e, 'No se pudo cargar tu panel. Recarga la página.')); }
            }
        })();
        apiFestivos.listar({ desde: fechaHoy, hasta: fechaHoy }).then((r) => { if (vivo && r.ok) setFestivosHoy(r.data.festivos); }).catch(() => {});
        const quitar = escuchar(FESTIVOS_ACTUALIZADOS, (lista) => setFestivosHoy((lista ?? []).filter((f) => f.fecha === fechaHoy)));
        return () => { vivo = false; quitar(); };
    }, [fechaHoy, recargar, usuario?.id, aviso]);

    // ---- carga, historial y consejo cada vez que cambian las actividades de hoy o el check-in ----
    const firmaHoy = hoy.map((a) => `${a.id}:${a.horas}:${a.exigencia}:${a.estado}:${a.titulo}`).join('|');
    const pedirConsejo = useCallback(async (porcentaje, lista) => {
        const turno = ++turnoIA.current;
        setConsejo({ texto: MENSAJE_IA_POR_DEFECTO, pensando: true });
        if (lista.length === 0) return;
        const contexto = checkin ? `INFO EXTRA DEL USUARIO HOY -> Durmió: ${checkin.sueno} / Objetivo de hoy: ${checkin.enfoque}` : '';
        try {
            const r = await asistente.consejo({
                estadoAnimo: checkin?.animo ?? 'medio', porcentajeCarga: porcentaje,
                actividades: [contexto, ...lista.map((a) => `${a.titulo} (${a.horas} hrs)`)].filter(Boolean)
            });
            if (turno !== turnoIA.current) return;
            setConsejo({ texto: (r.ok && r.data.consejo) || MENSAJE_IA_POR_DEFECTO, pensando: false });
        } catch {
            if (turno === turnoIA.current) setConsejo({ texto: MENSAJE_IA_POR_DEFECTO, pensando: false });
        }
    }, [checkin]);

    useEffect(() => {
        if (!checkinListo || !checkin) return;
        if (hoy.length > 0) {
            // El servidor recalcula el % con la misma regla y su check-in; solo guarda días <= hoy
            bienestar.registrarHistorial(fechaHoy, fechaHoy).then((r) => { if (r?.ok) setHistorial(r.data); }).catch(() => {});
        }
        pedirConsejo(carga.porcentaje, hoy);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checkinListo, checkin, firmaHoy]);

    const nivel = carga.nivel;
    const consejoRef = useAnimarCambio(consejo.texto, 'aparecer', { duracion: 360 });
    return (
        <>
            <div className="dashboard-bienvenida">
                <p className="aviso-festivo" id="aviso-festivo" role="note" hidden={festivosHoy.length === 0}>
                    {festivosHoy.length ? `🎉 Hoy es festivo: ${festivosHoy.map((f) => f.nombre).join(' · ')}. Tómatelo con calma.` : ''}
                </p>
            </div>

            <main id="contenido" className="chat-layout-container">
                <section className="card chat-main-section" ref={revelar} data-revelar="arriba">
                    <header className="chat-header">
                        <h1 id="titulo-bienvenida">{`Hola ${usuario?.nombre ?? ''}, ¿qué tenemos hoy?`}</h1>
                        <p className="ayuda-chat">Dile a la IA qué harás en lenguaje natural, o pídele que libere un día, reorganice tu semana o planifique un proyecto.</p>
                    </header>
                    <div id="chat-ia" className="chat-panel-gigante">
                        <ChatIA alActualizar={fijar} bienvenida={BIENVENIDA} />
                    </div>
                </section>

                <aside className="sidebar-derecha" ref={revelar} data-revelar-grupo="">
                    <div className="card widget-panel lt-tarjeta-sutil">
                        <div className="lista-dia-cab">
                            <h3>Tu día de hoy</h3>
                            <div className="lista-dia-acciones">
                                <span id="fecha-actual-label" className="fecha-actual-label">{new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                                <button type="button" className="boton boton-mini" id="btn-papelera" onClick={() => setPapeleraAbierta(true)}>🗑 Papelera</button>
                                <button type="button" className="boton boton-mini" id="btn-nueva" onClick={() => formulario.abrir(null, { fecha: fechaHoy })}>+ Nueva</button>
                            </div>
                        </div>
                        <div id="grid-calendario" className="lista-dia-panel" aria-live="polite">
                            {!cargada ? <Esqueleto filas={2} texto="Cargando tu día…" /> : hoy.length
                                ? hoy.map((a) => (
                                    <FilaActividad key={a.id} a={a} alEditar={(x) => formulario.abrir(x)}
                                        alEliminar={async (x) => { const fallo = await eliminar(x); if (fallo) aviso(fallo); return !fallo; }} />
                                ))
                                : <div className="lista-vacia">No hay actividades en el calendario para hoy.</div>}
                        </div>
                    </div>

                    <div className={`asistente-ia-box${consejo.pensando ? ' pensando' : ''}`}>
                        <h3>✨ Asistente LearnTrack</h3>
                        <p id="consejo-ia" ref={consejoRef} aria-live="polite">{consejo.texto}</p>
                    </div>

                    <div className="card widget-panel lt-tarjeta-sutil">
                        <div className="bateria-header">
                            <span className="bateria-titulo">
                                🔋 Carga Mental
                                <button type="button" id="btn-rehacer-encuesta" className="btn-icono btn-estado" title="Modificar cómo te sientes" onClick={() => setCheckinAbierto(true)}>✏️ Estado</button>
                            </span>
                            <strong id="porcentaje-carga"><Contador valor={carga.porcentaje} sufijo="%" /></strong>
                        </div>
                        <div className="barra-base" role="progressbar" aria-labelledby="porcentaje-carga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(carga.porcentaje, 100)} id="barra-carga-rol">
                            <div id="barra-progreso-carga" className={`barra-nivel nivel-barra-${nivel}`} style={{ width: `${Math.min(carga.porcentaje, 100)}%` }} />
                        </div>
                        <p id="estado-mensaje" className="estado-tag" aria-live="polite">{checkinListo ? ESTADO_TXT[nivel] : 'Cargando estado...'}</p>
                        <details className="explicacion-carga">
                            <summary>¿Cómo funciona el cálculo de mi carga?</summary>
                            <div className="explicacion-cuerpo">
                                <p>Tu carga mental funciona como una balanza: por un lado está <strong>tu tanque de energía</strong> y por otro, <strong>el peso de tus tareas</strong>.</p>
                                <h4>1. Tu Tanque de Energía (Check-in)</h4>
                                <ul>
                                    <li><strong>Motivado/Alto:</strong> Tanque de 120 pts (tienes más margen).</li>
                                    <li><strong>Normal/Medio:</strong> Tanque de 100 pts.</li>
                                    <li><strong>Cansado/Bajo:</strong> Tanque de 70 pts (te saturarás más rápido).</li>
                                </ul>
                                <h4>2. El Peso de tus Actividades</h4>
                                <ul>
                                    <li>Alta exigencia (3): <strong>+30 pts</strong> por hora</li>
                                    <li>Exigencia media (2): <strong>+20 pts</strong> por hora</li>
                                    <li>Baja exigencia (1): <strong>+10 pts</strong> por hora</li>
                                    <li className="recarga">Ocio / Deporte (-2): <strong>-20 pts</strong> por hora</li>
                                </ul>
                                <p className="explicacion-nota">Una actividad de varios días suma sus horas en <strong>cada</strong> día de su rango, y las completadas siguen contando (la energía ya se gastó). Es la misma regla que usa la Agenda.</p>
                            </div>
                        </details>
                    </div>

                    <div className="card widget-panel lt-tarjeta-sutil">
                        <h3>Historial Reciente</h3>
                        <Historial historial={historial} fechaHoy={fechaHoy} />
                    </div>
                </aside>
            </main>

            <Dialogo abierto={checkinAbierto} obligatorio={!checkin} alCerrar={() => setCheckinAbierto(false)} id="modal-encuesta" className="modal-dialog" aria-labelledby="titulo-checkin">
                <FormularioCheckin inicial={checkin} fecha={fechaHoy} alGuardado={(c) => {
                    setCheckin(c); escribirCache(usuario?.id, fechaHoy, c); setCheckinAbierto(false);
                }} />
            </Dialogo>
            {formulario.formulario}
            <Papelera abierta={papeleraAbierta} alCerrar={() => setPapeleraAbierta(false)} alRestaurar={fijar} />
        </>
    );
}
