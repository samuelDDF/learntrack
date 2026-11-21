// Chat reutilizable de IA para Mi panel, Mi agenda y los accesos contextuales de Proyectos y Estudio.
// Burbujas, indicador de escritura, sugerencias, dictado por voz, archivo + mensaje en el mismo envío (📎 o
// arrastrar), tarjetas de propuesta (Aplicar / Cancelar / Deshacer, con carga antes → después) y aclaraciones con
// respuestas rápidas. Voz bidireccional: dictado, lectura en voz alta y «modo conversación».
// Todo el texto del servidor o del modelo se pinta como TEXTO (React lo escapa); nunca como HTML.
// Todas las llamadas al modelo pasan por el backend (/api/ia/*): el navegador no conoce la dirección de Ollama.
import { useCallback, useEffect, useRef, useState } from 'react';
import { mensajeDeError, ErrorConexion } from '../../../services/errores.js';
import { hoyISO, tzOffset, horaLocal } from '../../../utils/fechas.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { asistente } from '../services/asistente.service.js';
import { hablar, callar, sintesisDisponible, cargarVozPreferida } from '../utils/voz.js';
import { componerEntrada, ERRORES_VOZ, reconocedorDisponible } from '../utils/dictado.js';
import { SugerenciaEstudio, PlanSesiones, AnalisisDocumento } from '../../review/components/EstudioIA.jsx';
import { estudio as apiEstudio } from '../../review/services/estudio.service.js';
import '../chat-ia.css';
import '../../review/estudio.css';

const MAX_TURNOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const ICONO_OP = { crear: '＋', mover: '↷', editar: '✎', eliminar: '🗑', restaurar: '♻' };
const NOMBRE_OP = { crear: 'Crear', mover: 'Mover', editar: 'Editar', eliminar: 'Eliminar', restaurar: 'Restaurar' };
const CLAVE_LEER = 'learntrack_leer_respuestas';
const FORMATOS_POR_DEFECTO = ['.txt', '.md', '.csv', '.ics', '.pdf', '.docx'];

export const SUGERENCIAS = [
    { etiqueta: '¿Qué tengo mañana?', texto: '¿Qué tengo mañana?' },
    { etiqueta: 'Libera mi viernes', texto: 'Libera mi agenda del viernes' },
    { etiqueta: 'Organízame la semana', texto: 'Organízame la semana, tengo demasiado' },
    { etiqueta: 'Planificar un proyecto', texto: 'Tengo que hacer un proyecto de bases de datos para el ' },
    { etiqueta: 'Recuperar lo borrado', texto: 'Recupera lo que borré hoy' }
];

const kb = (bytes) => Math.max(1, Math.round(bytes / 1024));
const extension = (n) => { const i = n.lastIndexOf('.'); return i >= 0 ? n.slice(i).toLowerCase() : ''; };
let contadorMensajes = 0;
const nuevoId = () => `m${++contadorMensajes}`;

/** Lo que se dice en voz alta para cada tipo de respuesta del servidor */
export function textoHablado(data) {
    if (data.tipo === 'propuesta') return `${data.mensaje ?? ''} También puedes decir «sí» para aplicar o «no» para cancelar.`;
    if (data.tipo === 'aclaracion') {
        const p = data.aclaracion?.preguntas?.[0];
        return p ? `${p.texto} Opciones: ${(p.opciones ?? []).map((o) => o.etiqueta).join(', ')}.` : (data.mensaje ?? '');
    }
    return [data.mensaje, ...(data.avisos ?? [])].filter(Boolean).join('. ');
}

// ---------------------------------------------------------------- piezas
function ListaTextos({ clase, titulo, textos }) {
    if (!textos?.length) return null;
    return <div className={clase}><strong>{titulo}</strong><ul>{textos.map((t, i) => <li key={i}>{t}</li>)}</ul></div>;
}

function TiraCargas({ cargas }) {
    if (!cargas?.length) return null;
    return (
        <div className="chatia-cargas">
            <strong>Carga por día (antes → después)</strong>
            <ul>
                {cargas.slice(0, 14).map((c, i) => (
                    <li key={i}>
                        <span className="cg-dia">{c.etiqueta}</span>
                        <span className={`pill nivel-${c.nivelAntes}`} title={`Antes: ${c.antes} % (${c.nivelAntes})`}>{c.antes} %</span>
                        <span aria-hidden="true">→</span>
                        <span className={`pill nivel-${c.nivelDespues}`} title={`Después: ${c.despues} % (${c.nivelDespues})`}>{c.despues} %</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function BotonDeshacer({ loteId, alActualizar, recordar }) {
    const [estado, setEstado] = useState('listo');      // listo | trabajando | hecho
    const [error, setError] = useState('');
    if (estado === 'hecho') return <span className="chatia-hecho">↩ Deshecho</span>;
    return (
        <>
            <button type="button" className="chatia-btn" disabled={estado === 'trabajando'} onClick={async () => {
                setEstado('trabajando');
                const r = await asistente.deshacer(loteId).catch(() => null);
                if (r?.ok) { setEstado('hecho'); alActualizar(r.data.actividades); recordar('asistente', r.data.mensaje); }
                else { setEstado('listo'); setError(r?.data?.error || 'No se pudo deshacer.'); }
            }}>↩ Deshacer</button>
            {error ? <p className="chatia-error-linea">{error}</p> : null}
        </>
    );
}

// v3.12 · Estudio: lo que el asistente PROPONE y la persona decide (nada se guarda solo)
const TIPOS_ESTUDIO = ['sugerencia_estudio', 'plan_estudio', 'analisis_estudio'];
function TarjetaEstudio({ datos, alActualizar }) {
    const refrescar = () => alActualizar();
    return (
        <div className="chatia-estudio">
            {datos.tipo === 'sugerencia_estudio' ? (datos.sugerencias ?? []).map((s) => <SugerenciaEstudio key={s.objetivo?.id ?? s.motivo} sugerencia={s} alResuelta={refrescar} />) : null}
            {datos.tipo === 'plan_estudio' ? <PlanSesiones plan={datos.plan} alGuardado={refrescar} /> : null}
            {datos.tipo === 'analisis_estudio' ? <AnalisisDocumento analisis={datos.analisis} alGuardado={refrescar} /> : null}
        </div>
    );
}

function Burbuja({ m, alActualizar, recordar }) {
    const etiqueta = m.quien === 'usuario' ? 'Tú: ' : m.quien === 'error' ? 'Error: ' : 'Asistente: ';
    return (
        <div className={`msg ${m.quien}`}>
            {m.adjunto ? <span className="chatia-adjunto-burbuja">{m.adjunto}</span> : null}
            <span className="solo-lectores">{etiqueta}</span>
            <span>{m.prefijo ?? ''}{m.texto}</span>
            <ListaTextos clase="chatia-supuestos" titulo="Supuse:" textos={m.supuestos} />
            <ListaTextos clase="chatia-avisos" titulo="Ojo:" textos={m.avisos} />
            <TiraCargas cargas={m.cargas} />
            {m.loteId ? <div className="chatia-acciones"><BotonDeshacer loteId={m.loteId} alActualizar={alActualizar} recordar={recordar} /></div> : null}
        </div>
    );
}

function TarjetaPropuesta({ m, idChat, alAplicada, alCancelada, alActualizar, recordar }) {
    const p = m.propuesta;
    const [marcadas, setMarcadas] = useState(() => new Set(p.items.filter((it) => it.marcado !== false).map((it) => it.idx)));
    const [error, setError] = useState('');
    const [trabajando, setTrabajando] = useState(false);
    const [avisosExtra, setAvisosExtra] = useState([]);
    const cerrada = m.estado !== 'pendiente';
    const explicaciones = (p.explicaciones ?? []).filter((t) => !p.items.some((it) => it.motivo === t));

    async function aplicar() {
        setError('');
        const cuerpo = p.seleccionable ? { seleccion: [...marcadas] } : {};
        if (p.seleccionable && cuerpo.seleccion.length === 0) { setError('Marca al menos un elemento.'); return; }
        setTrabajando(true);
        const r = await asistente.aplicarPropuesta(p.id, cuerpo).catch(() => null);
        setTrabajando(false);
        if (r?.ok) {
            alAplicada(p.id, r.data.loteId);
            alActualizar(r.data.actividades);
            recordar('asistente', r.data.mensaje);
            if (r.data.avisos?.length) setAvisosExtra(r.data.avisos);
        } else {
            setError(r?.data?.error || 'No se pudo aplicar. Inténtalo de nuevo.');
            if (r?.status === 410) alCancelada(p.id, 'caducada');
        }
    }
    async function cancelar() {
        setTrabajando(true);
        await asistente.cancelarPropuesta(p.id).catch(() => null);
        setTrabajando(false);
        alCancelada(p.id, 'cancelada');
    }

    return (
        <article className={`chatia-tarjeta${cerrada ? ` estado-${m.estado}` : ''}`} data-propuesta={p.id} aria-label={`Propuesta: ${p.titulo}`}>
            <header><strong>{p.titulo}</strong><span className="caduca">Caduca en 10 min</span></header>
            <p className="resumen">{m.mensaje}</p>
            {explicaciones.length ? <ul className="chatia-explicaciones">{explicaciones.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}</ul> : null}
            <ul className="chatia-items">
                {p.items.map((it) => {
                    const idCasilla = `${idChat}-${p.id}-${it.idx}`;
                    const cuerpo = (
                        <>
                            <span className={`op op-${it.op}`} aria-hidden="true">{ICONO_OP[it.op] ?? '•'}</span>
                            <span className="solo-lectores">{`${NOMBRE_OP[it.op] ?? ''}: `}</span>
                            <strong>{it.titulo}</strong>
                            {it.detalle ? <span className="detalle">{` · ${it.detalle}`}</span> : null}
                            {it.motivo ? <small className="motivo">{it.motivo}</small> : null}
                            {it.aviso ? <small className="aviso-item">{`⚠ ${it.aviso}`}</small> : null}
                        </>
                    );
                    return (
                        <li key={it.idx} className={`item op-${it.op}`}>
                            {p.seleccionable ? (
                                <>
                                    <input type="checkbox" id={idCasilla} data-idx={it.idx} disabled={cerrada} checked={marcadas.has(it.idx)}
                                        onChange={(e) => setMarcadas((s) => { const n = new Set(s); if (e.target.checked) n.add(it.idx); else n.delete(it.idx); return n; })} />
                                    <label htmlFor={idCasilla} className="cuerpo">{cuerpo}</label>
                                </>
                            ) : <span className="cuerpo">{cuerpo}</span>}
                        </li>
                    );
                })}
            </ul>
            <TiraCargas cargas={p.cargas} />
            <ListaTextos clase="chatia-supuestos" titulo="Supuse:" textos={p.supuestos} />
            <ListaTextos clase="chatia-avisos" titulo="Ojo:" textos={p.avisos} />
            <p className="chatia-error-linea" role="alert">{error}</p>
            <div className="chatia-acciones">
                {m.estado === 'pendiente' ? (
                    <>
                        <button type="button" className="chatia-btn primario" disabled={trabajando} aria-busy={trabajando} onClick={aplicar}>{p.seleccionable ? 'Añadir seleccionadas' : 'Aplicar'}</button>
                        <button type="button" className="chatia-btn" disabled={trabajando} onClick={cancelar}>Cancelar</button>
                    </>
                ) : (
                    <>
                        <span className="chatia-hecho">{m.estado === 'aplicada' ? '✓ Aplicada' : m.estado === 'cancelada' ? 'Cancelada: no cambié nada' : 'Caducó (10 min): pídemelo de nuevo'}</span>
                        {m.estado === 'aplicada' && m.loteId ? <BotonDeshacer loteId={m.loteId} alActualizar={alActualizar} recordar={recordar} /> : null}
                    </>
                )}
            </div>
            <ListaTextos clase="chatia-avisos" titulo="Ojo:" textos={avisosExtra} />
        </article>
    );
}

function TarjetaAclaracion({ m, alResponder }) {
    const a = m.aclaracion;
    const [respuestas, setRespuestas] = useState({});
    const bloqueada = m.respondida;
    const enviarRespuestas = (resp, decideTu) => {
        const etiquetas = a.preguntas.map((q) => q.opciones.find((o) => o.valor === resp[q.id])?.etiqueta).filter(Boolean);
        const mostrar = decideTu ? (etiquetas.length ? `${etiquetas.join(' · ')} (y decide tú lo demás)` : 'Decide tú') : etiquetas.join(' · ');
        alResponder(a.id, resp, mostrar);
    };
    return (
        <div className="msg ia chatia-aclaracion" data-aclaracion={a.id}>
            {a.preguntas.map((q) => (
                <div key={q.id}>
                    <p className="pregunta">{q.texto}</p>
                    <div className="opciones" role="group" aria-label={q.texto}>
                        {q.opciones.map((o) => (
                            <button key={String(o.valor)} type="button" className="chatia-opcion" aria-pressed={respuestas[q.id] === o.valor} disabled={bloqueada}
                                onClick={() => {
                                    const nuevas = { ...respuestas, [q.id]: o.valor };
                                    setRespuestas(nuevas);
                                    if (a.preguntas.every((x) => nuevas[x.id])) enviarRespuestas(nuevas, false);
                                }}>{o.etiqueta}</button>
                        ))}
                    </div>
                </div>
            ))}
            <div className="chatia-acciones">
                <button type="button" className="chatia-btn" title="Usaré valores razonables y te diré cuáles supuse" disabled={bloqueada}
                    onClick={() => enviarRespuestas(respuestas, true)}>Decide tú</button>
                <small className="nota">También puedes responder escribiendo.</small>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- componente
export function ChatIA({ alActualizar = () => {}, bienvenida = '', sugerencias = SUGERENCIAS, contexto = null }) {
    const [idChat] = useState(() => `chatia-${Math.random().toString(36).slice(2, 8)}`);
    const { usuario } = useAuth();
    const nombreIA = usuario?.nombreIA || 'Nexo';
    const [mensajes, setMensajes] = useState(() => (bienvenida ? [{ id: nuevoId(), tipo: 'burbuja', quien: 'ia', texto: bienvenida, saludo: true }] : []));
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [textoEspera, setTextoEspera] = useState('El asistente está pensando…');
    const [adjunto, setAdjunto] = useState(null);
    const [arrastrando, setArrastrando] = useState(false);
    const [capacidades, setCapacidades] = useState({ archivos: true, formatos: FORMATOS_POR_DEFECTO, imagenes: false });
    const [leer, setLeer] = useState(false);
    const [conversacion, setConversacion] = useState(false);
    const [escuchando, setEscuchando] = useState(false);
    const [estadoVoz, setEstadoVoz] = useState('');
    const [mostrarPrivacidad, setMostrarPrivacidad] = useState(false);

    const log = useRef(null);
    const entrada = useRef(null);
    const inputArchivo = useRef(null);
    const historial = useRef([]);
    const propuestaPendiente = useRef(null);
    const aclaracionPendiente = useRef(null);
    const reconocedor = useRef(null);
    const profundidad = useRef(0);
    // Estado «vivo» para las devoluciones de llamada del reconocedor de voz (evita cierres con valores viejos)
    const vivo = useRef({});
    vivo.current = { leer, conversacion, enviando, escuchando, texto };

    const SR = reconocedorDisponible();
    const contextoSeguro = typeof window !== 'undefined' && window.isSecureContext;
    const dictadoDisponible = Boolean(SR) && contextoSeguro;
    const vozDisponible = sintesisDisponible();

    // ---- utilidades de la conversación ----
    const recordar = useCallback((rol, t) => {
        historial.current = [...historial.current, { rol, texto: String(t ?? '').slice(0, 300) }].slice(-MAX_TURNOS);
    }, []);
    const agregar = useCallback((m) => setMensajes((l) => [...l, { id: nuevoId(), ...m }]), []);
    const actualizarMensaje = useCallback((pred, cambios) => setMensajes((l) => l.map((m) => (pred(m) ? { ...m, ...cambios } : m))), []);

    useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [mensajes, enviando]);

    // ---- capacidades del servidor (formatos de archivo e imágenes) ----
    useEffect(() => {
        let activo = true;
        asistente.capacidades().then((r) => {
            if (!activo || !r.ok) return;
            setCapacidades({ archivos: Boolean(r.data.archivos), formatos: r.data.formatos ?? FORMATOS_POR_DEFECTO, imagenes: Boolean(r.data.imagenes) });
        }).catch(() => {});
        return () => { activo = false; };
    }, []);

    // ---- preferencia «leer respuestas» (se recuerda en este navegador) ----
    useEffect(() => {
        if (!vozDisponible) return;
        try { if (localStorage.getItem(CLAVE_LEER) === '1') setLeer(true); } catch { /* sin almacenamiento */ }
        cargarVozPreferida();
    }, [vozDisponible]);
    useEffect(() => () => { callar(); reconocedor.current?.abort?.(); }, []);

    // ---- pintar una respuesta del servidor ----
    const pintar = useCallback((data) => {
        recordar('asistente', data.mensaje ?? '');
        if (Array.isArray(data.actividades)) alActualizar(data.actividades);
        if (data.tipo === 'propuesta') {
            propuestaPendiente.current = data.propuesta.id;
            agregar({ tipo: 'propuesta', propuesta: data.propuesta, mensaje: data.mensaje, estado: 'pendiente', loteId: null });
            const restante = new Date(data.propuesta.expira).getTime() - Date.now();
            if (restante > 0) {
                setTimeout(() => {
                    actualizarMensaje((m) => m.tipo === 'propuesta' && m.propuesta.id === data.propuesta.id && m.estado === 'pendiente', { estado: 'caducada' });
                    if (propuestaPendiente.current === data.propuesta.id) propuestaPendiente.current = null;
                }, restante);
            }
        } else if (data.tipo === 'aclaracion') {
            aclaracionPendiente.current = data.aclaracion.id;
            agregar({ tipo: 'aclaracion', aclaracion: data.aclaracion, respondida: false });
        } else if (TIPOS_ESTUDIO.includes(data.tipo)) {
            // v3.12: sugerencias de estudio, plan de sesiones o análisis de un taller: la explicación y la tarjeta
            agregar({ tipo: 'burbuja', quien: 'ia', texto: data.mensaje || '', avisos: data.avisos });
            agregar({ tipo: 'estudio', datos: data });
        } else {
            agregar({
                tipo: 'burbuja', quien: 'ia', texto: data.mensaje || 'Hecho.', supuestos: data.supuestos, avisos: data.avisos, cargas: data.cargas,
                loteId: data.tipo === 'aplicado' && data.loteId && !data.propuestaId ? data.loteId : null
            });
            if (data.tipo === 'cancelada' && data.propuestaId) {
                actualizarMensaje((m) => m.tipo === 'propuesta' && m.propuesta.id === data.propuestaId, { estado: 'cancelada' });
                if (propuestaPendiente.current === data.propuestaId) propuestaPendiente.current = null;
            }
            if (data.tipo === 'aplicado' && data.propuestaId) {
                actualizarMensaje((m) => m.tipo === 'propuesta' && m.propuesta.id === data.propuestaId, { estado: 'aplicada', loteId: data.loteId });
                if (propuestaPendiente.current === data.propuestaId) propuestaPendiente.current = null;
            }
        }
        // Un archivo puede devolver «añadí X» y, además, una propuesta con lo dudoso u opcional
        for (const extra of [].concat(data.siguiente ?? [])) pintar(extra);
    }, [agregar, actualizarMensaje, alActualizar, recordar]);

    // ---- voz: lectura y modo conversación ----
    const iniciarDictadoRef = useRef(() => {});
    const responderEnVoz = useCallback(async (hablado) => {
        if (!vivo.current.leer && !vivo.current.conversacion) return;
        await hablar(hablado);
        if (vivo.current.conversacion && !vivo.current.enviando && !vivo.current.escuchando) iniciarDictadoRef.current({ automatico: true });
    }, []);

    // ---- envío de un mensaje ----
    const enviar = useCallback(async ({ texto: t, mostrar = t, aclaracion = null }) => {
        if (vivo.current.enviando) return;
        if (mostrar) { agregar({ tipo: 'burbuja', quien: 'usuario', texto: mostrar }); recordar('usuario', mostrar); }
        setEnviando(true);
        const cuerpo = {
            texto: t, fechaHoy: hoyISO(), tzOffset: tzOffset(), horaLocal: horaLocal(),
            historial: historial.current.slice(0, -1).slice(-MAX_TURNOS),
            contexto: contexto ? { seccion: contexto.seccion, proyecto: contexto.proyecto || '', tema: contexto.tema || '', ...(contexto.objetivoId ? { objetivoId: contexto.objetivoId } : {}) } : undefined,
            propuestaPendiente: propuestaPendiente.current || undefined
        };
        const acl = aclaracion ?? (aclaracionPendiente.current ? { id: aclaracionPendiente.current, respuestas: {} } : null);
        if (acl) {
            cuerpo.aclaracionId = acl.id; cuerpo.respuestas = acl.respuestas;
            actualizarMensaje((m) => m.tipo === 'aclaracion' && m.aclaracion.id === acl.id, { respondida: true });
        }
        aclaracionPendiente.current = null;
        let hablado = '';
        try {
            const r = await asistente.chat(cuerpo);
            if (!r.ok) { hablado = r.data.error || 'No pude procesar eso. Intenta ser más específico.'; agregar({ tipo: 'burbuja', quien: 'error', texto: hablado }); }
            else { pintar(r.data); hablado = textoHablado(r.data); }
        } catch (e) {
            hablado = e instanceof ErrorConexion && e.tiempoAgotado ? 'El asistente tardó demasiado en responder. Inténtalo de nuevo.' : mensajeDeError(e);
            agregar({ tipo: 'burbuja', quien: 'error', texto: hablado });
        } finally {
            setEnviando(false);
            entrada.current?.focus();
        }
        responderEnVoz(hablado);
    }, [agregar, actualizarMensaje, pintar, recordar, responderEnVoz, contexto]);

    // ---- archivo + mensaje ----
    const prepararAdjunto = (archivo) => {
        if (!archivo || vivo.current.enviando) return;
        const ext = extension(archivo.name);
        if (!capacidades.formatos.includes(ext)) { agregar({ tipo: 'burbuja', quien: 'error', texto: `No puedo leer «${archivo.name}». Formatos admitidos: ${capacidades.formatos.join(' ')}.` }); return; }
        if (archivo.size > MAX_BYTES) { agregar({ tipo: 'burbuja', quien: 'error', texto: `«${archivo.name}» pesa ${(archivo.size / 1048576).toFixed(1)} MB; el máximo es 5 MB.` }); return; }
        setAdjunto(archivo);
        entrada.current?.focus();
    };
    const quitarAdjunto = () => { setAdjunto(null); if (inputArchivo.current) inputArchivo.current.value = ''; };

    const enviarArchivo = async (archivo, mensaje = '') => {
        const fd = new FormData();
        fd.append('fechaHoy', hoyISO());
        fd.append('tzOffset', String(tzOffset()));
        fd.append('horaLocal', horaLocal());
        if (contexto?.seccion) fd.append('contextoSeccion', contexto.seccion);
        if (contexto?.proyecto) fd.append('contextoProyecto', contexto.proyecto);
        if (contexto?.tema) fd.append('contextoTema', contexto.tema);
        const instruccion = mensaje.slice(0, 500);
        if (instruccion) fd.append('instruccion', instruccion);
        fd.append('archivo', archivo, archivo.name);
        quitarAdjunto();
        // v3.12: en Estudio, un archivo es un taller o trabajo que se ANALIZA (temas y fechas) y se revisa antes de guardar
        const analisisEstudio = contexto?.seccion === 'estudio';
        agregar({ tipo: 'burbuja', quien: 'usuario', texto: instruccion || (analisisEstudio ? 'Analiza este taller: ¿qué necesito aprender y para cuándo?' : 'Revisa este archivo y añade lo que encuentres.'), adjunto: `📎 ${archivo.name} (${kb(archivo.size)} KB)` });
        recordar('usuario', `📎 ${archivo.name}${instruccion ? ` — ${instruccion}` : ''}`);
        setEnviando(true);
        setTextoEspera('Leyendo el archivo…');
        let hablado = '';
        try {
            const r = analisisEstudio ? await apiEstudio.analizar(fd) : await asistente.archivo(fd);
            if (!r.ok) { hablado = r.data.error || 'No pude procesar el archivo.'; agregar({ tipo: 'burbuja', quien: 'error', texto: hablado }); }
            else { pintar(r.data); hablado = textoHablado(r.data); }
        } catch (e) {
            hablado = e instanceof ErrorConexion && e.tiempoAgotado ? 'El archivo tardó demasiado en procesarse.' : 'No pude subir el archivo.';
            agregar({ tipo: 'burbuja', quien: 'error', texto: hablado });
        } finally { setEnviando(false); setTextoEspera('El asistente está pensando…'); }
        responderEnVoz(hablado);
    };

    const alEnviar = (e) => {
        e.preventDefault();
        if (enviando) return;
        const t = texto.trim();
        if (adjunto) {                                   // archivo + mensaje en el mismo envío
            if (escuchando) reconocedor.current?.stop();
            setTexto('');
            enviarArchivo(adjunto, t);
            return;
        }
        if (!t) return;
        if (escuchando) reconocedor.current?.stop();
        setTexto('');
        enviar({ texto: t });
    };

    // ---- dictado (Speech-to-Text) ----
    const silencios = useRef(0);
    const modoConversacion = useCallback((si) => {
        setConversacion(si);
        vivo.current.conversacion = si;
        silencios.current = 0;
        if (si) { iniciarDictadoRef.current({ automatico: true }); return; }
        callar();
        if (vivo.current.escuchando) reconocedor.current?.abort();
        setEstadoVoz('');
    }, []);

    const iniciarDictado = useCallback(({ automatico = false, idioma = 'es-CO' } = {}) => {
        if (!dictadoDisponible) return;
        callar();                                        // si el asistente está hablando, se calla para escucharte
        const r = new SR();
        reconocedor.current = r;
        r.lang = idioma;
        r.interimResults = true;
        r.continuous = false;
        r.maxAlternatives = 1;
        const actual = vivo.current.texto;
        const base = actual.trim() ? `${actual.trimEnd()} ` : '';
        let huboError = false;
        r.onstart = () => {
            setEscuchando(true); vivo.current.escuchando = true; setMostrarPrivacidad(true);
            setEstadoVoz(automatico ? '🔴 Te escucho… (modo conversación)' : '🔴 Escuchando… habla ahora (pulsa 🎤 otra vez para parar).');
        };
        r.onresult = (event) => {
            const valor = componerEntrada(base, event.results);
            vivo.current.texto = valor;
            setTexto(valor);
        };
        r.onerror = (e) => {
            if (e.error === 'language-not-supported' && idioma === 'es-CO') { huboError = 'reintentar'; return; }
            if (e.error === 'aborted') return;
            if (e.error === 'no-speech' && vivo.current.conversacion) { huboError = 'silencio'; return; }
            huboError = true;
            if (vivo.current.conversacion) modoConversacion(false);
            setEstadoVoz(`⚠ ${ERRORES_VOZ[e.error] ?? 'No se pudo usar el dictado.'}`);
        };
        r.onend = () => {
            setEscuchando(false); vivo.current.escuchando = false;
            if (huboError === 'reintentar') { iniciarDictadoRef.current({ automatico, idioma: 'es-ES' }); return; }
            if (vivo.current.conversacion) {
                // Modo conversación: lo dictado se envía solo; dos silencios seguidos apagan el modo
                const dicho = vivo.current.texto.trim();
                if (dicho) { silencios.current = 0; setTexto(''); vivo.current.texto = ''; setEstadoVoz(''); enviar({ texto: dicho }); return; }
                if (++silencios.current >= 2) { modoConversacion(false); setEstadoVoz('No te escuché: apagué el modo conversación.'); return; }
                iniciarDictadoRef.current({ automatico: true });
                return;
            }
            if (!huboError) setEstadoVoz(vivo.current.texto.trim() ? '✓ Dictado listo: revisa el texto y pulsa Enviar.' : '');
            entrada.current?.focus();
        };
        try { r.start(); } catch { setEstadoVoz('⚠ No se pudo iniciar el dictado.'); setEscuchando(false); }
    }, [SR, dictadoDisponible, enviar, modoConversacion]);
    iniciarDictadoRef.current = iniciarDictado;

    const alternarMic = () => {
        if (!dictadoDisponible) return;
        if (escuchando) { reconocedor.current?.stop(); return; }
        iniciarDictado();
    };
    const alternarLectura = () => {
        const si = !leer;
        setLeer(si); vivo.current.leer = si;
        try { localStorage.setItem(CLAVE_LEER, si ? '1' : '0'); } catch { /* sin almacenamiento */ }
        if (!si && !conversacion) callar();
    };

    // ---- respuestas desde las tarjetas ----
    const alAplicada = (propuestaId, loteId) => {
        actualizarMensaje((m) => m.tipo === 'propuesta' && m.propuesta.id === propuestaId, { estado: 'aplicada', loteId });
        if (propuestaPendiente.current === propuestaId) propuestaPendiente.current = null;
    };
    const alCancelada = (propuestaId, estado) => {
        actualizarMensaje((m) => m.tipo === 'propuesta' && m.propuesta.id === propuestaId, { estado });
        if (propuestaPendiente.current === propuestaId) propuestaPendiente.current = null;
    };
    const alResponderAclaracion = (id, respuestas, mostrar) => enviar({ texto: '', mostrar, aclaracion: { id, respuestas } });

    // ---- arrastrar y soltar ----
    const conArchivos = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const arrastre = {
        onDragEnter: (e) => { if (!conArchivos(e)) return; e.preventDefault(); profundidad.current++; setArrastrando(true); },
        onDragOver: (e) => { if (conArchivos(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
        onDragLeave: () => { profundidad.current = Math.max(0, profundidad.current - 1); if (!profundidad.current) setArrastrando(false); },
        onDrop: (e) => {
            if (!conArchivos(e)) return;
            e.preventDefault(); profundidad.current = 0; setArrastrando(false);
            if (e.dataTransfer.files.length > 1) { agregar({ tipo: 'burbuja', quien: 'error', texto: 'Suelta un solo archivo a la vez.' }); return; }
            prepararAdjunto(e.dataTransfer.files[0]);
        }
    };

    const presentacion = nombreIA === 'Nexo'
        ? '¡Hola! Soy Nexo, tu asistente (puedes cambiarme el nombre en Configuración › Voz de la IA). '
        : `¡Hola! Soy ${nombreIA}, tu asistente. `;
    const ayudaArchivos = !capacidades.archivos
        ? '📎 La carga de archivos no está disponible en este servidor.'
        : `Puedes adjuntar o arrastrar aquí: ${capacidades.formatos.join(' ')} (máx. 5 MB, 1 archivo).${capacidades.imagenes ? '' : ' Imágenes: no disponibles (el servidor no tiene modelo de visión).'}`;
    const estadoVozInicial = !SR ? 'El dictado por voz no está disponible en este navegador.' : !contextoSeguro ? 'El dictado requiere HTTPS o localhost.' : '';

    return (
        <div className={`chatia${enviando ? ' ocupado' : ''}${arrastrando ? ' arrastrando' : ''}`} {...arrastre}>
            <div ref={log} className="chatia-log" id={`${idChat}-log`} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversación con el asistente" tabIndex={0}>
                {mensajes.map((m) => {
                    if (m.tipo === 'propuesta') return <TarjetaPropuesta key={m.id} m={m} idChat={idChat} alAplicada={alAplicada} alCancelada={alCancelada} alActualizar={alActualizar} recordar={recordar} />;
                    if (m.tipo === 'aclaracion') return <TarjetaAclaracion key={m.id} m={m} alResponder={alResponderAclaracion} />;
                    if (m.tipo === 'estudio') return <TarjetaEstudio key={m.id} datos={m.datos} alActualizar={alActualizar} />;
                    return <Burbuja key={m.id} m={m.saludo ? { ...m, prefijo: presentacion } : m} alActualizar={alActualizar} recordar={recordar} />;
                })}
            </div>
            <div className="chatia-escribiendo" hidden={!enviando}>
                <span className="puntos" aria-hidden="true"><i /><i /><i /></span><span className="texto">{textoEspera}</span>
            </div>
            <div className="chatia-chips" role="group" aria-label="Sugerencias">
                {sugerencias.map((s) => (
                    <button key={s.etiqueta} type="button" className="chatia-chip" onClick={() => {
                        setTexto(s.texto);
                        requestAnimationFrame(() => { const el = entrada.current; if (el) { el.focus(); el.setSelectionRange(s.texto.length, s.texto.length); } });
                    }}>{s.etiqueta}</button>
                ))}
            </div>
            <div className="chatia-adjunto" hidden={!adjunto} role="status">
                <span aria-hidden="true">📎</span>
                <span className="chatia-adjunto-nombre">{adjunto ? `${adjunto.name} (${kb(adjunto.size)} KB) · escribe un mensaje si quieres y pulsa Enviar` : ''}</span>
                <button type="button" className="chatia-adjunto-quitar" aria-label="Quitar el archivo adjunto" title="Quitar el archivo" onClick={() => { quitarAdjunto(); entrada.current?.focus(); }}>✕</button>
            </div>
            <form className="chatia-form" autoComplete="off" onSubmit={alEnviar}>
                <label htmlFor={`${idChat}-texto`} className="solo-lectores">Mensaje para el asistente</label>
                <button type="button" className="chatia-icono" aria-label="Adjuntar archivo" title="Adjuntar archivo (máx. 5 MB)" disabled={enviando || !capacidades.archivos}
                    onClick={() => inputArchivo.current?.click()}>📎</button>
                <input ref={inputArchivo} type="file" className="solo-lectores" tabIndex={-1} aria-hidden="true" accept={capacidades.formatos.join(',')}
                    onChange={(e) => prepararAdjunto(e.target.files?.[0])} />
                <textarea ref={entrada} id={`${idChat}-texto`} className="chatia-entrada" rows={2} maxLength={500}
                    placeholder={adjunto ? 'Explica el archivo (opcional): «son de la materia Redes», «solo los exámenes»…' : `Escribe o dicta a ${nombreIA}…`}
                    title="Enter envía · Mayús+Enter hace un salto de línea" value={texto}
                    onChange={(e) => { setTexto(e.target.value); callar(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
                <button type="button" className={`chatia-icono chatia-mic${escuchando ? ' escuchando' : ''}`} aria-pressed={escuchando}
                    aria-label={!SR ? 'Dictado por voz no disponible en este navegador' : escuchando ? 'Detener dictado' : 'Dictar por voz'}
                    title={!SR ? 'Tu navegador no admite dictado por voz (prueba Chrome o Edge).' : !contextoSeguro ? 'El dictado requiere HTTPS o localhost.' : 'Dictar por voz'}
                    disabled={!dictadoDisponible} onClick={alternarMic}>🎤</button>
                <button type="submit" className="chatia-enviar" disabled={enviando} aria-busy={enviando}>Enviar</button>
            </form>
            <div className="chatia-voz" role="group" aria-label="Voz del asistente">
                <button type="button" className={`chatia-voz-btn${leer ? ' activo' : ''}`} aria-pressed={leer} disabled={!vozDisponible}
                    title={vozDisponible ? 'Leer las respuestas en voz alta' : 'Tu navegador no puede leer en voz alta.'} onClick={alternarLectura}>Leer respuestas</button>
                <button type="button" className={`chatia-voz-btn${conversacion ? ' activo' : ''}`} aria-pressed={conversacion} disabled={!dictadoDisponible || !vozDisponible}
                    title={!dictadoDisponible || !vozDisponible ? 'La conversación por voz necesita dictado y lectura en voz alta (Chrome o Edge, en HTTPS o localhost).' : 'Hablar con el asistente sin teclado: escucha, responde en voz alta y vuelve a escuchar'}
                    onClick={() => modoConversacion(!conversacion)}>Conversación por voz</button>
            </div>
            <p className="chatia-estado" role="status" aria-live="polite">{estadoVoz || estadoVozInicial}</p>
            <p className="chatia-privacidad" hidden={!mostrarPrivacidad}>Dictado: en Chrome y Edge el audio lo procesa el servicio de reconocimiento del navegador (puede enviarse a sus servidores). LearnTrack no graba ni guarda audio: solo recibe el texto que tú revisas y envías.</p>
            <p className="chatia-ayuda">{ayudaArchivos}</p>
        </div>
    );
}
